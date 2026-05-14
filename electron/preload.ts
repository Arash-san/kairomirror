import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("scrcpyStudio", {
  getAppInfo: () => ipcRenderer.invoke("app:info"),
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (settings: unknown) => ipcRenderer.invoke("settings:save", settings),
  listDevices: () => ipcRenderer.invoke("scrcpy:list-devices"),
  listApps: (selectedDevice?: string) => ipcRenderer.invoke("scrcpy:list-apps", selectedDevice),
  getAppIcon: (request: unknown) => ipcRenderer.invoke("scrcpy:get-app-icon", request),
  launchApp: (request: unknown) => ipcRenderer.invoke("scrcpy:launch-app", request),
  openMirrorWindow: (request: unknown) => ipcRenderer.invoke("mirror:open", request),
  fitMirrorWindow: (request: unknown) => ipcRenderer.invoke("mirror:fit", request),
  listAppSessions: () => ipcRenderer.invoke("scrcpy:list-app-sessions"),
  stopAppSession: (sessionId: string) => ipcRenderer.invoke("scrcpy:stop-app-session", sessionId),
  stopAllAppSessions: () => ipcRenderer.invoke("scrcpy:stop-all-app-sessions"),
  start: (profile: unknown) => ipcRenderer.invoke("scrcpy:start", profile),
  stop: () => ipcRenderer.invoke("scrcpy:stop"),
  sendControl: (request: unknown) => ipcRenderer.invoke("scrcpy:control", request),
  runUtility: (request: unknown) => ipcRenderer.invoke("scrcpy:utility", request),
  runDeviceAction: (request: unknown) => ipcRenderer.invoke("scrcpy:device-action", request),
  getVirtualCameraStatus: () => ipcRenderer.invoke("virtualcam:status"),
  installVirtualCamera: () => ipcRenderer.invoke("virtualcam:install"),
  uninstallVirtualCamera: () => ipcRenderer.invoke("virtualcam:uninstall"),
  startVirtualCamera: (request: unknown) => ipcRenderer.invoke("virtualcam:start", request),
  sendVirtualCameraFrame: (request: unknown) => ipcRenderer.invoke("virtualcam:frame", request),
  stopVirtualCamera: () => ipcRenderer.invoke("virtualcam:stop"),
  setControlsHeight: (height: number) => ipcRenderer.invoke("window:set-controls-height", height),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  installUpdate: () => ipcRenderer.invoke("updates:install"),
  openExternal: (url: string) => ipcRenderer.invoke("app:open-external", url),
  onScrcpyEvent: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on("scrcpy:event", listener);
    return () => ipcRenderer.removeListener("scrcpy:event", listener);
  },
  onVideoPacket: (callback: (packet: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on("scrcpy:video-packet", listener);
    return () => ipcRenderer.removeListener("scrcpy:video-packet", listener);
  },
  onMirrorStart: (callback: (profile: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on("mirror:start", listener);
    return () => ipcRenderer.removeListener("mirror:start", listener);
  }
});
