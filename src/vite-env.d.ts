/// <reference types="vite/client" />

interface ScrcpyStudioApi {
  getAppInfo: () => Promise<{ name: string; scrcpyPath: string; scrcpyDir: string; version: string; platform: string; appVersion: string }>;
  loadSettings: () => Promise<unknown>;
  saveSettings: (settings: unknown) => Promise<boolean>;
  listDevices: () => Promise<Array<{ serial: string; state: string; details: string; label: string }>>;
  listApps: (selectedDevice?: string) => Promise<Array<{ name: string; packageName: string; system: boolean }>>;
  getAppIcon: (request: unknown) => Promise<{ packageName: string; dataUrl: string | null; source?: string; cached?: boolean }>;
  launchApp: (request: unknown) => Promise<{ id: string; pid?: number; name: string; packageName: string; startedAt: number }>;
  openMirrorWindow: (request: unknown) => Promise<boolean>;
  fitMirrorWindow: (request: unknown) => Promise<boolean>;
  listAppSessions: () => Promise<Array<{ id: string; pid?: number; name: string; packageName: string; startedAt: number }>>;
  stopAppSession: (sessionId: string) => Promise<boolean>;
  stopAllAppSessions: () => Promise<boolean>;
  start: (profile: unknown) => Promise<{ ok: boolean; pid?: number; args?: string[] }>;
  stop: () => Promise<boolean>;
  sendControl: (request: unknown) => Promise<boolean>;
  runUtility: (request: unknown) => Promise<{ output: string; exitCode: number | null }>;
  runDeviceAction: (request: unknown) => Promise<boolean>;
  getVirtualCameraStatus: () => Promise<{
    platform: string;
    available: boolean;
    running: boolean;
    registered64: boolean;
    registered32: boolean;
    dll64: boolean;
    dll32: boolean;
    writer: boolean;
    guid: string;
    config?: { width: number; height: number; fps: number; mode: "stdin" | "test" } | null;
  }>;
  installVirtualCamera: () => Promise<unknown>;
  uninstallVirtualCamera: () => Promise<unknown>;
  startVirtualCamera: (request: unknown) => Promise<unknown>;
  sendVirtualCameraFrame: (request: unknown) => Promise<boolean>;
  stopVirtualCamera: () => Promise<unknown>;
  setControlsHeight: (height: number) => Promise<boolean>;
  checkForUpdates: () => Promise<boolean>;
  installUpdate: () => Promise<boolean>;
  openExternal: (url: string) => Promise<void>;
  onScrcpyEvent: (callback: (event: unknown) => void) => () => void;
  onVideoPacket: (callback: (packet: unknown) => void) => () => void;
  onMirrorStart: (callback: (profile: unknown) => void) => () => void;
}

interface Window {
  scrcpyStudio?: ScrcpyStudioApi;
}
