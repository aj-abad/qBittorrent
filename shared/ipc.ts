// Shared IPC contract between the Electron main process (electron/main.ts),
// the preload bridge (electron/preload.ts) and the renderer (Nuxt app).
// Keep this dependency-free so it can be imported from either side.
//
// The renderer NEVER talks to qbittorrent-nox over HTTP. It calls `window.qbt`
// (IPC) and the main process owns the only connection to the daemon, handling
// auth internally. That keeps the renderer auth-free and lets CSP stay 'self'.

export const IpcChannels = {
  // app
  appGetVersion: "app:getVersion",
  appPing: "app:ping",
  // backend (qbittorrent-nox) supervision
  backendGet: "backend:get", // renderer → main (invoke): snapshot
  backendStatusChanged: "backend:statusChanged", // main → renderer (send): updates
  // qBittorrent Web API proxy (renderer → main → nox)
  apiRequest: "api:request",
} as const;

export type BackendStatus = "not-found" | "starting" | "ready" | "error";

export interface BackendInfo {
  status: BackendStatus;
}

/**
 * A qBittorrent Web API call, proxied through the main process.
 * `path` is relative to `/api/v2/` (e.g. "torrents/info", "app/version").
 * `params` become the query string for GET, or a urlencoded form body for POST.
 */
export interface ApiRequest {
  method?: "GET" | "POST";
  path: string;
  params?: Record<string, string | number | boolean>;
}

export interface ApiResponse<T = unknown> {
  status: number;
  ok: boolean;
  /** Parsed JSON when the response is JSON, otherwise the raw text body. */
  data: T;
}

/** The bridge exposed on `window.qbt` by electron/preload.ts. */
export interface QbtBridge {
  versions: { node: string; chrome: string; electron: string };
  getVersion(): Promise<string>;
  ping(): Promise<"pong">;
  /** Current backend (qbittorrent-nox) status snapshot. */
  getBackend(): Promise<BackendInfo>;
  /** Subscribe to backend status changes. Returns an unsubscribe function. */
  onBackendStatus(callback: (info: BackendInfo) => void): () => void;
  /** Call the qBittorrent Web API via the main process (auth handled there). */
  api<T = unknown>(request: ApiRequest): Promise<ApiResponse<T>>;
}
