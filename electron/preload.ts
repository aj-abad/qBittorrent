import { contextBridge, ipcRenderer } from "electron";
import { IpcChannels, type ApiRequest, type BackendInfo, type QbtBridge } from "../shared/ipc";

const bridge: QbtBridge = {
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },

  getVersion: () => ipcRenderer.invoke(IpcChannels.appGetVersion),
  ping: () => ipcRenderer.invoke(IpcChannels.appPing),

  getBackend: () => ipcRenderer.invoke(IpcChannels.backendGet),

  onBackendStatus: (callback: (info: BackendInfo) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, info: BackendInfo) => callback(info);
    ipcRenderer.on(IpcChannels.backendStatusChanged, handler);
    return () => ipcRenderer.removeListener(IpcChannels.backendStatusChanged, handler);
  },

  api: (request: ApiRequest) => ipcRenderer.invoke(IpcChannels.apiRequest, request),
};

contextBridge.exposeInMainWorld("qbt", bridge);
