import { ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import type { ApiRequest, ApiResponse, BackendStatus } from "../shared/ipc";

// Port the spawned qbittorrent-nox should serve its Web API on.
// Override with QBT_WEBUI_PORT to avoid clashing with another instance.
const WEBUI_PORT = Number(process.env.QBT_WEBUI_PORT ?? 8080);

const READY_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 300;

function toFormParams(params: Record<string, string | number | boolean> = {}): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) sp.append(k, String(v));
  return sp.toString();
}

/**
 * Spawns and supervises the qbittorrent-nox backend (our "sidecar") AND owns
 * the only HTTP connection to it. The renderer reaches the Web API exclusively
 * through `request()` (via IPC), so authentication is handled here, once,
 * invisibly — the frontend never sees credentials.
 *
 * - Locates the binary (env override → packaged resources → CMake build dir).
 * - Runs it against an isolated profile so dev runs never touch the user's
 *   real qBittorrent config.
 * - "ready" once the Web API socket answers at all (any HTTP response).
 * - On a 403, logs in with the one-time password nox prints on startup and
 *   retries, caching the SID cookie for subsequent calls.
 */
export class BackendManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private _status: BackendStatus = "not-found";
  private tempPassword: string | null = null;
  private cookie: string | null = null;

  readonly port = WEBUI_PORT;
  readonly url = `http://127.0.0.1:${WEBUI_PORT}`;

  get status(): BackendStatus {
    return this._status;
  }

  private setStatus(status: BackendStatus): void {
    if (status === this._status) return;
    this._status = status;
    this.emit("status", status);
  }

  private binaryCandidates(): string[] {
    const exe = process.platform === "win32" ? "qbittorrent-nox.exe" : "qbittorrent-nox";
    const fromEnv = process.env.QBT_NOX_PATH;
    return [
      ...(fromEnv ? [fromEnv] : []),
      // packaged: bundled alongside the app resources
      join(process.resourcesPath ?? "", "backend", exe),
      // dev: CMake build output at the repo root (cmake --build build).
      // __dirname is dist-electron/ at runtime, so ../build and ../../build.
      join(__dirname, "..", "build", exe),
      join(__dirname, "..", "..", "build", exe),
    ];
  }

  start(): void {
    const bin = this.binaryCandidates().find(existsSync);
    if (!bin) {
      this.setStatus("not-found");
      console.warn(
        "[backend] qbittorrent-nox not found. Build it (cmake --build build) " +
          "or set QBT_NOX_PATH. The frontend will run without a backend.",
      );
      return;
    }

    const profileDir = join(app.getPath("userData"), "nox-profile");
    const args = [
      `--webui-port=${this.port}`,
      `--profile=${profileDir}`,
      // Skip the interactive first-run legal notice so the daemon doesn't block.
      "--confirm-legal-notice",
    ];

    console.log(`[backend] launching: ${bin} ${args.join(" ")}`);
    this.setStatus("starting");
    this.process = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });

    const onOutput = (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split("\n")) {
        const text = line.trim();
        if (!text) continue;
        console.log(`[nox] ${text}`);
        // qbittorrent-nox prints a one-time random password on a fresh profile.
        const match = text.match(/temporary password is provided for this session:\s*(\S+)/i);
        if (match) this.tempPassword = match[1];
      }
    };
    this.process.stdout?.on("data", onOutput);
    this.process.stderr?.on("data", onOutput);

    this.process.on("exit", (code) => {
      console.log(`[backend] qbittorrent-nox exited (code=${code})`);
      this.process = null;
      this.cookie = null;
      this.setStatus(this._status === "ready" ? "not-found" : "error");
    });
    this.process.on("error", (err) => {
      console.error(`[backend] spawn error: ${err.message}`);
      this.setStatus("error");
    });

    void this.waitForReady();
  }

  private async waitForReady(): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    const readyUrl = `${this.url}/api/v2/app/version`;
    while (Date.now() < deadline) {
      if (!this.process) return; // process exited while we were waiting
      try {
        // Any HTTP response means the socket is up. Don't require res.ok —
        // the endpoint may answer 401/403 when auth isn't bypassed.
        await fetch(readyUrl);
        this.setStatus("ready");
        return;
      } catch {
        // connection refused — backend still booting; retry
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    if (this._status !== "ready") {
      console.error(`[backend] timed out waiting for Web API at ${readyUrl}`);
      this.setStatus("error");
    }
  }

  /**
   * Proxy a qBittorrent Web API call. The renderer only ever reaches this via
   * IPC, so it can talk to nothing but /api/v2/* on the local daemon.
   */
  async request(req: ApiRequest): Promise<ApiResponse> {
    if (this._status !== "ready") {
      return { status: 0, ok: false, data: "backend not ready" };
    }

    // Restrict to relative Web API paths — no absolute URLs, no traversal.
    const path = req.path.replace(/^\/+/, "");
    if (path.includes("://") || path.includes("..")) {
      return { status: 400, ok: false, data: "invalid api path" };
    }

    let res = await this.rawFetch(req, path);
    if (res.status === 403) {
      await this.login();
      res = await this.rawFetch(req, path);
    }
    return res;
  }

  private async rawFetch(req: ApiRequest, path: string): Promise<ApiResponse> {
    const method = req.method ?? "GET";
    const form = toFormParams(req.params);
    const headers: Record<string, string> = {};
    if (this.cookie) headers["cookie"] = this.cookie;

    let url = `${this.url}/api/v2/${path}`;
    let body: string | undefined;
    if (method === "GET") {
      if (form) url += `?${form}`;
    } else {
      headers["content-type"] = "application/x-www-form-urlencoded";
      body = form;
    }

    try {
      const r = await fetch(url, { method, headers, body });
      const text = await r.text();
      const contentType = r.headers.get("content-type") ?? "";
      const data = contentType.includes("application/json") ? safeJson(text) : text;
      return { status: r.status, ok: r.ok, data };
    } catch (err) {
      return { status: 0, ok: false, data: String(err) };
    }
  }

  private async login(): Promise<void> {
    if (!this.tempPassword) return;
    try {
      const r = await fetch(`${this.url}/api/v2/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: toFormParams({ username: "admin", password: this.tempPassword }),
      });
      // Node's fetch (undici) exposes set-cookie via getSetCookie().
      const setCookies =
        (r.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ??
        (r.headers.get("set-cookie") ? [r.headers.get("set-cookie")!] : []);
      for (const c of setCookies) {
        const m = c.match(/SID=[^;]+/);
        if (m) {
          this.cookie = m[0];
          break;
        }
      }
    } catch (err) {
      console.error(`[backend] login failed: ${String(err)}`);
    }
  }

  kill(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.cookie = null;
    this._status = "not-found";
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
