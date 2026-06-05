import { app, BrowserWindow, ipcMain, Menu, nativeImage, protocol, shell } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { IpcChannels, type BackendInfo } from "../shared/ipc";
import { BackendManager } from "./backend";

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const isDev = !!DEV_URL;

const RENDERER_DIST = normalize(join(__dirname, "../.output/public"));
const APP_SCHEME = "app";
const APP_ORIGIN = `${APP_SCHEME}://bundle`;

// Branding. Drives the macOS app menu / "About qBittorrent" item and the
// dock/menu-bar name. package.json's `name` must stay lowercase (npm rule),
// so set the display name explicitly here. Packaged builds also get this from
// electron-builder's productName (CFBundleName); this covers `electron .` dev.
const APP_NAME = "qBittorrent";
app.setName(APP_NAME);

// Path to the raster app icon, used for the dev dock tile (packaged builds use
// the bundle icon). __dirname is dist-electron/ at runtime.
const ICON_PATH = join(__dirname, "..", "electron", "resources", "icon.png");

// qbittorrent-nox backend supervisor. Started on app-ready, killed on quit.
// It also owns the only HTTP connection to the daemon; the renderer reaches
// the Web API only through the `api:request` IPC channel below.
const backend = new BackendManager();

function backendInfo(): BackendInfo {
  return { status: backend.status };
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".map": "application/json",
};

// 'unsafe-inline' for script-src is required because Nuxt generates an
// inline window.__NUXT__ config block whose hash changes every build.
// The renderer has no Node access (nodeIntegration:false, sandbox:true)
// so the practical risk of inline scripts here is low.
// connect-src stays 'self': the renderer makes no network requests — all
// qBittorrent Web API traffic goes through the main process over IPC.
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
].join("; ");

function serveBundle(pathname: string): Response {
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  let file = normalize(join(RENDERER_DIST, rel));
  if (!file.startsWith(RENDERER_DIST)) file = join(RENDERER_DIST, "index.html");
  if (!existsSync(file)) file = join(RENDERER_DIST, "index.html");
  const body = readFileSync(file);
  const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
  return new Response(body, {
    headers: { "content-type": type, "content-security-policy": PROD_CSP },
  });
}

function getWin(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows()[0];
}

// ---- native menu -----------------------------------------------------------

function buildAppMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    // macOS app menu
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },

    // Edit
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },

    // View
    {
      label: "View",
      submenu: [
        {
          label: "Force Reload",
          accelerator: "CmdOrCtrl+R",
          click: () => getWin()?.webContents.reloadIgnoringCache(),
        },
        ...(isDev
          ? [{ role: "toggleDevTools" as const }, { type: "separator" as const }]
          : []),
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
      ],
    },

    // Window
    {
      label: "Window",
      role: "window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" },
      ],
    },

    // Help
    {
      role: "help",
      submenu: [
        {
          label: "qBittorrent on GitHub",
          click: () => void shell.openExternal("https://github.com/qbittorrent/qBittorrent"),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- window ----------------------------------------------------------------

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    titleBarStyle: "hidden",
    transparent: true,
    backgroundColor: "#00000000",
    show: process.env.QBT_SMOKE !== "1",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.platform === "darwin") win.setVibrancy("hud");

  win.webContents.on("console-message", (e: any, level?: any, message?: any) => {
    const text = e && typeof e === "object" && "message" in e ? e.message : message;
    if (text) console.log(`[renderer] ${text}`);
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    console.error(`[main] render-process-gone: ${details.reason}`);
  });
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error(`[main] did-fail-load ${code} ${desc} ${url}`);
    if (process.env.QBT_SMOKE === "1") app.exit(1);
  });
  win.webContents.on("did-finish-load", () => {
    console.log(`[main] loaded ${win.webContents.getURL()}`);
    if (process.env.QBT_SMOKE === "1") app.exit(0);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http:") || url.startsWith("https:")) void shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev) {
    void win.loadURL(DEV_URL!);
    if (process.env.QBT_SMOKE !== "1") win.webContents.openDevTools({ mode: "detach" });
  } else {
    void win.loadURL(`${APP_ORIGIN}/`);
  }
}

if (!isDev && !app.requestSingleInstanceLock()) {
  app.quit();
} else if (!isDev) {
  app.on("second-instance", () => {
    const win = getWin();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

void app.whenReady().then(() => {
  if (!isDev) {
    protocol.handle(APP_SCHEME, (request) => serveBundle(new URL(request.url).pathname));
  }

  ipcMain.handle(IpcChannels.appGetVersion, () => app.getVersion());
  ipcMain.handle(IpcChannels.appPing, () => "pong" as const);
  ipcMain.handle(IpcChannels.backendGet, () => backendInfo());
  ipcMain.handle(IpcChannels.apiRequest, (_e, req) => backend.request(req));

  // Broadcast backend status transitions to every renderer.
  backend.on("status", () => {
    const info = backendInfo();
    for (const w of BrowserWindow.getAllWindows())
      w.webContents.send(IpcChannels.backendStatusChanged, info);
  });
  backend.start();

  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
  });

  // Dock icon for unpackaged dev runs; packaged .app uses its bundle icon.
  if (process.platform === "darwin" && !app.isPackaged && app.dock && existsSync(ICON_PATH)) {
    app.dock.setIcon(nativeImage.createFromPath(ICON_PATH));
  }

  buildAppMenu();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  backend.kill();
});
