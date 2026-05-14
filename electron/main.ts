import { app, BrowserWindow, ipcMain, Menu, screen, shell } from "electron";
import electronUpdater from "electron-updater";
import { AdbServerClient } from "@yume-chan/adb";
import { AdbScrcpyClient, AdbScrcpyOptionsLatest } from "@yume-chan/adb-scrcpy";
import { AdbServerNodeTcpConnector } from "@yume-chan/adb-server-node-tcp";
import {
  AndroidKeyCode,
  AndroidKeyEventAction,
  AndroidKeyEventMeta,
  AndroidMotionEventAction,
  AndroidMotionEventButton,
  AndroidScreenPowerMode,
  DefaultServerPath,
  ScrcpyVideoCodecId,
  type ScrcpyMediaStreamPacket,
  type ScrcpyVideoStream
} from "@yume-chan/scrcpy";
import { BufferedReadableStream, ReadableStream as YReadableStream, TransformStream as YTransformStream } from "@yume-chan/stream-extra";
import { ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yauzl from "yauzl";

const require = createRequire(import.meta.url);
const { autoUpdater } = electronUpdater;
const ApkParser = require("app-info-parser/src/apk") as new (apkPath: string) => { parse: () => Promise<{ icon?: unknown }> };
const ManifestXmlParser = require("app-info-parser/src/xml-parser/manifest") as new (
  buffer: Buffer,
  options?: Record<string, unknown>
) => { parse: () => unknown };
const BinaryXmlParser = require("app-info-parser/src/xml-parser/binary") as new (buffer: Buffer) => { parse: () => BinaryXmlNode };
const ResourceFinder = require("app-info-parser/src/resource-finder") as new () => { processResourceTable: (buffer: Buffer) => unknown };
const {
  mapInfoResource,
  findApkIconPath
}: {
  mapInfoResource: (info: unknown, resourceMap: unknown) => unknown;
  findApkIconPath: (info: unknown) => string | null | undefined;
} = require("app-info-parser/src/utils");

type OptionKind = "boolean" | "value" | "optional-value";

interface OptionState {
  enabled: boolean;
  value?: string;
  kind?: OptionKind;
}

interface LaunchProfile {
  selectedDevice?: string;
  embedWindow?: boolean;
  flexibleStage?: boolean;
  optionState?: Record<string, OptionState>;
}

interface MirrorWindowRequest {
  profile: LaunchProfile;
}

interface MirrorFitRequest {
  width: number;
  height: number;
}

interface UtilityRequest {
  flag: string;
  selectedDevice?: string;
}

interface DeviceActionRequest {
  selectedDevice?: string;
  action: "screen-off" | "screen-on";
}

interface VirtualCameraStartRequest {
  width?: number;
  height?: number;
  fps?: number;
  mode?: "stdin" | "test";
}

interface VirtualCameraFrameRequest {
  data: ArrayBuffer | Uint8Array | number[];
}

interface AndroidAppInfo {
  name: string;
  packageName: string;
  system: boolean;
}

interface AndroidAppIconRequest {
  selectedDevice?: string;
  packageName: string;
  name?: string;
  force?: boolean;
}

interface LaunchAndroidAppRequest {
  selectedDevice?: string;
  packageName: string;
  name?: string;
  width?: number;
  height?: number;
  dpi?: number;
  flex?: boolean;
  keepActive?: boolean;
  forceStop?: boolean;
  audio?: boolean;
  audioDup?: boolean;
  audioSource?: string;
  audioCodec?: string;
  audioBitRate?: string;
  audioBuffer?: number;
  audioOutputBuffer?: number;
  requireAudio?: boolean;
  systemDecorations?: boolean;
  noVdDestroyContent?: boolean;
  displayImePolicy?: "default" | "local";
  videoCodec?: "h264" | "h265" | "av1";
  bitRate?: string;
  maxFps?: number;
  maxSize?: number;
  videoBuffer?: number;
  turnScreenOff?: boolean;
  stayAwake?: boolean;
  screenOffTimeout?: number;
  showTouches?: boolean;
  powerOffOnClose?: boolean;
  noPowerOn?: boolean;
  alwaysOnTop?: boolean;
  borderless?: boolean;
  mouseMode?: "default" | "sdk" | "uhid" | "disabled";
  keyboardMode?: "default" | "sdk" | "uhid" | "disabled";
}

interface AppSessionInfo {
  id: string;
  pid?: number;
  name: string;
  packageName: string;
  startedAt: number;
}

interface BinaryXmlAttribute {
  name: string;
  value?: unknown;
  typedValue?: {
    value?: unknown;
    type?: string;
    rawType?: number;
  };
}

interface BinaryXmlNode {
  nodeName: string;
  attributes?: BinaryXmlAttribute[];
  childNodes?: BinaryXmlNode[];
}

type ControlRequest =
  | {
      type: "touch";
      action: number;
      pointerId?: number | string;
      x: number;
      y: number;
      videoWidth: number;
      videoHeight: number;
      pressure?: number;
      actionButton?: number;
      buttons?: number;
    }
  | {
      type: "scroll";
      x: number;
      y: number;
      videoWidth: number;
      videoHeight: number;
      scrollX: number;
      scrollY: number;
      buttons?: number;
    }
  | { type: "key"; keyCode: number }
  | { type: "text"; text: string }
  | {
      type: "action";
      action:
        | "back"
        | "home"
        | "app-switch"
        | "power"
        | "volume-up"
        | "volume-down"
        | "rotate"
        | "notifications"
        | "settings"
        | "screen-off"
        | "screen-on"
        | "camera-torch-on"
        | "camera-torch-off"
        | "camera-zoom-in"
        | "camera-zoom-out";
    }
  | { type: "resize-display"; width: number; height: number };

interface DeviceInfo {
  serial: string;
  state: string;
  details: string;
  label: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const useDevServer = isDev && process.argv.includes("--dev");
const projectRoot = path.resolve(__dirname, "..");
const resourceRoot = isDev ? projectRoot : process.resourcesPath;
const scrcpyDir = path.join(resourceRoot, "vendor", "scrcpy-win64-v4.0");
const scrcpyExe = path.join(scrcpyDir, "scrcpy.exe");
const adbExe = path.join(scrcpyDir, "adb.exe");
const scrcpyServerFile = path.join(scrcpyDir, "scrcpy-server");
const obsVirtualCamRoot = path.join(resourceRoot, "vendor", "obs-virtualcam");
const obsVirtualCamRuntimeDir = path.join(obsVirtualCamRoot, "runtime", "data", "obs-plugins", "win-dshow");
const obsVirtualCamWriterScript = path.join(obsVirtualCamRoot, "writer", "obs-virtualcam-writer.ps1");
const obsVirtualCamGuid = "{7361F8BC-9373-43D4-B93D-ECCD403C7909}";
const ICON_CACHE_VERSION = 4;

let mainWindow: BrowserWindow | null = null;
let mirrorWindow: BrowserWindow | null = null;
let scrcpyProcess: ChildProcessWithoutNullStreams | null = null;
let directAudioProcess: ChildProcessWithoutNullStreams | null = null;
const appSessions = new Map<string, { process: ChildProcessWithoutNullStreams; info: AppSessionInfo }>();
let directScrcpyClient: AdbScrcpyClient<AdbScrcpyOptionsLatest<boolean>> | null = null;
let virtualCameraProcess: ChildProcessWithoutNullStreams | null = null;
let virtualCameraConfig: { width: number; height: number; fps: number; mode: "stdin" | "test" } | null = null;
let directStreamToken = 0;
let embeddedWindowHandle: string | null = null;
let controlsHeight = 72;
let shuttingDown = false;

const SCRCPY_PACKET_FLAG_SESSION = 1n << 63n;
const SCRCPY_PACKET_FLAG_CONFIG = 1n << 62n;
const SCRCPY_PACKET_FLAG_KEY_FRAME = 1n << 61n;
const SCRCPY_PACKET_PTS_MASK = SCRCPY_PACKET_FLAG_KEY_FRAME - 1n;
const SCRCPY_CONTROL_CAMERA_SET_TORCH = 18;
const SCRCPY_CONTROL_CAMERA_ZOOM_IN = 19;
const SCRCPY_CONTROL_CAMERA_ZOOM_OUT = 20;
const SCRCPY_CONTROL_RESIZE_DISPLAY = 21;
const MIRROR_CONTROLS_HEIGHT = 58;

function readU32BE(data: Uint8Array, offset: number) {
  return data[offset] * 0x1000000 + data[offset + 1] * 0x10000 + data[offset + 2] * 0x100 + data[offset + 3];
}

function readU64BE(data: Uint8Array, offset: number) {
  return (BigInt(readU32BE(data, offset)) << 32n) | BigInt(readU32BE(data, offset + 4));
}

function concatBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length === 0) return new Uint8Array(right);
  const output = new Uint8Array(left.length + right.length);
  output.set(left, 0);
  output.set(right, left.length);
  return output;
}

function videoCodecIdFromName(name: string) {
  if (name === "h265") return ScrcpyVideoCodecId.H265;
  if (name === "av1") return ScrcpyVideoCodecId.AV1;
  return ScrcpyVideoCodecId.H264;
}

function decodeScrcpyString(bytes: Uint8Array) {
  const end = bytes.indexOf(0);
  return new TextDecoder().decode(end >= 0 ? bytes.subarray(0, end) : bytes).trim() || undefined;
}

class AdbScrcpyOptions4_0 extends AdbScrcpyOptionsLatest<boolean> {
  override async parseVideoStreamMetadata(stream: YReadableStream<Uint8Array>): Promise<ScrcpyVideoStream> {
    const buffered = new BufferedReadableStream(stream);
    const deviceName = this.value.sendDeviceMeta ? decodeScrcpyString(await buffered.readExactly(64)) : undefined;
    const codec = (this.value.sendCodecMeta ? readU32BE(await buffered.readExactly(4), 0) : videoCodecIdFromName(this.value.videoCodec)) as ScrcpyVideoCodecId;

    return {
      stream: buffered.release(),
      metadata: {
        deviceName,
        codec
      }
    };
  }

  override createMediaStreamTransformer() {
    if (!this.value.sendFrameMeta) {
      return new YTransformStream<Uint8Array, ScrcpyMediaStreamPacket>({
        transform(chunk, controller) {
          controller.enqueue({ type: "data", data: chunk });
        }
      });
    }

    let pending = new Uint8Array();
    return new YTransformStream<Uint8Array, ScrcpyMediaStreamPacket>({
      transform(chunk, controller) {
        pending = concatBytes(pending, chunk);

        while (pending.length >= 12) {
          const flagsAndPts = readU64BE(pending, 0);
          const sizeOrHeight = readU32BE(pending, 8);

          if (flagsAndPts & SCRCPY_PACKET_FLAG_SESSION) {
            const width = readU32BE(pending, 4);
            const height = sizeOrHeight;
            const clientResized = Boolean(pending[3] & 1);
            pending = pending.subarray(12);
            sendVideoPacket({ type: "session", width, height, clientResized });
            continue;
          }

          const packetSize = sizeOrHeight;
          if (!packetSize) {
            throw new Error("Invalid scrcpy packet length: 0");
          }
          if (pending.length < 12 + packetSize) return;

          const data = pending.slice(12, 12 + packetSize);
          pending = pending.subarray(12 + packetSize);

          if (flagsAndPts & SCRCPY_PACKET_FLAG_CONFIG) {
            controller.enqueue({ type: "configuration", data });
            continue;
          }

          controller.enqueue({
            type: "data",
            keyframe: Boolean(flagsAndPts & SCRCPY_PACKET_FLAG_KEY_FRAME),
            pts: flagsAndPts & SCRCPY_PACKET_PTS_MASK,
            data
          });
        }
      }
    });
  }
}

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

async function loadPersistedSettings() {
  try {
    const raw = await fs.readFile(settingsPath(), "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function sendScrcpyEvent(payload: Record<string, unknown>) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("scrcpy:event", payload);
  }
}

function configureAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => sendScrcpyEvent({ type: "update", status: "checking" }));
  autoUpdater.on("update-available", (info) => sendScrcpyEvent({ type: "update", status: "available", version: info.version }));
  autoUpdater.on("update-not-available", () => sendScrcpyEvent({ type: "update", status: "not-available" }));
  autoUpdater.on("download-progress", (progress) => sendScrcpyEvent({ type: "update", status: "downloading", percent: Math.round(progress.percent) }));
  autoUpdater.on("update-downloaded", (info) => sendScrcpyEvent({ type: "update", status: "downloaded", version: info.version }));
  autoUpdater.on("error", (error) => sendScrcpyEvent({ type: "update", status: "error", message: error.message }));
}

async function checkForUpdates(source: "startup" | "manual") {
  if (isDev || !app.isPackaged) {
    sendScrcpyEvent({ type: "update", status: "skipped", source, message: "Update checks run only in packaged builds." });
    return false;
  }
  try {
    await autoUpdater.checkForUpdatesAndNotify();
    return true;
  } catch (error) {
    sendScrcpyEvent({ type: "update", status: "error", source, message: String(error) });
    return false;
  }
}

async function checkForUpdatesOnStartup() {
  const settings = await loadPersistedSettings();
  if (settings?.checkForUpdates === false) return;
  setTimeout(() => {
    void checkForUpdates("startup");
  }, 3000);
}

function sendVideoPacket(payload: Record<string, unknown>) {
  if ((payload.type === "metadata" || payload.type === "session") && typeof payload.width === "number" && typeof payload.height === "number") {
    fitMirrorWindowToVideo(payload.width, payload.height);
  }
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("scrcpy:video-packet", payload);
  }
}

function fitMirrorWindowToVideo(width: number, height: number) {
  if (!mirrorWindow || width <= 0 || height <= 0 || mirrorWindow.isDestroyed()) return;

  const workArea = screen.getDisplayMatching(mirrorWindow.getBounds()).workArea;
  const maxWidth = Math.max(320, workArea.width - 48);
  const maxHeight = Math.max(420, workArea.height - 48);
  const availableVideoHeight = Math.max(240, maxHeight - MIRROR_CONTROLS_HEIGHT);
  const scale = Math.min(maxWidth / width, availableVideoHeight / height, 1);
  const contentWidth = Math.max(320, Math.round(width * scale));
  const contentHeight = Math.max(420, Math.round(height * scale) + MIRROR_CONTROLS_HEIGHT);

  mirrorWindow.setContentSize(contentWidth, contentHeight);
  const bounds = mirrorWindow.getBounds();
  mirrorWindow.setBounds({
    x: Math.round(workArea.x + (workArea.width - bounds.width) / 2),
    y: Math.round(workArea.y + (workArea.height - bounds.height) / 2),
    width: bounds.width,
    height: bounds.height
  });
}

function quoteArg(value: string) {
  if (!value) return "\"\"";
  if (/[\s"]/.test(value)) return `"${value.replace(/"/g, '\\"')}"`;
  return value;
}

function buildArgs(profile: LaunchProfile, sessionTitle: string) {
  const optionState = profile.optionState ?? {};
  const args: string[] = [];
  const skipForEmbed = new Set(["--window-title", "--window-x", "--window-y", "--window-width", "--window-height"]);

  for (const [flag, state] of Object.entries(optionState)) {
    if (!state?.enabled) continue;
    if (profile.embedWindow && skipForEmbed.has(flag)) continue;
    const value = String(state.value ?? "").trim();
    if (state.kind === "boolean" || !state.kind) {
      args.push(flag);
    } else if (state.kind === "optional-value") {
      args.push(value ? `${flag}=${value}` : flag);
    } else if (value) {
      args.push(`${flag}=${value}`);
    }
  }

  if (profile.selectedDevice && !optionState["--serial"]?.enabled) {
    args.push(`--serial=${profile.selectedDevice}`);
  }

  if (profile.flexibleStage) {
    if (!args.includes("--flex-display")) args.push("--flex-display");
    if (!args.includes("--no-window-aspect-ratio-lock")) args.push("--no-window-aspect-ratio-lock");
  }

  const disablesWindow = args.includes("--no-window") || args.includes("--no-video-playback") || args.includes("--no-playback") || args.includes("--otg");
  if (profile.embedWindow && !disablesWindow) {
    if (!args.includes("--window-borderless")) args.push("--window-borderless");
    args.push(`--window-title=${sessionTitle}`);
  }

  return args;
}

function audioArgsFromProfile(profile: LaunchProfile, selectedDevice?: string) {
  const optionState = profile.optionState ?? {};
  if (isFlagEnabled(profile, "--no-audio")) return null;

  const args: string[] = [];
  const serial = profile.selectedDevice || selectedDevice;
  if (serial) args.push(`--serial=${serial}`);
  args.push("--port=27200:27249");
  args.push("--no-video", "--no-control", "--no-window");
  args.push(`--audio-source=${getFlagValue(profile, "--audio-source") || "output"}`);
  args.push(`--audio-codec=${getFlagValue(profile, "--audio-codec") || "opus"}`);
  const bitRate = getFlagValue(profile, "--audio-bit-rate");
  if (bitRate) args.push(`--audio-bit-rate=${bitRate}`);
  const buffer = getFlagValue(profile, "--audio-buffer");
  if (buffer) args.push(`--audio-buffer=${buffer}`);
  const outputBuffer = getFlagValue(profile, "--audio-output-buffer");
  if (outputBuffer) args.push(`--audio-output-buffer=${outputBuffer}`);
  if (isFlagEnabled(profile, "--audio-dup")) args.push("--audio-dup");
  if (optionState["--require-audio"]?.enabled !== false) args.push("--require-audio");
  return args;
}

function runFile(file: string, args: string[], cwd = scrcpyDir, timeoutMs = 20000) {
  return new Promise<{ stdout: string; stderr: string; exitCode: number | null }>((resolve, reject) => {
    const child = spawn(file, args, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out running ${path.basename(file)} ${args.join(" ")}`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode });
    });
  });
}

function runFileBuffer(file: string, args: string[], cwd = scrcpyDir, timeoutMs = 20000) {
  return new Promise<{ stdout: Buffer; stderr: Buffer; exitCode: number | null }>((resolve, reject) => {
    const child = spawn(file, args, { cwd, windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out running ${path.basename(file)} ${args.join(" ")}`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk) => {
      stderr.push(Buffer.from(chunk));
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), exitCode });
    });
  });
}

function psQuote(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function shQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function encodedPowerShell(command: string) {
  return Buffer.from(command, "utf16le").toString("base64");
}

async function runElevatedPowerShell(command: string, timeoutMs = 120000) {
  const encoded = encodedPowerShell(command);
  const launcher = `
$ErrorActionPreference = "Stop"
$p = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", "${encoded}") -Verb RunAs -Wait -PassThru
exit $p.ExitCode
`;
  return powershell(launcher, timeoutMs);
}

function evenNumber(value: unknown, fallback: number, min: number, max: number) {
  const next = clamp(Math.round(numberValue(value, fallback)), min, max);
  return next % 2 === 0 ? next : next - 1;
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function obsVirtualCamDll(arch: "32" | "64") {
  return path.join(obsVirtualCamRuntimeDir, `obs-virtualcam-module${arch}.dll`);
}

async function registryKeyExists(key: string) {
  try {
    const result = await runFile("reg.exe", ["query", key], resourceRoot, 6000);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

async function getVirtualCameraStatus() {
  const [dll64, dll32, writer, registered64, registered32] = await Promise.all([
    fileExists(obsVirtualCamDll("64")),
    fileExists(obsVirtualCamDll("32")),
    fileExists(obsVirtualCamWriterScript),
    process.platform === "win32" ? registryKeyExists(`HKLM\\SOFTWARE\\Classes\\CLSID\\${obsVirtualCamGuid}`) : Promise.resolve(false),
    process.platform === "win32" ? registryKeyExists(`HKLM\\SOFTWARE\\Classes\\WOW6432Node\\CLSID\\${obsVirtualCamGuid}`) : Promise.resolve(false)
  ]);

  return {
    platform: process.platform,
    available: process.platform === "win32" && dll64 && writer,
    running: Boolean(virtualCameraProcess),
    config: virtualCameraConfig,
    registered64,
    registered32,
    dll64,
    dll32,
    writer,
    guid: obsVirtualCamGuid
  };
}

async function registerVirtualCamera(action: "install" | "uninstall") {
  if (process.platform !== "win32") {
    throw new Error("The bundled DirectShow virtual camera is only available on Windows.");
  }
  const dll64 = obsVirtualCamDll("64");
  const dll32 = obsVirtualCamDll("32");
  if (!(await fileExists(dll64))) throw new Error(`Missing OBS virtual camera module: ${dll64}`);
  if (!(await fileExists(dll32))) throw new Error(`Missing OBS 32-bit virtual camera module: ${dll32}`);

  const register32 = action === "install" ? `& "$env:SystemRoot\\SysWOW64\\regsvr32.exe" /i /s ${psQuote(dll32)}` : `& "$env:SystemRoot\\SysWOW64\\regsvr32.exe" /u /s ${psQuote(dll32)}`;
  const register64 = action === "install" ? `& "$env:SystemRoot\\System32\\regsvr32.exe" /i /s ${psQuote(dll64)}` : `& "$env:SystemRoot\\System32\\regsvr32.exe" /u /s ${psQuote(dll64)}`;
  const script = `
$ErrorActionPreference = "Stop"
${register32}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
${register64}
exit $LASTEXITCODE
`;
  await runElevatedPowerShell(script, 120000);
  return getVirtualCameraStatus();
}

function frameBufferFromRequest(request: VirtualCameraFrameRequest) {
  const data = request?.data;
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data)) return Buffer.from(data);
  throw new Error("Virtual camera frame data must be binary.");
}

async function stopVirtualCameraStream() {
  const child = virtualCameraProcess;
  virtualCameraProcess = null;
  virtualCameraConfig = null;
  if (child) {
    child.kill();
  }
  sendScrcpyEvent({ type: "virtual-camera", status: "stopped" });
  return getVirtualCameraStatus();
}

async function startVirtualCameraStream(request: VirtualCameraStartRequest) {
  if (process.platform !== "win32") {
    throw new Error("The Windows virtual camera bridge requires Windows.");
  }
  if (!(await fileExists(obsVirtualCamWriterScript))) {
    throw new Error(`Missing virtual camera writer: ${obsVirtualCamWriterScript}`);
  }

  await stopVirtualCameraStream();

  const width = evenNumber(request.width, 1280, 2, 7680);
  const height = evenNumber(request.height, 720, 2, 4320);
  const fps = clamp(Math.round(numberValue(request.fps, 30)), 1, 240);
  const mode = request.mode === "test" ? "test" : "stdin";
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    obsVirtualCamWriterScript,
    "-Width",
    String(width),
    "-Height",
    String(height),
    "-Fps",
    String(fps),
    "-Mode",
    mode
  ];

  const child = spawn("powershell.exe", args, {
    cwd: path.dirname(obsVirtualCamWriterScript),
    windowsHide: true
  });
  virtualCameraProcess = child;
  virtualCameraConfig = { width, height, fps, mode };

  child.stdout.on("data", (chunk) => {
    const message = chunk.toString().trim();
    if (message) sendScrcpyEvent({ type: "virtual-camera", status: "log", message });
  });
  child.stderr.on("data", (chunk) => {
    const message = chunk.toString().trim();
    if (message) sendScrcpyEvent({ type: "virtual-camera", status: "error", message });
  });
  child.on("close", (exitCode) => {
    if (virtualCameraProcess === child) {
      virtualCameraProcess = null;
      virtualCameraConfig = null;
    }
    if (!shuttingDown) {
      sendScrcpyEvent({ type: "virtual-camera", status: "stopped", exitCode });
    }
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Virtual camera writer did not become ready.")), 5000);
    const onStdout = (chunk: Buffer) => {
      if (chunk.toString().includes("READY")) {
        clearTimeout(timeout);
        child.stdout.off("data", onStdout);
        child.off("close", onClose);
        resolve();
      }
    };
    const onClose = (exitCode: number | null) => {
      clearTimeout(timeout);
      child.stdout.off("data", onStdout);
      reject(new Error(`Virtual camera writer exited early (${exitCode ?? "unknown"}).`));
    };
    child.stdout.on("data", onStdout);
    child.once("close", onClose);
  });

  sendScrcpyEvent({ type: "virtual-camera", status: "running", width, height, fps, mode });
  return getVirtualCameraStatus();
}

async function sendVirtualCameraFrame(request: VirtualCameraFrameRequest) {
  if (!virtualCameraProcess || !virtualCameraConfig) {
    throw new Error("Virtual camera is not running.");
  }
  const frame = frameBufferFromRequest(request);
  const expected = Math.round((virtualCameraConfig.width * virtualCameraConfig.height * 3) / 2);
  if (frame.length !== expected) {
    throw new Error(`Unexpected virtual camera frame size: ${frame.length}, expected ${expected}.`);
  }
  if (!virtualCameraProcess.stdin.write(frame)) {
    await new Promise((resolve) => virtualCameraProcess?.stdin.once("drain", resolve));
  }
  return true;
}

function adbCommandArgs(selectedDevice: string | undefined, args: string[]) {
  return selectedDevice ? ["-s", selectedDevice, ...args] : args;
}

function safeCacheName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function appIconCachePath(selectedDevice: string | undefined, packageName: string) {
  const deviceKey = safeCacheName(selectedDevice || "default");
  return path.join(app.getPath("userData"), "app-icons", deviceKey, `${safeCacheName(packageName)}.json`);
}

function mimeFromIconPath(iconPath: string) {
  const extension = path.extname(iconPath).toLowerCase();
  if (extension === ".webp") return "image/webp";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  return "image/png";
}

function rasterMimeFromBuffer(buffer: Buffer, iconPath = "") {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (/\.svg$/i.test(iconPath)) return "image/svg+xml";
  return null;
}

function rasterDataUrlFromBuffer(buffer: Buffer, iconPath = "") {
  const mime = rasterMimeFromBuffer(buffer, iconPath);
  return mime ? `data:${mime};base64,${buffer.toString("base64")}` : null;
}

function svgDataUrl(svg: string) {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function escapeXmlAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function normalizeIconToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function parseBinaryXml(buffer: Buffer) {
  const originalWarn = console.warn;
  try {
    console.warn = () => undefined;
    return new BinaryXmlParser(buffer).parse();
  } finally {
    console.warn = originalWarn;
  }
}

function getXmlAttribute(node: BinaryXmlNode, name: string) {
  return node.attributes?.find((attribute) => attribute.name === name || attribute.name.endsWith(`:${name}`));
}

function rawXmlValue(attribute: BinaryXmlAttribute | undefined) {
  return attribute?.typedValue?.value ?? attribute?.value;
}

function floatFromRawBits(value: number) {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer.readFloatLE(0);
}

function numberFromXmlAttribute(node: BinaryXmlNode, name: string, fallback: number) {
  const attribute = getXmlAttribute(node, name);
  const value = rawXmlValue(attribute);
  if (typeof value === "number") {
    return attribute?.typedValue?.rawType === 4 ? floatFromRawBits(value) : value;
  }
  if (value && typeof value === "object" && "value" in value && typeof value.value === "number") return value.value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resourceKeyFromReference(value: unknown) {
  const text = String(value ?? "");
  const match = text.match(/resourceId:0x([0-9a-f]+)/i);
  return match ? `@${match[1].toUpperCase()}` : "";
}

function resourceValues(resourceMap: unknown, reference: unknown) {
  const key = resourceKeyFromReference(reference);
  if (!key || !resourceMap || typeof resourceMap !== "object") return [];
  const value = (resourceMap as Record<string, unknown>)[key];
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function colorFromValue(value: unknown) {
  if (typeof value === "number") {
    const unsigned = value >>> 0;
    return `#${(unsigned & 0xffffff).toString(16).padStart(6, "0")}`;
  }
  const text = String(value ?? "").trim();
  if (/^-?\d+$/.test(text)) return colorFromValue(Number.parseInt(text, 10));
  if (/^[0-9a-f]{6}$/i.test(text)) return `#${text}`;
  if (/^[0-9a-f]{8}$/i.test(text)) return `#${text.slice(2)}`;
  if (/^#[0-9a-f]{6,8}$/i.test(text)) return text.length === 9 ? `#${text.slice(3)}` : text;
  return "";
}

function colorFromXmlAttribute(attribute: BinaryXmlAttribute | undefined, resourceMap: unknown) {
  const value = rawXmlValue(attribute);
  const direct = colorFromValue(value);
  if (direct) return direct;
  for (const resolved of resourceValues(resourceMap, value)) {
    const color = colorFromValue(resolved);
    if (color) return color;
  }
  return "";
}

function drawableReferencesFromNode(node: BinaryXmlNode, resourceMap: unknown) {
  const attribute = getXmlAttribute(node, "drawable");
  const value = rawXmlValue(attribute);
  return resourceValues(resourceMap, value).filter((item): item is string => typeof item === "string");
}

function vectorNodeToSvg(node: BinaryXmlNode, backgroundColor = "") {
  const viewportWidth = numberFromXmlAttribute(node, "viewportWidth", numberFromXmlAttribute(node, "width", 108));
  const viewportHeight = numberFromXmlAttribute(node, "viewportHeight", numberFromXmlAttribute(node, "height", 108));
  const paths: string[] = [];

  const visit = (child: BinaryXmlNode) => {
    if (child.nodeName === "path") {
      const data = String(rawXmlValue(getXmlAttribute(child, "pathData")) ?? "");
      if (!data) return;
      const fill = colorFromXmlAttribute(getXmlAttribute(child, "fillColor"), undefined) || "none";
      const stroke = colorFromXmlAttribute(getXmlAttribute(child, "strokeColor"), undefined);
      const strokeWidth = numberFromXmlAttribute(child, "strokeWidth", 0);
      const attrs = [`d="${escapeXmlAttribute(data)}"`, `fill="${escapeXmlAttribute(fill)}"`];
      if (stroke && strokeWidth > 0) {
        attrs.push(`stroke="${escapeXmlAttribute(stroke)}"`, `stroke-width="${strokeWidth}"`);
      }
      paths.push(`<path ${attrs.join(" ")} />`);
      return;
    }
    for (const nested of child.childNodes ?? []) visit(nested);
  };

  for (const child of node.childNodes ?? []) visit(child);
  const background = backgroundColor ? `<rect width="100%" height="100%" fill="${escapeXmlAttribute(backgroundColor)}" />` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewportWidth} ${viewportHeight}">${background}${paths.join("")}</svg>`;
}

function scoreIconEntry(entry: { fileName: string; uncompressedSize: number }, appName?: string) {
  const fullName = entry.fileName.replace(/\\/g, "/");
  const lower = fullName.toLowerCase();
  if (!/\.(png|webp|jpe?g)$/.test(lower)) return Number.NEGATIVE_INFINITY;
  if (!lower.startsWith("res/")) return Number.NEGATIVE_INFINITY;
  if (lower.endsWith(".9.png")) return Number.NEGATIVE_INFINITY;

  const base = path.basename(lower, path.extname(lower));
  let score = 0;

  if (lower.includes("/mipmap")) score += 50;
  if (lower.includes("/drawable")) score += 22;
  if (lower.includes("xxxhdpi")) score += 34;
  else if (lower.includes("xxhdpi")) score += 28;
  else if (lower.includes("xhdpi")) score += 20;
  else if (lower.includes("hdpi")) score += 14;
  else if (lower.includes("mdpi")) score += 8;

  if (base === "ic_launcher") score += 120;
  if (base === "ic_launcher_round") score += 95;
  if (base === "ic_launcher_foreground") score += 88;
  if (base === "ic_launcher_background") score += 8;
  if (base.includes("ic_launcher")) score += 78;
  if (base.includes("launcher")) score += 36;
  if (base.includes("launcher_icon")) score += 76;
  if (base.includes("app_icon")) score += 72;
  if (base.includes("logo")) score += 20;
  if (base === "icon" || base.endsWith("_icon")) score += 42;
  if (base.includes("foreground")) score += 18;
  if (base.includes("background")) score -= 18;
  if (base.includes("monochrome")) score -= 30;
  if (base.includes("notification")) score -= 70;
  if (base.includes("badge")) score -= 42;
  if (base.includes("splash")) score -= 44;
  if (base.includes("banner")) score -= 35;
  if (base.includes("preview")) score -= 28;
  if (base.includes("toolbar") || base.includes("actionbar")) score -= 28;

  const appTokens = normalizeIconToken(appName || "")
    .split("_")
    .filter((token) => token.length > 2);
  for (const token of appTokens.slice(0, 4)) {
    if (base.includes(token)) score += 12;
  }

  if (entry.uncompressedSize > 4_000) score += Math.min(18, Math.round(entry.uncompressedSize / 28_000));
  return score;
}

function parseUnzipListing(output: string) {
  return output
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(\d+)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+(.+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({ uncompressedSize: Number.parseInt(match[1], 10) || 0, fileName: match[2].trim() }))
    .filter((entry) => entry.fileName && !entry.fileName.endsWith("/"));
}

function listZipEntries(filePath: string) {
  return new Promise<yauzl.Entry[]>((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError || !zipFile) {
        reject(openError || new Error("Could not open APK."));
        return;
      }
      const entries: yauzl.Entry[] = [];
      zipFile.readEntry();
      zipFile.on("entry", (entry) => {
        entries.push(entry);
        zipFile.readEntry();
      });
      zipFile.on("end", () => {
        zipFile.close();
        resolve(entries);
      });
      zipFile.on("error", (error) => {
        zipFile.close();
        reject(error);
      });
    });
  });
}

function readZipEntry(filePath: string, entryName: string) {
  return new Promise<Buffer>((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError || !zipFile) {
        reject(openError || new Error("Could not open APK."));
        return;
      }
      zipFile.readEntry();
      zipFile.on("entry", (entry) => {
        if (entry.fileName !== entryName) {
          zipFile.readEntry();
          return;
        }
        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            zipFile.close();
            reject(streamError || new Error("Could not read icon from APK."));
            return;
          }
          const chunks: Buffer[] = [];
          stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          stream.on("end", () => {
            zipFile.close();
            resolve(Buffer.concat(chunks));
          });
          stream.on("error", (error) => {
            zipFile.close();
            reject(error);
          });
        });
      });
      zipFile.on("end", () => {
        zipFile.close();
        reject(new Error("No suitable icon found in APK."));
      });
      zipFile.on("error", (error) => {
        zipFile.close();
        reject(error);
      });
    });
  });
}

async function extractBestIconDataUrl(apkPath: string, appName?: string) {
  const entries = await listZipEntries(apkPath);
  const best = entries
    .map((entry) => ({ entry, score: scoreIconEntry(entry, appName) }))
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((left, right) => right.score - left.score)[0];

  if (!best || best.score < 20) return null;
  const content = await readZipEntry(apkPath, best.entry.fileName);
  return {
    source: best.entry.fileName,
    dataUrl: `data:${mimeFromIconPath(best.entry.fileName)};base64,${content.toString("base64")}`
  };
}

async function extractManifestIconDataUrl(apkPath: string) {
  const originalWarn = console.warn;
  try {
    console.warn = () => undefined;
    const result = await new ApkParser(apkPath).parse();
    const icon = typeof result.icon === "string" ? result.icon : "";
    const [, base64 = ""] = icon.match(/^data:image\/(?:png|webp|jpeg|jpg);base64,(.+)$/i) ?? [];
    if (base64 && rasterMimeFromBuffer(Buffer.from(base64, "base64"))) {
      return { source: "manifest application icon", dataUrl: icon };
    }
  } catch {
    // Some split APKs do not contain a complete manifest/resource table. The filename scanner below is the fallback.
  } finally {
    console.warn = originalWarn;
  }
  return null;
}

function parseApkResources(manifest: Buffer, resources: Buffer) {
  const originalWarn = console.warn;
  try {
    console.warn = () => undefined;
    const apkInfo = new ManifestXmlParser(manifest, {
      ignore: ["application.activity", "application.service", "application.receiver", "application.provider", "permission-group"]
    }).parse();
    const resourceMap = new ResourceFinder().processResourceTable(resources);
    return { iconPath: findApkIconPath(mapInfoResource(apkInfo, resourceMap)), resourceMap };
  } finally {
    console.warn = originalWarn;
  }
}

async function readRemoteApkEntry(selectedDevice: string | undefined, remoteApk: string, entryName: string, timeoutMs = 30000) {
  const command = `unzip -p ${shQuote(remoteApk)} ${shQuote(entryName)}`;
  const result = await runFileBuffer(adbExe, adbCommandArgs(selectedDevice, ["exec-out", "sh", "-c", command]), scrcpyDir, timeoutMs);
  if (result.exitCode !== 0 || result.stdout.length === 0) {
    const message = result.stderr.toString("utf8").trim() || `Could not read ${entryName}`;
    throw new Error(message);
  }
  return result.stdout;
}

async function extractRemoteDrawableDataUrl(
  selectedDevice: string | undefined,
  remoteApk: string,
  entryName: string,
  resourceMap: unknown,
  depth = 0,
  backgroundColor = ""
): Promise<{ source: string; dataUrl: string } | null> {
  if (depth > 4) return null;
  const content = await readRemoteApkEntry(selectedDevice, remoteApk, entryName, 30000);
  const raster = rasterDataUrlFromBuffer(content, entryName);
  if (raster) return { source: entryName, dataUrl: raster };

  const xml = parseBinaryXml(content);
  if (xml.nodeName === "vector") {
    return { source: `vector ${entryName}`, dataUrl: svgDataUrl(vectorNodeToSvg(xml, backgroundColor)) };
  }

  if (xml.nodeName === "adaptive-icon") {
    const backgroundNode = xml.childNodes?.find((node) => node.nodeName === "background");
    const foregroundNode = xml.childNodes?.find((node) => node.nodeName === "foreground") ?? xml.childNodes?.find((node) => node.nodeName === "monochrome");
    let nextBackground = backgroundColor;
    if (backgroundNode) {
      const drawable = getXmlAttribute(backgroundNode, "drawable");
      const color = colorFromXmlAttribute(drawable, resourceMap);
      if (color) nextBackground = color;
    }
    for (const reference of foregroundNode ? drawableReferencesFromNode(foregroundNode, resourceMap) : []) {
      const extracted = await extractRemoteDrawableDataUrl(selectedDevice, remoteApk, reference, resourceMap, depth + 1, nextBackground).catch(() => null);
      if (extracted) return { source: `${entryName} -> ${extracted.source}`, dataUrl: extracted.dataUrl };
    }
  }

  return null;
}

async function extractRemoteManifestIconDataUrl(selectedDevice: string | undefined, remoteApk: string) {
  const manifest = await readRemoteApkEntry(selectedDevice, remoteApk, "AndroidManifest.xml", 20000);
  const resources = await readRemoteApkEntry(selectedDevice, remoteApk, "resources.arsc", 30000);
  const { iconPath, resourceMap } = parseApkResources(manifest, resources);
  if (!iconPath) return null;
  const extracted = await extractRemoteDrawableDataUrl(selectedDevice, remoteApk, iconPath, resourceMap);
  return extracted ? { source: `manifest ${extracted.source}`, dataUrl: extracted.dataUrl } : null;
}

async function extractRemoteBestIconDataUrl(selectedDevice: string | undefined, remoteApk: string, appName?: string) {
  const command = `unzip -l ${shQuote(remoteApk)}`;
  const result = await runFileBuffer(adbExe, adbCommandArgs(selectedDevice, ["exec-out", "sh", "-c", command]), scrcpyDir, 30000);
  if (result.exitCode !== 0 || result.stdout.length === 0) return null;
  const best = parseUnzipListing(result.stdout.toString("utf8"))
    .map((entry) => ({ entry, score: scoreIconEntry(entry, appName) }))
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((left, right) => right.score - left.score)[0];
  if (!best || best.score < 20) return null;
  const icon = await readRemoteApkEntry(selectedDevice, remoteApk, best.entry.fileName, 30000);
  const raster = rasterDataUrlFromBuffer(icon, best.entry.fileName);
  if (!raster) return null;
  return {
    source: `archive ${best.entry.fileName}`,
    dataUrl: raster
  };
}

async function getAndroidAppIcon(request: AndroidAppIconRequest) {
  const packageName = request.packageName?.trim();
  if (!packageName) throw new Error("Missing package name.");

  const cachePath = appIconCachePath(request.selectedDevice, packageName);
  if (!request.force) {
    try {
      const cached = JSON.parse(await fs.readFile(cachePath, "utf8")) as { packageName: string; dataUrl: string | null; source?: string; version?: number };
      if (cached.packageName === packageName && cached.version === ICON_CACHE_VERSION) return { ...cached, cached: true };
    } catch {
      // Cache misses are expected.
    }
  }

  const pathResult = await runFile(adbExe, adbCommandArgs(request.selectedDevice, ["shell", "pm", "path", packageName]), scrcpyDir, 12000);
  const remoteApks = [pathResult.stdout, pathResult.stderr]
    .join("\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("package:"))
    .map((line) => line.slice("package:".length))
    .sort((left, right) => {
      const leftBase = left.endsWith("/base.apk") ? 0 : 1;
      const rightBase = right.endsWith("/base.apk") ? 0 : 1;
      return leftBase - rightBase;
    });

  if (remoteApks.length === 0) {
    const empty = { packageName, dataUrl: null, source: "", version: ICON_CACHE_VERSION };
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(empty), "utf8");
    return { ...empty, cached: false };
  }

  let bestIcon: { source: string; dataUrl: string } | null = null;
  for (const remoteApk of remoteApks) {
    try {
      const extracted =
        (await extractRemoteManifestIconDataUrl(request.selectedDevice, remoteApk)) ??
        (await extractRemoteBestIconDataUrl(request.selectedDevice, remoteApk, request.name || packageName));
      if (extracted) {
        bestIcon = { source: `${remoteApk}:${extracted.source}`, dataUrl: extracted.dataUrl };
        break;
      }
    } catch (error) {
      sendScrcpyEvent({ type: "log", level: "warn", message: `Remote icon scan failed for ${packageName}: ${String(error)}` });
    }
  }

  const tempDir = path.join(app.getPath("temp"), "scrcpy-studio-icons");
  for (const [index, remoteApk] of remoteApks.entries()) {
    if (bestIcon) break;
    const apkPath = path.join(tempDir, `${safeCacheName(packageName)}-${Date.now()}-${index}.apk`);
    try {
      await fs.mkdir(tempDir, { recursive: true });
      await runFile(adbExe, adbCommandArgs(request.selectedDevice, ["pull", remoteApk, apkPath]), scrcpyDir, 90000);
      const extracted = (await extractManifestIconDataUrl(apkPath)) ?? (await extractBestIconDataUrl(apkPath, request.name || packageName));
      if (extracted) {
        bestIcon = { source: `${remoteApk}:${extracted.source}`, dataUrl: extracted.dataUrl };
        break;
      }
    } catch (error) {
      sendScrcpyEvent({ type: "log", level: "warn", message: `Icon scan failed for ${packageName}: ${String(error)}` });
    } finally {
      await fs.rm(apkPath, { force: true }).catch(() => undefined);
    }
  }

  const cacheValue = bestIcon ? { packageName, ...bestIcon, version: ICON_CACHE_VERSION } : { packageName, dataUrl: null, source: "", version: ICON_CACHE_VERSION };
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(cacheValue), "utf8");
  return { ...cacheValue, cached: false };
}

async function listDevices(): Promise<DeviceInfo[]> {
  const result = await runFile(adbExe, ["devices", "-l"], scrcpyDir, 15000);
  return result.stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state, ...rest] = line.split(/\s+/);
      const details = rest.join(" ");
      const model = details.match(/model:([^\s]+)/)?.[1]?.replace(/_/g, " ");
      return {
        serial,
        state,
        details,
        label: model ? `${model} (${serial})` : `${serial} (${state})`
      };
    });
}

async function runDeviceAction(request: DeviceActionRequest) {
  const args: string[] = [];
  if (request.selectedDevice) args.push("-s", request.selectedDevice);

  if (request.action === "screen-off") {
    args.push("shell", "input", "keyevent", "KEYCODE_SLEEP");
  } else if (request.action === "screen-on") {
    args.push("shell", "input", "keyevent", "KEYCODE_WAKEUP");
  } else {
    throw new Error(`Unsupported device action: ${String(request.action)}`);
  }

  await runFile(adbExe, args, scrcpyDir, 10000);
  sendScrcpyEvent({ type: "device-action", action: request.action });
  return true;
}

function parseScrcpyApps(raw: string): AndroidAppInfo[] {
  const apps: AndroidAppInfo[] = [];
  let pending: { name: string; system: boolean } | null = null;
  const packagePattern = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/;

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    const appLine = line.match(/^\s*([*-])\s+(.+?)(?:\s{2,}([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+))?\s*$/);
    if (appLine) {
      const system = appLine[1] === "*";
      const name = appLine[2].trim();
      const packageName = appLine[3]?.trim();
      if (packageName) {
        apps.push({ name, packageName, system });
        pending = null;
      } else {
        pending = { name, system };
      }
      continue;
    }

    const trimmed = line.trim();
    if (pending && packagePattern.test(trimmed)) {
      apps.push({ name: pending.name, packageName: trimmed, system: pending.system });
      pending = null;
    }
  }

  const seen = new Set<string>();
  return apps
    .filter((appInfo) => {
      if (seen.has(appInfo.packageName)) return false;
      seen.add(appInfo.packageName);
      return true;
    })
    .sort((left, right) => {
      if (left.system !== right.system) return Number(left.system) - Number(right.system);
      return left.name.localeCompare(right.name);
    });
}

async function listAndroidApps(selectedDevice?: string): Promise<AndroidAppInfo[]> {
  const args: string[] = [];
  if (selectedDevice) args.push(`--serial=${selectedDevice}`);
  args.push("--list-apps");
  const result = await runFile(scrcpyExe, args, scrcpyDir, 45000);
  return parseScrcpyApps([result.stdout, result.stderr].filter(Boolean).join("\n"));
}

function listAppSessions(): AppSessionInfo[] {
  return [...appSessions.values()].map((session) => session.info);
}

function buildVirtualDisplayArgs(request: LaunchAndroidAppRequest) {
  const width = Math.max(320, Math.round(request.width || 1280));
  const height = Math.max(320, Math.round(request.height || 960));
  const dpi = Math.max(80, Math.round(request.dpi || 160));
  const args: string[] = [];

  if (request.selectedDevice) args.push(`--serial=${request.selectedDevice}`);
  args.push(`--new-display=${width}x${height}/${dpi}`);
  args.push(`--start-app=${request.forceStop ? "+" : ""}${request.packageName}`);

  if (request.flex !== false) args.push("--flex-display");
  if (request.keepActive !== false) args.push("--keep-active");
  if (request.systemDecorations === false) args.push("--no-vd-system-decorations");
  if (request.noVdDestroyContent) args.push("--no-vd-destroy-content");
  if (request.displayImePolicy === "local") args.push("--display-ime-policy=local");

  if (request.audio === false) {
    args.push("--no-audio");
  } else {
    const audioSource = request.audioSource || "output";
    args.push(`--audio-source=${audioSource}`);
    if (audioSource === "playback" && request.audioDup === true) args.push("--audio-dup");
    if (request.audioCodec) args.push(`--audio-codec=${request.audioCodec}`);
    if (request.audioBitRate) args.push(`--audio-bit-rate=${request.audioBitRate}`);
    if (request.audioBuffer && request.audioBuffer > 0) args.push(`--audio-buffer=${Math.round(request.audioBuffer)}`);
    if (request.audioOutputBuffer && request.audioOutputBuffer > 0) args.push(`--audio-output-buffer=${Math.round(request.audioOutputBuffer)}`);
    if (request.requireAudio !== false) args.push("--require-audio");
  }

  args.push(`--video-codec=${request.videoCodec || "h264"}`);
  args.push(`--video-bit-rate=${request.bitRate || "16M"}`);
  if (request.maxFps && request.maxFps > 0) args.push(`--max-fps=${Math.round(request.maxFps)}`);
  if (request.maxSize && request.maxSize > 0) args.push(`--max-size=${Math.round(request.maxSize)}`);
  if (request.videoBuffer && request.videoBuffer > 0) args.push(`--video-buffer=${Math.round(request.videoBuffer)}`);

  if (request.turnScreenOff) args.push("--turn-screen-off");
  if (request.stayAwake) args.push("--stay-awake");
  if (request.screenOffTimeout && request.screenOffTimeout > 0) args.push(`--screen-off-timeout=${Math.round(request.screenOffTimeout)}`);
  if (request.showTouches) args.push("--show-touches");
  if (request.powerOffOnClose) args.push("--power-off-on-close");
  if (request.noPowerOn) args.push("--no-power-on");
  if (request.alwaysOnTop) args.push("--always-on-top");
  if (request.borderless) args.push("--window-borderless");
  if (request.mouseMode && request.mouseMode !== "default") args.push(`--mouse=${request.mouseMode}`);
  if (request.keyboardMode && request.keyboardMode !== "default") args.push(`--keyboard=${request.keyboardMode}`);
  args.push(`--window-title=${request.name || request.packageName}`);

  return args;
}

async function launchAndroidAppWindow(request: LaunchAndroidAppRequest): Promise<AppSessionInfo> {
  await stopDirectScrcpy();
  const args = buildVirtualDisplayArgs(request);
  const child = spawn(scrcpyExe, args, { cwd: scrcpyDir, windowsHide: false });
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const info: AppSessionInfo = {
    id,
    pid: child.pid,
    name: request.name || request.packageName,
    packageName: request.packageName,
    startedAt: Date.now()
  };

  appSessions.set(id, { process: child, info });
  sendScrcpyEvent({ type: "app-session", action: "started", session: info, command: [scrcpyExe, ...args].map(quoteArg).join(" ") });

  child.stdout.on("data", (chunk) => {
    sendScrcpyEvent({ type: "log", level: "info", message: chunk.toString() });
  });
  child.stderr.on("data", (chunk) => {
    sendScrcpyEvent({ type: "log", level: "info", message: chunk.toString() });
  });
  child.on("error", (error) => {
    sendScrcpyEvent({ type: "app-session", action: "error", session: info, message: error.message });
  });
  child.on("close", (exitCode) => {
    appSessions.delete(id);
    if (!shuttingDown) {
      sendScrcpyEvent({ type: "app-session", action: "stopped", session: info, exitCode });
    }
  });

  return info;
}

async function stopAppSession(sessionId: string) {
  const session = appSessions.get(sessionId);
  if (!session) return false;
  session.process.kill();
  appSessions.delete(sessionId);
  sendScrcpyEvent({ type: "app-session", action: "stopped", session: session.info });
  return true;
}

async function stopAllAppSessions() {
  for (const session of appSessions.values()) {
    session.process.kill();
  }
  appSessions.clear();
  sendScrcpyEvent({ type: "app-session", action: "stopped-all" });
  return true;
}

function createFileReadableStream(filePath: string) {
  return new YReadableStream<Uint8Array>({
    start(controller) {
      const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });
      stream.on("data", (chunk) => {
        controller.enqueue(new Uint8Array(chunk as Buffer));
      });
      stream.on("end", () => controller.close());
      stream.on("error", (error) => controller.error(error));
    }
  });
}

function getProfileState(profile: LaunchProfile, flag: string) {
  return profile.optionState?.[flag];
}

function isFlagEnabled(profile: LaunchProfile, flag: string) {
  return Boolean(getProfileState(profile, flag)?.enabled);
}

function getFlagValue(profile: LaunchProfile, flag: string) {
  const state = getProfileState(profile, flag);
  return state?.enabled ? String(state.value ?? "").trim() : "";
}

function parseIntegerValue(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBitRateValue(value: string, fallback: number) {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)([kKmM])?$/);
  if (!match) return fallback;
  const base = Number.parseFloat(match[1]);
  if (!Number.isFinite(base)) return fallback;
  const suffix = match[2]?.toLowerCase();
  const multiplier = suffix === "m" ? 1_000_000 : suffix === "k" ? 1_000 : 1;
  return Math.round(base * multiplier);
}

function numberValue(value: unknown, fallback: number) {
  const next = typeof value === "number" ? value : Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildDirectOptions(profile: LaunchProfile) {
  const videoCodec = getFlagValue(profile, "--video-codec") || "h264";
  const videoSource = getFlagValue(profile, "--video-source") || "display";
  const displayId = parseIntegerValue(getFlagValue(profile, "--display-id"), 0);
  const maxSize = parseIntegerValue(getFlagValue(profile, "--max-size"), 0);
  const maxFps = parseIntegerValue(getFlagValue(profile, "--max-fps"), 0);
  const videoBitRate = parseBitRateValue(getFlagValue(profile, "--video-bit-rate"), 8_000_000);
  const crop = getFlagValue(profile, "--crop") || undefined;
  const cameraId = getFlagValue(profile, "--camera-id") || undefined;
  const cameraSize = getFlagValue(profile, "--camera-size") || undefined;
  const cameraFacing = getFlagValue(profile, "--camera-facing") || undefined;
  const cameraAr = getFlagValue(profile, "--camera-ar") || undefined;
  const cameraFps = parseIntegerValue(getFlagValue(profile, "--camera-fps"), 0);
  const captureOrientation = getFlagValue(profile, "--capture-orientation") || undefined;

  return new AdbScrcpyOptions4_0(
    {
      video: !isFlagEnabled(profile, "--no-video"),
      audio: false,
      control: !isFlagEnabled(profile, "--no-control"),
      videoCodec: videoCodec as "h264" | "h265" | "av1",
      videoSource: videoSource as "display" | "camera",
      displayId,
      maxSize,
      maxFps,
      videoBitRate,
      crop,
      cameraId,
      cameraSize,
      cameraFacing: cameraFacing as "front" | "back" | "external" | undefined,
      cameraAr,
      cameraFps: cameraFps > 0 ? cameraFps : undefined,
      cameraHighSpeed: isFlagEnabled(profile, "--camera-high-speed"),
      captureOrientation,
      stayAwake: isFlagEnabled(profile, "--stay-awake"),
      showTouches: isFlagEnabled(profile, "--show-touches"),
      powerOn: !isFlagEnabled(profile, "--no-power-on"),
      clipboardAutosync: !isFlagEnabled(profile, "--no-clipboard-autosync"),
      cleanup: !isFlagEnabled(profile, "--no-cleanup"),
      tunnelForward: isFlagEnabled(profile, "--force-adb-forward"),
      sendFrameMeta: true,
      sendCodecMeta: true,
      sendDeviceMeta: true,
      logLevel: "debug"
    },
    { version: "4.0" }
  );
}

async function stopDirectScrcpy() {
  directStreamToken += 1;
  stopDirectAudio();
  if (directScrcpyClient) {
    const client = directScrcpyClient;
    directScrcpyClient = null;
    await client.close().catch(() => undefined);
  }
}

function stopDirectAudio() {
  if (directAudioProcess) {
    directAudioProcess.kill();
    directAudioProcess = null;
    sendScrcpyEvent({ type: "audio", status: "stopped" });
  }
}

function startDirectAudio(profile: LaunchProfile, selectedDevice?: string) {
  stopDirectAudio();
  const args = audioArgsFromProfile(profile, selectedDevice);
  if (!args) {
    sendScrcpyEvent({ type: "audio", status: "disabled" });
    return;
  }

  const child = spawn(scrcpyExe, args, { cwd: scrcpyDir, windowsHide: true });
  directAudioProcess = child;
  sendScrcpyEvent({ type: "audio", status: "starting", command: [scrcpyExe, ...args].map(quoteArg).join(" ") });

  child.stdout.on("data", (chunk) => {
    sendScrcpyEvent({ type: "log", level: "info", message: chunk.toString() });
  });
  child.stderr.on("data", (chunk) => {
    sendScrcpyEvent({ type: "log", level: "info", message: chunk.toString() });
  });
  child.on("error", (error) => {
    sendScrcpyEvent({ type: "audio", status: "error", message: error.message });
  });
  child.on("close", (exitCode) => {
    if (directAudioProcess === child) directAudioProcess = null;
    if (!shuttingDown) {
      sendScrcpyEvent({ type: "audio", status: "stopped", exitCode });
    }
  });
}

async function startDirectScrcpy(profile: LaunchProfile) {
  await stopDirectScrcpy();
  if (scrcpyProcess) {
    scrcpyProcess.kill();
    scrcpyProcess = null;
  }
  embeddedWindowHandle = null;

  await runFile(adbExe, ["start-server"], scrcpyDir, 15000);
  const adbServer = new AdbServerClient(new AdbServerNodeTcpConnector({ host: "127.0.0.1", port: 5037 }));
  const devices = await adbServer.getDevices(["device"]);
  if (devices.length === 0) {
    throw new Error("No authorized Android device is connected. Enable USB debugging and accept the authorization prompt on the phone.");
  }

  const selected = profile.selectedDevice ? devices.find((device) => device.serial === profile.selectedDevice) : devices[0];
  if (!selected) {
    throw new Error(`Selected device was not found: ${profile.selectedDevice}`);
  }

  const adb = await adbServer.createAdb({ serial: selected.serial });
  const token = ++directStreamToken;
  const options = buildDirectOptions(profile);

  sendScrcpyEvent({ type: "status", status: "starting", message: `Pushing scrcpy 4.0 server to ${selected.serial}...` });
  await AdbScrcpyClient.pushServer(adb, createFileReadableStream(scrcpyServerFile), DefaultServerPath);

  sendScrcpyEvent({ type: "status", status: "starting", message: "Starting direct in-app video stream..." });
  const client = await AdbScrcpyClient.start(adb, DefaultServerPath, options);
  directScrcpyClient = client;

  void readDirectOutput(client, token);
  void readDirectExit(client, token);

  const videoStream = await client.videoStream;
  if (!videoStream) {
    throw new Error("scrcpy started without a video stream.");
  }

  sendVideoPacket({
    type: "metadata",
    codec: videoStream.metadata.codec,
    width: videoStream.width || videoStream.metadata.width || 0,
    height: videoStream.height || videoStream.metadata.height || 0,
    deviceName: videoStream.metadata.deviceName ?? selected.model ?? selected.serial
  });
  sendScrcpyEvent({ type: "status", status: "connected", embedded: true, message: "Direct renderer connected." });

  void readDirectVideo(videoStream.stream, token);
  startDirectAudio(profile, selected.serial);
  return { ok: true, pid: undefined, args: ["direct-renderer", selected.serial] };
}

async function readDirectOutput(client: AdbScrcpyClient<AdbScrcpyOptionsLatest<boolean>>, token: number) {
  const reader = client.output.getReader();
  try {
    while (token === directStreamToken) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.trim()) sendScrcpyEvent({ type: "log", level: "info", message: value.trim() });
    }
  } catch (error) {
    if (token === directStreamToken) sendScrcpyEvent({ type: "log", level: "warn", message: String(error) });
  } finally {
    reader.releaseLock();
  }
}

async function readDirectExit(client: AdbScrcpyClient<AdbScrcpyOptionsLatest<boolean>>, token: number) {
  try {
    await client.exited;
  } catch (error) {
    if (token === directStreamToken) sendScrcpyEvent({ type: "status", status: "error", message: String(error) });
    return;
  }
  if (token === directStreamToken && !shuttingDown) {
    directScrcpyClient = null;
    sendScrcpyEvent({ type: "status", status: "stopped" });
  }
}

async function readDirectVideo(stream: YReadableStream<ScrcpyMediaStreamPacket>, token: number) {
  const reader = stream.getReader();
  try {
    while (token === directStreamToken) {
      const { done, value } = await reader.read();
      if (done) break;
      const packet = value as { type: "configuration" | "data"; data: Uint8Array; keyframe?: boolean; pts?: bigint };
      const bytes = new Uint8Array(packet.data);
      const payload = {
        type: "packet",
        packetType: packet.type,
        keyframe: packet.keyframe,
        pts: packet.pts?.toString(),
        data: bytes.buffer
      };
      sendVideoPacket(payload);
    }
  } catch (error) {
    if (token === directStreamToken) sendScrcpyEvent({ type: "status", status: "error", message: String(error) });
  } finally {
    reader.releaseLock();
  }
}

async function sendAndroidKey(keyCode: number) {
  const controller = directScrcpyClient?.controller;
  if (!controller) throw new Error("The active scrcpy session does not have a control channel.");
  const message = {
    keyCode: keyCode as (typeof AndroidKeyCode)[keyof typeof AndroidKeyCode],
    repeat: 0,
    metaState: AndroidKeyEventMeta.None
  };
  await controller.injectKeyCode({ ...message, action: AndroidKeyEventAction.Down });
  await controller.injectKeyCode({ ...message, action: AndroidKeyEventAction.Up });
}

async function sendRawControlMessage(data: Uint8Array) {
  const controller = directScrcpyClient?.controller;
  if (!controller) throw new Error("The active scrcpy session does not have a control channel. Disable --no-control and reconnect.");
  await controller.write(data);
}

async function sendCameraTorch(enabled: boolean) {
  await sendRawControlMessage(new Uint8Array([SCRCPY_CONTROL_CAMERA_SET_TORCH, enabled ? 1 : 0]));
}

async function sendCameraZoom(direction: "in" | "out") {
  await sendRawControlMessage(new Uint8Array([direction === "in" ? SCRCPY_CONTROL_CAMERA_ZOOM_IN : SCRCPY_CONTROL_CAMERA_ZOOM_OUT]));
}

async function sendResizeDisplay(width: number, height: number) {
  const nextWidth = Math.round(clamp(numberValue(width, 0), 1, 65535));
  const nextHeight = Math.round(clamp(numberValue(height, 0), 1, 65535));
  await sendRawControlMessage(
    new Uint8Array([
      SCRCPY_CONTROL_RESIZE_DISPLAY,
      (nextWidth >> 8) & 0xff,
      nextWidth & 0xff,
      (nextHeight >> 8) & 0xff,
      nextHeight & 0xff
    ])
  );
}

async function sendControlRequest(request: ControlRequest) {
  const controller = directScrcpyClient?.controller;
  if (!controller) throw new Error("The active scrcpy session does not have a control channel. Disable --no-control and reconnect.");

  if (request.type === "touch") {
    const videoWidth = Math.max(1, Math.round(numberValue(request.videoWidth, 1)));
    const videoHeight = Math.max(1, Math.round(numberValue(request.videoHeight, 1)));
    const action = numberValue(request.action, AndroidMotionEventAction.Move) as (typeof AndroidMotionEventAction)[keyof typeof AndroidMotionEventAction];
    await controller.injectTouch({
      action,
      pointerId: BigInt(numberValue(request.pointerId, 0)),
      pointerX: Math.round(clamp(numberValue(request.x, 0), 0, videoWidth - 1)),
      pointerY: Math.round(clamp(numberValue(request.y, 0), 0, videoHeight - 1)),
      videoWidth,
      videoHeight,
      pressure: action === AndroidMotionEventAction.Up ? 0 : clamp(numberValue(request.pressure, 1), 0, 1),
      actionButton: Math.round(numberValue(request.actionButton, AndroidMotionEventButton.Primary)),
      buttons: Math.round(numberValue(request.buttons, action === AndroidMotionEventAction.Up ? AndroidMotionEventButton.None : AndroidMotionEventButton.Primary))
    });
    return true;
  }

  if (request.type === "scroll") {
    const videoWidth = Math.max(1, Math.round(numberValue(request.videoWidth, 1)));
    const videoHeight = Math.max(1, Math.round(numberValue(request.videoHeight, 1)));
    await controller.injectScroll({
      pointerX: Math.round(clamp(numberValue(request.x, 0), 0, videoWidth - 1)),
      pointerY: Math.round(clamp(numberValue(request.y, 0), 0, videoHeight - 1)),
      videoWidth,
      videoHeight,
      scrollX: clamp(numberValue(request.scrollX, 0), -1, 1),
      scrollY: clamp(numberValue(request.scrollY, 0), -1, 1),
      buttons: Math.round(numberValue(request.buttons, AndroidMotionEventButton.None))
    });
    return true;
  }

  if (request.type === "key") {
    await sendAndroidKey(numberValue(request.keyCode, 0));
    return true;
  }

  if (request.type === "text") {
    if (request.text) await controller.injectText(request.text);
    return true;
  }

  if (request.type === "resize-display") {
    await sendResizeDisplay(request.width, request.height);
    return true;
  }

  switch (request.action) {
    case "back":
      await sendAndroidKey(AndroidKeyCode.AndroidBack);
      break;
    case "home":
      await sendAndroidKey(AndroidKeyCode.AndroidHome);
      break;
    case "app-switch":
      await sendAndroidKey(AndroidKeyCode.AndroidAppSwitch);
      break;
    case "power":
      await sendAndroidKey(AndroidKeyCode.Power);
      break;
    case "volume-up":
      await sendAndroidKey(AndroidKeyCode.VolumeUp);
      break;
    case "volume-down":
      await sendAndroidKey(AndroidKeyCode.VolumeDown);
      break;
    case "rotate":
      await controller.rotateDevice();
      break;
    case "notifications":
      await controller.expandNotificationPanel();
      break;
    case "settings":
      await controller.expandSettingPanel();
      break;
    case "screen-off":
      await controller.setScreenPowerMode(AndroidScreenPowerMode.Off);
      break;
    case "screen-on":
      await controller.setScreenPowerMode(AndroidScreenPowerMode.Normal);
      break;
    case "camera-torch-on":
      await sendCameraTorch(true);
      break;
    case "camera-torch-off":
      await sendCameraTorch(false);
      break;
    case "camera-zoom-in":
      await sendCameraZoom("in");
      break;
    case "camera-zoom-out":
      await sendCameraZoom("out");
      break;
  }

  return true;
}

function powershell(command: string, timeoutMs = 8000) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout.trim());
      }
    );
  });
}

function win32ApiScript() {
  return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ScrcpyStudioWin32 {
  [DllImport("user32.dll")] public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
`;
}

function getNativeHandle(window: BrowserWindow) {
  const buffer = window.getNativeWindowHandle();
  return process.arch === "x64" || process.arch === "arm64" ? buffer.readBigUInt64LE(0).toString() : buffer.readUInt32LE(0).toString();
}

async function embedScrcpyWindow(pid: number) {
  if (process.platform !== "win32" || !mainWindow) return null;
  const parentHandle = getNativeHandle(mainWindow);
  const bounds = mainWindow.getContentBounds();
  const childHeight = Math.max(1, bounds.height - controlsHeight);
  const script = `
$ErrorActionPreference = "Stop"
${win32ApiScript()}
$parent = [IntPtr]${parentHandle}
$child = [IntPtr]::Zero
$deadline = (Get-Date).AddSeconds(8)
while ((Get-Date) -lt $deadline) {
  $process = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
  if ($process -and $process.MainWindowHandle -ne 0) {
    $child = $process.MainWindowHandle
    break
  }
  Start-Sleep -Milliseconds 120
}
if ($child -eq [IntPtr]::Zero) { throw "scrcpy window was not created" }
$GWL_STYLE = -16
$WS_CHILD = 0x40000000
$WS_VISIBLE = 0x10000000
$WS_CAPTION = 0x00C00000
$WS_THICKFRAME = 0x00040000
$WS_MINIMIZEBOX = 0x00020000
$WS_MAXIMIZEBOX = 0x00010000
$WS_SYSMENU = 0x00080000
$style = [ScrcpyStudioWin32]::GetWindowLong($child, $GWL_STYLE)
$style = ($style -bor $WS_CHILD -bor $WS_VISIBLE) -band (-bnot ($WS_CAPTION -bor $WS_THICKFRAME -bor $WS_MINIMIZEBOX -bor $WS_MAXIMIZEBOX -bor $WS_SYSMENU))
[void][ScrcpyStudioWin32]::SetWindowLong($child, $GWL_STYLE, $style)
[void][ScrcpyStudioWin32]::SetParent($child, $parent)
[void][ScrcpyStudioWin32]::ShowWindow($child, 5)
[void][ScrcpyStudioWin32]::MoveWindow($child, 0, 0, ${bounds.width}, ${childHeight}, $true)
[Console]::Write($child.ToInt64())
`;
  const handle = await powershell(script, 10000);
  embeddedWindowHandle = handle;
  return handle;
}

async function resizeEmbeddedWindow() {
  if (process.platform !== "win32" || !mainWindow || !embeddedWindowHandle) return;
  const bounds = mainWindow.getContentBounds();
  const childHeight = Math.max(1, bounds.height - controlsHeight);
  const script = `
$ErrorActionPreference = "Stop"
${win32ApiScript()}
$child = [IntPtr]${embeddedWindowHandle}
[void][ScrcpyStudioWin32]::MoveWindow($child, 0, 0, ${bounds.width}, ${childHeight}, $true)
`;
  try {
    await powershell(script, 4000);
  } catch (error) {
    sendScrcpyEvent({ type: "log", level: "warn", message: `Could not resize embedded scrcpy window: ${String(error)}` });
  }
}

async function startNativeScrcpy(profile: LaunchProfile) {
  await stopDirectScrcpy();
  stopDirectAudio();
  if (scrcpyProcess) {
    scrcpyProcess.kill();
    scrcpyProcess = null;
  }
  embeddedWindowHandle = null;

  const sessionTitle = `scrcpy Studio ${Date.now()}`;
  const args = buildArgs(profile, sessionTitle);
  sendScrcpyEvent({ type: "status", status: "starting", command: [scrcpyExe, ...args].map(quoteArg).join(" ") });

  scrcpyProcess = spawn(scrcpyExe, args, { cwd: scrcpyDir, windowsHide: false });
  const pid = scrcpyProcess.pid;

  scrcpyProcess.stdout.on("data", (chunk) => {
    sendScrcpyEvent({ type: "log", level: "info", message: chunk.toString() });
  });
  scrcpyProcess.stderr.on("data", (chunk) => {
    sendScrcpyEvent({ type: "log", level: "info", message: chunk.toString() });
  });
  scrcpyProcess.on("error", (error) => {
    sendScrcpyEvent({ type: "status", status: "error", message: error.message });
  });
  scrcpyProcess.on("close", (exitCode) => {
    scrcpyProcess = null;
    embeddedWindowHandle = null;
    if (!shuttingDown) {
      sendScrcpyEvent({ type: "status", status: "stopped", exitCode });
    }
  });

  const disablesWindow = args.includes("--no-window") || args.includes("--no-video-playback") || args.includes("--no-playback") || args.includes("--otg");
  if (profile.embedWindow && !disablesWindow && pid) {
    try {
      const handle = await embedScrcpyWindow(pid);
      sendScrcpyEvent({ type: "status", status: "connected", embedded: Boolean(handle) });
    } catch (error) {
      sendScrcpyEvent({ type: "status", status: "connected", embedded: false, message: String(error) });
    }
  } else {
    sendScrcpyEvent({ type: "status", status: "connected", embedded: false });
  }

  return { ok: true, pid, args };
}

function createWindow() {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: "#08090b",
    title: "KairoMirror",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (useDevServer) {
    mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    mainWindow.loadFile(path.join(projectRoot, "dist", "index.html"));
  }
  mainWindow.removeMenu();
  mainWindow.setMenuBarVisibility(false);

  mainWindow.on("resize", () => {
    void resizeEmbeddedWindow();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function loadAppWindow(window: BrowserWindow, mode?: string) {
  if (useDevServer) {
    const suffix = mode ? `?mode=${encodeURIComponent(mode)}` : "";
    await window.loadURL(`http://127.0.0.1:5173${suffix}`);
  } else {
    await window.loadFile(path.join(projectRoot, "dist", "index.html"), mode ? { query: { mode } } : undefined);
  }
}

async function openMirrorWindow(request: MirrorWindowRequest) {
  if (!mirrorWindow) {
    mirrorWindow = new BrowserWindow({
      width: 430,
      height: 860,
      minWidth: 320,
      minHeight: 420,
      backgroundColor: "#020303",
      title: "Phone Mirror",
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });
    mirrorWindow.removeMenu();
    mirrorWindow.setMenuBarVisibility(false);
    mirrorWindow.on("closed", () => {
      mirrorWindow = null;
      void stopDirectScrcpy();
    });
    await loadAppWindow(mirrorWindow, "mirror");
  } else {
    mirrorWindow.show();
    mirrorWindow.focus();
  }

  mirrorWindow.webContents.send("mirror:start", request.profile);
  return true;
}

ipcMain.handle("app:info", () => ({
  name: "KairoMirror",
  scrcpyPath: scrcpyExe,
  scrcpyDir,
  version: "4.0",
  platform: process.platform,
  appVersion: app.getVersion()
}));

ipcMain.handle("app:open-external", async (_event, url: string) => {
  await shell.openExternal(url);
});

ipcMain.handle("settings:load", async () => {
  return loadPersistedSettings();
});

ipcMain.handle("settings:save", async (_event, settings: unknown) => {
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2), "utf8");
  return true;
});

ipcMain.handle("scrcpy:list-devices", async () => listDevices());

ipcMain.handle("scrcpy:list-apps", async (_event, selectedDevice?: string) => listAndroidApps(selectedDevice));

ipcMain.handle("scrcpy:get-app-icon", async (_event, request: AndroidAppIconRequest) => getAndroidAppIcon(request));

ipcMain.handle("scrcpy:launch-app", async (_event, request: LaunchAndroidAppRequest) => launchAndroidAppWindow(request));

ipcMain.handle("mirror:open", async (_event, request: MirrorWindowRequest) => openMirrorWindow(request));

ipcMain.handle("mirror:fit", async (_event, request: MirrorFitRequest) => {
  fitMirrorWindowToVideo(Math.round(numberValue(request?.width, 0)), Math.round(numberValue(request?.height, 0)));
  return true;
});

ipcMain.handle("scrcpy:list-app-sessions", () => listAppSessions());

ipcMain.handle("scrcpy:stop-app-session", async (_event, sessionId: string) => stopAppSession(sessionId));

ipcMain.handle("scrcpy:stop-all-app-sessions", async () => stopAllAppSessions());

ipcMain.handle("scrcpy:start", async (_event, profile: LaunchProfile) => {
  try {
    if (profile?.embedWindow === false) return await startNativeScrcpy(profile);
    return await startDirectScrcpy(profile);
  } catch (error) {
    sendScrcpyEvent({ type: "status", status: "error", message: String(error) });
    throw error;
  }
});

ipcMain.handle("scrcpy:start-native", async (_event, profile: LaunchProfile) => {
  return startNativeScrcpy(profile);
});

ipcMain.handle("scrcpy:stop", async () => {
  await stopDirectScrcpy();
  await stopVirtualCameraStream();
  if (scrcpyProcess) {
    scrcpyProcess.kill();
    scrcpyProcess = null;
  }
  embeddedWindowHandle = null;
  sendScrcpyEvent({ type: "status", status: "stopped" });
  return true;
});

ipcMain.handle("scrcpy:control", async (_event, request: ControlRequest) => sendControlRequest(request));

ipcMain.handle("scrcpy:utility", async (_event, request: UtilityRequest) => {
  const args: string[] = [];
  if (request.selectedDevice) args.push(`--serial=${request.selectedDevice}`);
  args.push(request.flag);
  const result = await runFile(scrcpyExe, args, scrcpyDir, 30000);
  return {
    output: [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n"),
    exitCode: result.exitCode
  };
});

ipcMain.handle("scrcpy:device-action", async (_event, request: DeviceActionRequest) => runDeviceAction(request));

ipcMain.handle("virtualcam:status", async () => getVirtualCameraStatus());

ipcMain.handle("virtualcam:install", async () => registerVirtualCamera("install"));

ipcMain.handle("virtualcam:uninstall", async () => registerVirtualCamera("uninstall"));

ipcMain.handle("virtualcam:start", async (_event, request: VirtualCameraStartRequest) => startVirtualCameraStream(request));

ipcMain.handle("virtualcam:frame", async (_event, request: VirtualCameraFrameRequest) => sendVirtualCameraFrame(request));

ipcMain.handle("virtualcam:stop", async () => stopVirtualCameraStream());

ipcMain.handle("window:set-controls-height", async (_event, height: number) => {
  controlsHeight = Math.max(0, Math.round(height));
  await resizeEmbeddedWindow();
  return true;
});

ipcMain.handle("updates:check", async () => checkForUpdates("manual"));

ipcMain.handle("updates:install", () => {
  autoUpdater.quitAndInstall(false, true);
  return true;
});

configureAutoUpdater();

app.whenReady().then(() => {
  createWindow();
  void checkForUpdatesOnStartup();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  shuttingDown = true;
  void stopDirectScrcpy();
  stopDirectAudio();
  void stopVirtualCameraStream();
  void stopAllAppSessions();
  if (scrcpyProcess) scrcpyProcess.kill();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
