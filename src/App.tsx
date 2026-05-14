import {
  AppWindow,
  ArrowLeft,
  Camera,
  ChevronRight,
  Flashlight,
  FlipHorizontal2,
  Home,
  Monitor,
  PanelBottom,
  Play,
  Power,
  RotateCcw,
  RefreshCw,
  RotateCw,
  Search,
  Settings,
  SlidersHorizontal,
  Smartphone,
  Square,
  SwitchCamera,
  Volume2,
  VolumeX,
  Wrench,
  X,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ScrcpyVideoCodecId, type ScrcpyMediaStreamPacket } from "@yume-chan/scrcpy";
import { WebCodecsVideoDecoder, type VideoFrameRenderer } from "@yume-chan/scrcpy-decoder-webcodecs";
import offlineCameraImageUrl from "./assets/virtual-camera-offline.png";

type ViewId = "mirror" | "apps" | "sessions" | "settings" | "camera" | "tools";
type AppFilter = "all" | "user" | "system";
type LogLevel = "info" | "warn" | "error";
type VideoCodec = "h264" | "h265" | "av1";
type AudioSource =
  | "output"
  | "playback"
  | "mic"
  | "mic-unprocessed"
  | "mic-camcorder"
  | "mic-voice-recognition"
  | "mic-voice-communication"
  | "voice-call"
  | "voice-call-uplink"
  | "voice-call-downlink"
  | "voice-performance";
type AudioCodec = "opus" | "aac" | "flac" | "raw";
type InputMode = "default" | "sdk" | "uhid" | "disabled";
type DisplayImePolicy = "default" | "local";
type CameraFacing = "auto" | "front" | "back" | "external";
type CameraOrientation = "0" | "90" | "180" | "270" | "flip0" | "flip90" | "flip180" | "flip270";

interface DeviceInfo {
  serial: string;
  state: string;
  details: string;
  label: string;
}

interface AndroidAppInfo {
  name: string;
  packageName: string;
  system: boolean;
}

interface AppSessionInfo {
  id: string;
  pid?: number;
  name: string;
  packageName: string;
  startedAt: number;
}

interface LauncherSettings {
  selectedDevice: string;
  width: number;
  height: number;
  dpi: number;
  flex: boolean;
  keepActive: boolean;
  forceStop: boolean;
  audio: boolean;
  audioDup: boolean;
  audioSource: AudioSource;
  audioCodec: AudioCodec;
  audioBitRate: string;
  audioBuffer: number;
  audioOutputBuffer: number;
  requireAudio: boolean;
  systemDecorations: boolean;
  noVdDestroyContent: boolean;
  displayImePolicy: DisplayImePolicy;
  videoCodec: VideoCodec;
  bitRate: string;
  maxFps: number;
  maxSize: number;
  videoBuffer: number;
  turnScreenOff: boolean;
  stayAwake: boolean;
  screenOffTimeout: number;
  showTouches: boolean;
  powerOffOnClose: boolean;
  noPowerOn: boolean;
  alwaysOnTop: boolean;
  borderless: boolean;
  mouseMode: InputMode;
  keyboardMode: InputMode;
  cameraFacing: CameraFacing;
  cameraId: string;
  cameraSize: string;
  cameraAr: string;
  cameraFps: number;
  cameraHighSpeed: boolean;
  cameraTorch: boolean;
  cameraZoom: string;
  cameraOrientation: CameraOrientation;
  cameraAudio: boolean;
  cameraAudioSource: AudioSource;
  cameraNoAudioPlayback: boolean;
  v4l2Sink: string;
  v4l2Buffer: number;
  v4l2NoPlayback: boolean;
  appFilter: AppFilter;
  checkForUpdates: boolean;
}

interface StudioLog {
  id: string;
  level: LogLevel;
  message: string;
  time: string;
}

interface VirtualCameraStatus {
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
}

interface VirtualCameraBridge {
  active: boolean;
  targetWidth: number;
  targetHeight: number;
  targetFps: number;
  transform: CameraTransform;
  decoder: WebCodecsVideoDecoder | null;
  writer: { write: (packet: ScrcpyMediaStreamPacket) => Promise<void>; releaseLock?: () => void } | null;
  renderer: VirtualCameraFrameRenderer | null;
  offlineTimer: number | null;
}

interface DisplayPreset {
  id: string;
  name: string;
  width: number;
  height: number;
  dpi: number;
}

interface CameraTransform {
  rotation: 0 | 90 | 180 | 270;
  flipHorizontal: boolean;
}

const studioApi = window.scrcpyStudio;

const DEFAULT_SETTINGS: LauncherSettings = {
  selectedDevice: "",
  width: 1280,
  height: 960,
  dpi: 160,
  flex: true,
  keepActive: true,
  forceStop: false,
  audio: true,
  audioDup: false,
  audioSource: "output",
  audioCodec: "opus",
  audioBitRate: "128K",
  audioBuffer: 50,
  audioOutputBuffer: 50,
  requireAudio: true,
  systemDecorations: true,
  noVdDestroyContent: false,
  displayImePolicy: "default",
  videoCodec: "h264",
  bitRate: "16M",
  maxFps: 0,
  maxSize: 0,
  videoBuffer: 0,
  turnScreenOff: false,
  stayAwake: true,
  screenOffTimeout: 0,
  showTouches: false,
  powerOffOnClose: false,
  noPowerOn: false,
  alwaysOnTop: false,
  borderless: false,
  mouseMode: "default",
  keyboardMode: "default",
  cameraFacing: "auto",
  cameraId: "",
  cameraSize: "1920x1080",
  cameraAr: "",
  cameraFps: 30,
  cameraHighSpeed: false,
  cameraTorch: false,
  cameraZoom: "",
  cameraOrientation: "0",
  cameraAudio: true,
  cameraAudioSource: "mic",
  cameraNoAudioPlayback: false,
  v4l2Sink: "/dev/video2",
  v4l2Buffer: 0,
  v4l2NoPlayback: true,
  appFilter: "user",
  checkForUpdates: true
};

const DISPLAY_PRESETS: DisplayPreset[] = [
  { id: "tablet", name: "Tablet", width: 1280, height: 960, dpi: 160 },
  { id: "desktop", name: "Desktop", width: 1920, height: 1080, dpi: 240 },
  { id: "phone", name: "Phone", width: 1080, height: 2340, dpi: 420 }
];

const FILTERS: Array<{ id: AppFilter; label: string }> = [
  { id: "user", label: "User" },
  { id: "system", label: "System" },
  { id: "all", label: "All" }
];

const PAGE_SIZE = 36;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function coerceNumber(value: unknown, fallback: number, min: number, max: number) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numberValue)));
}

function coerceBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function coerceCodec(value: unknown): VideoCodec {
  return value === "h265" || value === "av1" ? value : "h264";
}

function coerceAudioSource(value: unknown): AudioSource {
  const sources: AudioSource[] = [
    "output",
    "playback",
    "mic",
    "mic-unprocessed",
    "mic-camcorder",
    "mic-voice-recognition",
    "mic-voice-communication",
    "voice-call",
    "voice-call-uplink",
    "voice-call-downlink",
    "voice-performance"
  ];
  return sources.includes(value as AudioSource) ? (value as AudioSource) : "output";
}

function coerceAudioCodec(value: unknown): AudioCodec {
  return value === "aac" || value === "flac" || value === "raw" ? value : "opus";
}

function coerceInputMode(value: unknown): InputMode {
  return value === "sdk" || value === "uhid" || value === "disabled" ? value : "default";
}

function coerceImePolicy(value: unknown): DisplayImePolicy {
  return value === "local" ? "local" : "default";
}

function coerceCameraFacing(value: unknown): CameraFacing {
  return value === "front" || value === "back" || value === "external" ? value : "auto";
}

function coerceCameraOrientation(value: unknown): CameraOrientation {
  const orientations: CameraOrientation[] = ["0", "90", "180", "270", "flip0", "flip90", "flip180", "flip270"];
  return orientations.includes(value as CameraOrientation) ? (value as CameraOrientation) : "0";
}

function cameraTransformFromOrientation(value: CameraOrientation): CameraTransform {
  const flipHorizontal = value.startsWith("flip");
  const rotation = Number.parseInt(value.replace("flip", ""), 10) as CameraTransform["rotation"];
  return {
    rotation: rotation === 90 || rotation === 180 || rotation === 270 ? rotation : 0,
    flipHorizontal
  };
}

function nextCameraOrientation(current: CameraOrientation, delta: 90 | -90): CameraOrientation {
  const transform = cameraTransformFromOrientation(current);
  const values: Array<CameraTransform["rotation"]> = [0, 90, 180, 270];
  const currentIndex = values.indexOf(transform.rotation);
  const nextIndex = (currentIndex + (delta > 0 ? 1 : -1) + values.length) % values.length;
  const nextRotation = values[nextIndex];
  return `${transform.flipHorizontal ? "flip" : ""}${nextRotation}` as CameraOrientation;
}

function flippedCameraOrientation(current: CameraOrientation): CameraOrientation {
  const transform = cameraTransformFromOrientation(current);
  return `${transform.flipHorizontal ? "" : "flip"}${transform.rotation}` as CameraOrientation;
}

function coerceFilter(value: unknown): AppFilter {
  return value === "all" || value === "system" || value === "user" ? value : "user";
}

function normalizeSettings(value: unknown): LauncherSettings {
  if (!isRecord(value)) return DEFAULT_SETTINGS;

  return {
    selectedDevice: typeof value.selectedDevice === "string" ? value.selectedDevice : DEFAULT_SETTINGS.selectedDevice,
    width: coerceNumber(value.width, DEFAULT_SETTINGS.width, 320, 7680),
    height: coerceNumber(value.height, DEFAULT_SETTINGS.height, 320, 7680),
    dpi: coerceNumber(value.dpi, DEFAULT_SETTINGS.dpi, 80, 960),
    flex: coerceBoolean(value.flex, DEFAULT_SETTINGS.flex),
    keepActive: coerceBoolean(value.keepActive, DEFAULT_SETTINGS.keepActive),
    forceStop: coerceBoolean(value.forceStop, DEFAULT_SETTINGS.forceStop),
    audio: coerceBoolean(value.audio, DEFAULT_SETTINGS.audio),
    audioDup: coerceBoolean(value.audioDup, DEFAULT_SETTINGS.audioDup),
    audioSource: coerceAudioSource(value.audioSource),
    audioCodec: coerceAudioCodec(value.audioCodec),
    audioBitRate: typeof value.audioBitRate === "string" && value.audioBitRate.trim() ? value.audioBitRate.trim() : DEFAULT_SETTINGS.audioBitRate,
    audioBuffer: coerceNumber(value.audioBuffer, DEFAULT_SETTINGS.audioBuffer, 0, 2000),
    audioOutputBuffer: coerceNumber(value.audioOutputBuffer, DEFAULT_SETTINGS.audioOutputBuffer, 0, 2000),
    requireAudio: coerceBoolean(value.requireAudio, DEFAULT_SETTINGS.requireAudio),
    systemDecorations: coerceBoolean(value.systemDecorations, DEFAULT_SETTINGS.systemDecorations),
    noVdDestroyContent: coerceBoolean(value.noVdDestroyContent, DEFAULT_SETTINGS.noVdDestroyContent),
    displayImePolicy: coerceImePolicy(value.displayImePolicy),
    videoCodec: coerceCodec(value.videoCodec),
    bitRate: typeof value.bitRate === "string" && value.bitRate.trim() ? value.bitRate.trim() : DEFAULT_SETTINGS.bitRate,
    maxFps: coerceNumber(value.maxFps, DEFAULT_SETTINGS.maxFps, 0, 240),
    maxSize: coerceNumber(value.maxSize, DEFAULT_SETTINGS.maxSize, 0, 7680),
    videoBuffer: coerceNumber(value.videoBuffer, DEFAULT_SETTINGS.videoBuffer, 0, 2000),
    turnScreenOff: coerceBoolean(value.turnScreenOff, DEFAULT_SETTINGS.turnScreenOff),
    stayAwake: coerceBoolean(value.stayAwake, DEFAULT_SETTINGS.stayAwake),
    screenOffTimeout: coerceNumber(value.screenOffTimeout, DEFAULT_SETTINGS.screenOffTimeout, 0, 86400),
    showTouches: coerceBoolean(value.showTouches, DEFAULT_SETTINGS.showTouches),
    powerOffOnClose: coerceBoolean(value.powerOffOnClose, DEFAULT_SETTINGS.powerOffOnClose),
    noPowerOn: coerceBoolean(value.noPowerOn, DEFAULT_SETTINGS.noPowerOn),
    alwaysOnTop: coerceBoolean(value.alwaysOnTop, DEFAULT_SETTINGS.alwaysOnTop),
    borderless: coerceBoolean(value.borderless, DEFAULT_SETTINGS.borderless),
    mouseMode: coerceInputMode(value.mouseMode),
    keyboardMode: coerceInputMode(value.keyboardMode),
    cameraFacing: coerceCameraFacing(value.cameraFacing),
    cameraId: typeof value.cameraId === "string" ? value.cameraId : DEFAULT_SETTINGS.cameraId,
    cameraSize: typeof value.cameraSize === "string" ? value.cameraSize : DEFAULT_SETTINGS.cameraSize,
    cameraAr: typeof value.cameraAr === "string" ? value.cameraAr : DEFAULT_SETTINGS.cameraAr,
    cameraFps: coerceNumber(value.cameraFps, DEFAULT_SETTINGS.cameraFps, 0, 240),
    cameraHighSpeed: coerceBoolean(value.cameraHighSpeed, DEFAULT_SETTINGS.cameraHighSpeed),
    cameraTorch: coerceBoolean(value.cameraTorch, DEFAULT_SETTINGS.cameraTorch),
    cameraZoom: typeof value.cameraZoom === "string" ? value.cameraZoom : DEFAULT_SETTINGS.cameraZoom,
    cameraOrientation: coerceCameraOrientation(value.cameraOrientation),
    cameraAudio: coerceBoolean(value.cameraAudio, DEFAULT_SETTINGS.cameraAudio),
    cameraAudioSource: coerceAudioSource(value.cameraAudioSource),
    cameraNoAudioPlayback: coerceBoolean(value.cameraNoAudioPlayback, DEFAULT_SETTINGS.cameraNoAudioPlayback),
    v4l2Sink: typeof value.v4l2Sink === "string" && value.v4l2Sink.trim() ? value.v4l2Sink.trim() : DEFAULT_SETTINGS.v4l2Sink,
    v4l2Buffer: coerceNumber(value.v4l2Buffer, DEFAULT_SETTINGS.v4l2Buffer, 0, 2000),
    v4l2NoPlayback: coerceBoolean(value.v4l2NoPlayback, DEFAULT_SETTINGS.v4l2NoPlayback),
    appFilter: coerceFilter(value.appFilter),
    checkForUpdates: coerceBoolean(value.checkForUpdates, DEFAULT_SETTINGS.checkForUpdates)
  };
}

function getInitials(name: string) {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

function formatTime(value: number) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function stableHue(text: string) {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function parseSize(value: string, fallbackWidth: number, fallbackHeight: number) {
  const match = value.trim().match(/^(\d+)x(\d+)$/i);
  if (!match) return { width: fallbackWidth, height: fallbackHeight };
  const width = Math.max(2, Number.parseInt(match[1], 10));
  const height = Math.max(2, Number.parseInt(match[2], 10));
  return {
    width: width % 2 === 0 ? width : width - 1,
    height: height % 2 === 0 ? height : height - 1
  };
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function rgbaToNv12(rgba: Uint8ClampedArray, width: number, height: number) {
  const ySize = width * height;
  const nv12 = new Uint8Array(Math.round(ySize * 1.5));

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const rgbaIndex = (row + x) * 4;
      const r = rgba[rgbaIndex];
      const g = rgba[rgbaIndex + 1];
      const b = rgba[rgbaIndex + 2];
      nv12[row + x] = clampByte(0.257 * r + 0.504 * g + 0.098 * b + 16);
    }
  }

  for (let y = 0; y < height; y += 2) {
    const uvRow = ySize + (y / 2) * width;
    for (let x = 0; x < width; x += 2) {
      let u = 0;
      let v = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const rgbaIndex = ((y + dy) * width + x + dx) * 4;
          const r = rgba[rgbaIndex];
          const g = rgba[rgbaIndex + 1];
          const b = rgba[rgbaIndex + 2];
          u += -0.148 * r - 0.291 * g + 0.439 * b + 128;
          v += 0.439 * r - 0.368 * g - 0.071 * b + 128;
        }
      }
      nv12[uvRow + x] = clampByte(u / 4);
      nv12[uvRow + x + 1] = clampByte(v / 4);
    }
  }

  return nv12;
}

function drawImageCover(context: CanvasRenderingContext2D, image: CanvasImageSource, width: number, height: number, sourceWidth: number, sourceHeight: number) {
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

class VirtualCameraFrameRenderer implements VideoFrameRenderer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private lastFrameAt = 0;
  active = true;

  constructor(
    private api: ScrcpyStudioApi,
    private targetWidth: number,
    private targetHeight: number,
    private targetFps: number,
    private transform: CameraTransform,
    private onError: (message: string) => void
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = targetWidth;
    this.canvas.height = targetHeight;
    const context = this.canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!context) throw new Error("Could not create virtual camera frame renderer.");
    this.context = context;
  }

  setTransform(transform: CameraTransform) {
    this.transform = transform;
  }

  setSize() {
    this.canvas.width = this.targetWidth;
    this.canvas.height = this.targetHeight;
  }

  async draw(frame: VideoFrame) {
    if (!this.active) return;
    const now = performance.now();
    if (now - this.lastFrameAt < 1000 / this.targetFps) return;
    this.lastFrameAt = now;

    try {
      const sourceWidth = frame.displayWidth || frame.codedWidth;
      const sourceHeight = frame.displayHeight || frame.codedHeight;
      const rotated = this.transform.rotation === 90 || this.transform.rotation === 270;
      const fitWidth = rotated ? sourceHeight : sourceWidth;
      const fitHeight = rotated ? sourceWidth : sourceHeight;
      const scale = Math.min(this.targetWidth / fitWidth, this.targetHeight / fitHeight);
      const drawWidth = sourceWidth * scale;
      const drawHeight = sourceHeight * scale;

      this.context.fillStyle = "#050707";
      this.context.fillRect(0, 0, this.targetWidth, this.targetHeight);
      this.context.save();
      this.context.translate(this.targetWidth / 2, this.targetHeight / 2);
      if (this.transform.rotation) this.context.rotate((this.transform.rotation * Math.PI) / 180);
      if (this.transform.flipHorizontal) this.context.scale(-1, 1);
      this.context.drawImage(frame, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
      this.context.restore();
      const image = this.context.getImageData(0, 0, this.targetWidth, this.targetHeight);
      const nv12 = rgbaToNv12(image.data, this.targetWidth, this.targetHeight);
      await this.api.sendVirtualCameraFrame({ data: nv12.buffer });
    } catch (error) {
      this.onError(errorMessage(error));
    }
  }
}

class CanvasFrameRenderer implements VideoFrameRenderer {
  private context: CanvasRenderingContext2D | ImageBitmapRenderingContext;

  constructor(private canvas: HTMLCanvasElement) {
    const context = canvas.getContext("bitmaprenderer", { alpha: false }) ?? canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Could not create mirror renderer.");
    this.context = context;
  }

  setSize(width: number, height: number) {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  async draw(frame: VideoFrame) {
    if ("transferFromImageBitmap" in this.context) {
      const bitmap = await createImageBitmap(frame);
      this.context.transferFromImageBitmap(bitmap);
      return;
    }
    this.context.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
  }
}

function NavButton({
  active,
  icon: Icon,
  label,
  onClick,
  badge
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button className={`nav-button ${active ? "active" : ""}`} type="button" onClick={onClick} title={label}>
      <Icon size={22} />
      <span>{label}</span>
      {typeof badge === "number" && badge > 0 ? <strong>{badge}</strong> : null}
    </button>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
  disabled
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`toggle-row ${disabled ? "disabled" : ""}`}>
      <span>{label}</span>
      <input type="checkbox" checked={value} disabled={disabled} onChange={(event) => onChange(event.currentTarget.checked)} />
      <i />
    </label>
  );
}

function NumberInput({
  label,
  value,
  min,
  max,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(coerceNumber(event.currentTarget.value, value, min, max))}
      />
    </label>
  );
}

function buildPhoneMirrorOptionState(settings: LauncherSettings) {
  const optionState: Record<string, { enabled: boolean; value?: string; kind: "boolean" | "value" }> = {
    "--turn-screen-off": { enabled: settings.turnScreenOff, kind: "boolean" },
    "--stay-awake": { enabled: settings.stayAwake, kind: "boolean" },
    "--show-touches": { enabled: settings.showTouches, kind: "boolean" },
    "--power-off-on-close": { enabled: settings.powerOffOnClose, kind: "boolean" },
    "--no-power-on": { enabled: settings.noPowerOn, kind: "boolean" },
    "--always-on-top": { enabled: settings.alwaysOnTop, kind: "boolean" },
    "--window-borderless": { enabled: settings.borderless, kind: "boolean" },
    "--video-codec": { enabled: true, value: settings.videoCodec, kind: "value" },
    "--video-bit-rate": { enabled: Boolean(settings.bitRate), value: settings.bitRate, kind: "value" }
  };

  if (settings.maxFps > 0) optionState["--max-fps"] = { enabled: true, value: String(settings.maxFps), kind: "value" };
  if (settings.maxSize > 0) optionState["--max-size"] = { enabled: true, value: String(settings.maxSize), kind: "value" };
  if (settings.videoBuffer > 0) optionState["--video-buffer"] = { enabled: true, value: String(settings.videoBuffer), kind: "value" };
  if (settings.screenOffTimeout > 0) {
    optionState["--screen-off-timeout"] = { enabled: true, value: String(settings.screenOffTimeout), kind: "value" };
  }
  if (settings.mouseMode !== "default") optionState["--mouse"] = { enabled: true, value: settings.mouseMode, kind: "value" };
  if (settings.keyboardMode !== "default") optionState["--keyboard"] = { enabled: true, value: settings.keyboardMode, kind: "value" };

  if (!settings.audio) {
    optionState["--no-audio"] = { enabled: true, kind: "boolean" };
  } else {
    optionState["--audio-source"] = { enabled: true, value: settings.audioSource, kind: "value" };
    optionState["--audio-codec"] = { enabled: true, value: settings.audioCodec, kind: "value" };
    optionState["--audio-bit-rate"] = { enabled: Boolean(settings.audioBitRate), value: settings.audioBitRate, kind: "value" };
    optionState["--audio-buffer"] = { enabled: settings.audioBuffer > 0, value: String(settings.audioBuffer), kind: "value" };
    optionState["--audio-output-buffer"] = { enabled: settings.audioOutputBuffer > 0, value: String(settings.audioOutputBuffer), kind: "value" };
    optionState["--audio-dup"] = { enabled: settings.audioSource === "playback" && settings.audioDup, kind: "boolean" };
    optionState["--require-audio"] = { enabled: settings.requireAudio, kind: "boolean" };
  }

  return optionState;
}

function buildCameraOptionState(settings: LauncherSettings, includeVirtualSink: boolean, v4l2Available: boolean) {
  const optionState: Record<string, { enabled: boolean; value?: string; kind: "boolean" | "value" }> = {
    "--video-source": { enabled: true, value: "camera", kind: "value" },
    "--video-codec": { enabled: true, value: settings.videoCodec, kind: "value" },
    "--video-bit-rate": { enabled: Boolean(settings.bitRate), value: settings.bitRate, kind: "value" },
    "--window-title": { enabled: true, value: "Android Camera", kind: "value" }
  };

  const cameraId = settings.cameraId.trim();
  const cameraSize = settings.cameraSize.trim();
  const cameraAr = settings.cameraAr.trim();
  const cameraZoom = settings.cameraZoom.trim();

  if (cameraId) optionState["--camera-id"] = { enabled: true, value: cameraId, kind: "value" };
  else if (settings.cameraFacing !== "auto") optionState["--camera-facing"] = { enabled: true, value: settings.cameraFacing, kind: "value" };

  if (cameraSize) {
    optionState["--camera-size"] = { enabled: true, value: cameraSize, kind: "value" };
  } else {
    if (settings.maxSize > 0) optionState["--max-size"] = { enabled: true, value: String(settings.maxSize), kind: "value" };
    if (cameraAr) optionState["--camera-ar"] = { enabled: true, value: cameraAr, kind: "value" };
  }

  if (settings.cameraFps > 0) optionState["--camera-fps"] = { enabled: true, value: String(settings.cameraFps), kind: "value" };
  if (settings.cameraHighSpeed) optionState["--camera-high-speed"] = { enabled: true, kind: "boolean" };
  if (settings.cameraTorch) optionState["--camera-torch"] = { enabled: true, kind: "boolean" };
  if (cameraZoom) optionState["--camera-zoom"] = { enabled: true, value: cameraZoom, kind: "value" };
  if (settings.cameraOrientation !== "0") optionState["--capture-orientation"] = { enabled: true, value: settings.cameraOrientation, kind: "value" };
  if (settings.videoBuffer > 0) optionState["--video-buffer"] = { enabled: true, value: String(settings.videoBuffer), kind: "value" };
  if (settings.alwaysOnTop) optionState["--always-on-top"] = { enabled: true, kind: "boolean" };
  if (settings.borderless) optionState["--window-borderless"] = { enabled: true, kind: "boolean" };

  if (!settings.cameraAudio) {
    optionState["--no-audio"] = { enabled: true, kind: "boolean" };
  } else {
    optionState["--audio-source"] = { enabled: true, value: settings.cameraAudioSource, kind: "value" };
    optionState["--audio-codec"] = { enabled: true, value: settings.audioCodec, kind: "value" };
    optionState["--audio-bit-rate"] = { enabled: Boolean(settings.audioBitRate), value: settings.audioBitRate, kind: "value" };
    optionState["--audio-buffer"] = { enabled: settings.audioBuffer > 0, value: String(settings.audioBuffer), kind: "value" };
    optionState["--audio-output-buffer"] = { enabled: settings.audioOutputBuffer > 0, value: String(settings.audioOutputBuffer), kind: "value" };
    if (settings.cameraNoAudioPlayback) optionState["--no-audio-playback"] = { enabled: true, kind: "boolean" };
    optionState["--require-audio"] = { enabled: settings.requireAudio, kind: "boolean" };
  }

  if (includeVirtualSink && v4l2Available && settings.v4l2Sink.trim()) {
    optionState["--v4l2-sink"] = { enabled: true, value: settings.v4l2Sink.trim(), kind: "value" };
    if (settings.v4l2Buffer > 0) optionState["--v4l2-buffer"] = { enabled: true, value: String(settings.v4l2Buffer), kind: "value" };
    if (settings.v4l2NoPlayback) optionState["--no-video-playback"] = { enabled: true, kind: "boolean" };
  }

  return optionState;
}

function videoPointFromEvent(event: ReactPointerEvent<HTMLCanvasElement>, width: number, height: number) {
  const rect = event.currentTarget.getBoundingClientRect();
  const scale = Math.min(rect.width / width, rect.height / height);
  const renderedWidth = width * scale;
  const renderedHeight = height * scale;
  const offsetX = (rect.width - renderedWidth) / 2;
  const offsetY = (rect.height - renderedHeight) / 2;
  const x = (event.clientX - rect.left - offsetX) / scale;
  const y = (event.clientY - rect.top - offsetY) / scale;
  return {
    x: Math.max(0, Math.min(width - 1, x)),
    y: Math.max(0, Math.min(height - 1, y))
  };
}

function MirrorWindow() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const decoderRef = useRef<WebCodecsVideoDecoder | null>(null);
  const writerRef = useRef<{ write: (packet: ScrcpyMediaStreamPacket) => Promise<void>; releaseLock?: () => void } | null>(null);
  const pointerDownRef = useRef(false);
  const [status, setStatus] = useState("Waiting for mirror");
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });

  const disposeDecoder = useCallback(() => {
    try {
      writerRef.current?.releaseLock?.();
    } catch {
      // Ignore stale writer locks when the decoder is already closed.
    }
    writerRef.current = null;
    decoderRef.current?.dispose();
    decoderRef.current = null;
  }, []);

  useEffect(() => {
    if (!studioApi) return undefined;
    return studioApi.onMirrorStart((profile) => {
      setStatus("Connecting");
      disposeDecoder();
      void studioApi
        .start({ ...(isRecord(profile) ? profile : {}), embedWindow: true })
        .catch((error) => setStatus(errorMessage(error)));
    });
  }, [disposeDecoder]);

  useEffect(() => {
    if (!studioApi) return undefined;
    return studioApi.onScrcpyEvent((event) => {
      if (!isRecord(event)) return;
      if (event.type === "status" && typeof event.status === "string") {
        setStatus(event.status === "connected" ? "Connected" : event.status);
      }
      if (event.type === "audio" && event.status === "error" && typeof event.message === "string") {
        setStatus(`Audio: ${event.message}`);
      }
    });
  }, []);

  useEffect(() => {
    if (!studioApi) return undefined;
    return studioApi.onVideoPacket((packet) => {
      if (!isRecord(packet)) return;
      if (packet.type === "metadata") {
        const canvas = canvasRef.current;
        if (!canvas) return;
        disposeDecoder();
        const codec = Number(packet.codec) as ScrcpyVideoCodecId;
        const decoder = new WebCodecsVideoDecoder({ codec, renderer: new CanvasFrameRenderer(canvas) });
        decoder.sizeChanged((size) => {
          setVideoSize(size);
          void studioApi.fitMirrorWindow(size);
        });
        decoderRef.current = decoder;
        writerRef.current = decoder.writable.getWriter() as unknown as typeof writerRef.current;
        setStatus("Connected");
        return;
      }

      if (packet.type !== "packet" || !writerRef.current) return;
      const data = packet.data instanceof ArrayBuffer ? new Uint8Array(packet.data) : ArrayBuffer.isView(packet.data) ? new Uint8Array(packet.data.buffer, packet.data.byteOffset, packet.data.byteLength) : null;
      if (!data) return;
      const mediaPacket = {
        type: packet.packetType === "configuration" ? "configuration" : "data",
        data,
        keyframe: Boolean(packet.keyframe),
        pts: typeof packet.pts === "string" ? BigInt(packet.pts) : undefined
      } as ScrcpyMediaStreamPacket;
      void writerRef.current.write(mediaPacket).catch((error: unknown) => setStatus(errorMessage(error)));
    });
  }, [disposeDecoder]);

  useEffect(() => () => {
    disposeDecoder();
    void studioApi?.stop();
  }, [disposeDecoder]);

  const sendAction = useCallback((action: string) => {
    void studioApi?.sendControl({ type: "action", action });
  }, []);

  const sendTouch = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>, action: number) => {
      if (!studioApi || videoSize.width <= 0 || videoSize.height <= 0) return;
      const point = videoPointFromEvent(event, videoSize.width, videoSize.height);
      if (action === 0 && !event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      void studioApi.sendControl({
        type: "touch",
        action,
        pointerId: event.pointerId,
        x: point.x,
        y: point.y,
        videoWidth: videoSize.width,
        videoHeight: videoSize.height,
        pressure: action === 1 ? 0 : 1,
        buttons: event.buttons
      });
      if (action === 1 && event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [videoSize.height, videoSize.width]
  );

  return (
    <main className="mirror-shell">
      <section className="mirror-stage">
        <canvas
          ref={canvasRef}
          onPointerDown={(event) => {
            pointerDownRef.current = true;
            sendTouch(event, 0);
          }}
          onPointerMove={(event) => {
            if (pointerDownRef.current) sendTouch(event, 2);
          }}
          onPointerUp={(event) => {
            pointerDownRef.current = false;
            sendTouch(event, 1);
          }}
          onPointerCancel={(event) => {
            pointerDownRef.current = false;
            sendTouch(event, 1);
          }}
        />
        {videoSize.width === 0 ? <span>{status}</span> : null}
      </section>
      <footer className="mirror-controls">
        <button type="button" title="Back" onClick={() => sendAction("back")}>
          <ArrowLeft size={20} />
        </button>
        <button type="button" title="Home" onClick={() => sendAction("home")}>
          <Home size={20} />
        </button>
        <button type="button" title="App switcher" onClick={() => sendAction("app-switch")}>
          <PanelBottom size={20} />
        </button>
        <button type="button" title="Rotate" onClick={() => sendAction("rotate")}>
          <RotateCw size={20} />
        </button>
        <button type="button" title="Power" onClick={() => sendAction("power")}>
          <Power size={20} />
        </button>
      </footer>
    </main>
  );
}

export default function App() {
  if (new URLSearchParams(window.location.search).get("mode") === "mirror") return <MirrorWindow />;

  const [ready, setReady] = useState(false);
  const [activeView, setActiveView] = useState<ViewId>("mirror");
  const [settings, setSettings] = useState<LauncherSettings>(DEFAULT_SETTINGS);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [apps, setApps] = useState<AndroidAppInfo[]>([]);
  const [sessions, setSessions] = useState<AppSessionInfo[]>([]);
  const [appIcons, setAppIcons] = useState<Record<string, string | null>>({});
  const [iconsLoading, setIconsLoading] = useState<Record<string, boolean>>({});
  const [logs, setLogs] = useState<StudioLog[]>([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [appsLoading, setAppsLoading] = useState(false);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [launchingPackage, setLaunchingPackage] = useState<string | null>(null);
  const [utilityOutput, setUtilityOutput] = useState("");
  const [utilityBusy, setUtilityBusy] = useState<string | null>(null);
  const [appError, setAppError] = useState("");
  const [appPlatform, setAppPlatform] = useState("win32");
  const [virtualCameraStatus, setVirtualCameraStatus] = useState<VirtualCameraStatus | null>(null);
  const [virtualCameraBusy, setVirtualCameraBusy] = useState(false);
  const appIconsRef = useRef<Record<string, string | null>>({});
  const iconLoadingRef = useRef<Set<string>>(new Set());
  const virtualBridgeRef = useRef<VirtualCameraBridge>({
    active: false,
    targetWidth: 1280,
    targetHeight: 720,
    targetFps: 30,
    transform: cameraTransformFromOrientation(DEFAULT_SETTINGS.cameraOrientation),
    decoder: null,
    writer: null,
    renderer: null,
    offlineTimer: null
  });

  const addLog = useCallback((message: string, level: LogLevel = "info") => {
    const clean = message.trim();
    if (!clean) return;
    setLogs((current) =>
      [
        {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          level,
          message: clean,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
        },
        ...current
      ].slice(0, 80)
    );
  }, []);

  const updateSettings = useCallback((patch: Partial<LauncherSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const upsertSession = useCallback((session: AppSessionInfo) => {
    setSessions((current) => {
      const without = current.filter((item) => item.id !== session.id);
      return [session, ...without].sort((left, right) => right.startedAt - left.startedAt);
    });
  }, []);

  const refreshDevices = useCallback(async () => {
    if (!studioApi) return;
    setDevicesLoading(true);
    try {
      const nextDevices = await studioApi.listDevices();
      setDevices(nextDevices);
      setSettings((current) => {
        if (current.selectedDevice && nextDevices.some((device) => device.serial === current.selectedDevice)) return current;
        return { ...current, selectedDevice: nextDevices[0]?.serial ?? "" };
      });
      addLog(nextDevices.length ? `Detected ${nextDevices.length} device${nextDevices.length === 1 ? "" : "s"}.` : "No ADB devices detected.", nextDevices.length ? "info" : "warn");
    } catch (error) {
      addLog(`Device refresh failed: ${errorMessage(error)}`, "error");
    } finally {
      setDevicesLoading(false);
    }
  }, [addLog]);

  const refreshApps = useCallback(async () => {
    if (!studioApi) return;
    setAppsLoading(true);
    setAppError("");
    try {
      const nextApps = await studioApi.listApps(settings.selectedDevice);
      setApps(nextApps);
      setPage(0);
      addLog(`Loaded ${nextApps.length} installed app${nextApps.length === 1 ? "" : "s"}.`);
    } catch (error) {
      const message = errorMessage(error);
      setAppError(message);
      addLog(`App list failed: ${message}`, "error");
    } finally {
      setAppsLoading(false);
    }
  }, [addLog, settings]);

  const refreshVirtualCameraStatus = useCallback(async () => {
    if (!studioApi) return;
    try {
      const status = await studioApi.getVirtualCameraStatus();
      setVirtualCameraStatus(status as VirtualCameraStatus);
    } catch (error) {
      addLog(`Virtual camera status failed: ${errorMessage(error)}`, "warn");
    }
  }, [addLog]);

  const resetVirtualBridge = useCallback(() => {
    const bridge = virtualBridgeRef.current;
    bridge.active = false;
    if (bridge.renderer) bridge.renderer.active = false;
    if (bridge.offlineTimer) window.clearInterval(bridge.offlineTimer);
    try {
      bridge.writer?.releaseLock?.();
    } catch {
      // releaseLock can fail if the decoder has already closed the stream.
    }
    bridge.decoder?.dispose();
    virtualBridgeRef.current = {
      active: false,
      targetWidth: 1280,
      targetHeight: 720,
      targetFps: 30,
      transform: cameraTransformFromOrientation(settings.cameraOrientation),
      decoder: null,
      writer: null,
      renderer: null,
      offlineTimer: null
    };
  }, [settings.cameraOrientation]);

  const startOfflineVirtualFrames = useCallback(
    (width: number, height: number, fps: number) => {
      if (!studioApi) return;
      const bridge = virtualBridgeRef.current;
      if (bridge.offlineTimer) window.clearInterval(bridge.offlineTimer);

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
      if (!context) {
        addLog("Could not create offline virtual camera canvas.", "error");
        return;
      }

      const sendFrame = () => {
        const image = context.getImageData(0, 0, width, height);
        const nv12 = rgbaToNv12(image.data, width, height);
        void studioApi.sendVirtualCameraFrame({ data: nv12.buffer }).catch((error) => {
          addLog(`Offline virtual camera frame failed: ${errorMessage(error)}`, "error");
        });
      };

      const drawFallback = () => {
        context.fillStyle = "#060808";
        context.fillRect(0, 0, width, height);
        context.fillStyle = "#f2f4ef";
        context.font = `700 ${Math.max(42, Math.round(width / 12))}px Segoe UI`;
        context.textAlign = "center";
        context.fillText("KairoMirror", width / 2, height * 0.42);
        context.fillStyle = "#aeb8b2";
        context.font = `400 ${Math.max(20, Math.round(width / 34))}px Segoe UI`;
        context.fillText("No Android camera connected", width / 2, height * 0.53);
        context.fillText("Powered by OBS Studio virtual camera driver", width / 2, height * 0.62);
      };

      const image = new Image();
      image.onload = () => {
        context.fillStyle = "#060808";
        context.fillRect(0, 0, width, height);
        drawImageCover(context, image, width, height, image.naturalWidth || width, image.naturalHeight || height);
        sendFrame();
        bridge.offlineTimer = window.setInterval(sendFrame, Math.max(250, Math.round(1000 / Math.max(1, fps))));
      };
      image.onerror = () => {
        drawFallback();
        sendFrame();
        bridge.offlineTimer = window.setInterval(sendFrame, Math.max(250, Math.round(1000 / Math.max(1, fps))));
      };
      image.src = offlineCameraImageUrl;
    },
    [addLog]
  );

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      if (!studioApi) return;
      try {
        const [savedSettings, nextDevices, nextSessions, appInfo, nextVirtualCameraStatus] = await Promise.all([
          studioApi.loadSettings(),
          studioApi.listDevices(),
          studioApi.listAppSessions(),
          studioApi.getAppInfo(),
          studioApi.getVirtualCameraStatus()
        ]);
        if (cancelled) return;
        const nextSettings = normalizeSettings(savedSettings);
        if (!nextSettings.selectedDevice || !nextDevices.some((device) => device.serial === nextSettings.selectedDevice)) {
          nextSettings.selectedDevice = nextDevices[0]?.serial ?? "";
        }
        setSettings(nextSettings);
        setDevices(nextDevices);
        setSessions(nextSessions);
        setAppPlatform(appInfo.platform);
        setVirtualCameraStatus(nextVirtualCameraStatus as VirtualCameraStatus);
        setReady(true);
      } catch (error) {
        if (!cancelled) {
          addLog(`Startup failed: ${errorMessage(error)}`, "error");
          setReady(true);
        }
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [addLog]);

  useEffect(() => {
    if (!ready || !studioApi) return;
    const timer = window.setTimeout(() => {
      void studioApi.saveSettings(settings);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [ready, settings]);

  useEffect(() => {
    if (!ready) return;
    void refreshApps();
  }, [ready, refreshApps]);

  useEffect(() => {
    if (!studioApi) return undefined;
    return studioApi.onScrcpyEvent((event) => {
      if (!isRecord(event)) return;

      if (event.type === "log" && typeof event.message === "string") {
        addLog(event.message, event.level === "warn" || event.level === "error" ? event.level : "info");
      }

      if (event.type === "status") {
        const status = typeof event.status === "string" ? event.status : "status";
        const message = typeof event.message === "string" ? `: ${event.message}` : "";
        addLog(`Mirror ${status}${message}`, status === "error" ? "error" : "info");
      }

      if (event.type === "audio") {
        const status = typeof event.status === "string" ? event.status : "status";
        const message = typeof event.message === "string" ? `: ${event.message}` : "";
        const command = typeof event.command === "string" ? `\n${event.command}` : "";
        const exit = typeof event.exitCode === "number" ? ` (exit ${event.exitCode})` : "";
        addLog(`Audio ${status}${exit}${message}${command}`, status === "error" || status === "stopped" ? "warn" : "info");
      }

      if (event.type === "virtual-camera") {
        if (typeof event.message === "string") {
          addLog(event.message, event.status === "error" ? "error" : "info");
        }
        void refreshVirtualCameraStatus();
      }

      if (event.type === "update") {
        const status = typeof event.status === "string" ? event.status : "status";
        const version = typeof event.version === "string" ? ` ${event.version}` : "";
        const percent = typeof event.percent === "number" ? ` ${event.percent}%` : "";
        const message = typeof event.message === "string" ? `: ${event.message}` : "";
        addLog(`Update ${status}${version}${percent}${message}`, status === "error" ? "error" : "info");
      }

      if (event.type === "app-session") {
        const session = isRecord(event.session) ? (event.session as unknown as AppSessionInfo) : null;
        if (event.action === "started" && session) {
          upsertSession(session);
          if (typeof event.command === "string") addLog(event.command);
        }
        if (event.action === "stopped" && session) {
          setSessions((current) => current.filter((item) => item.id !== session.id));
          addLog(`${session.name} window closed.`);
        }
        if (event.action === "stopped-all") {
          setSessions([]);
          addLog("All app windows closed.");
        }
        if (event.action === "error") {
          addLog(typeof event.message === "string" ? event.message : "App window failed.", "error");
        }
      }
    });
  }, [addLog, refreshVirtualCameraStatus, upsertSession]);

  useEffect(() => {
    if (!studioApi) return undefined;
    return studioApi.onVideoPacket((packet) => {
      if (!isRecord(packet)) return;
      const bridge = virtualBridgeRef.current;
      if (!bridge.active) return;

      if (packet.type === "metadata") {
        if (bridge.renderer) bridge.renderer.active = false;
        bridge.decoder?.dispose();
        const codec = Number(packet.codec) as ScrcpyVideoCodecId;
        const renderer = new VirtualCameraFrameRenderer(studioApi, bridge.targetWidth, bridge.targetHeight, bridge.targetFps, bridge.transform, (message) => {
          addLog(`Virtual camera frame failed: ${message}`, "error");
        });
        const decoder = new WebCodecsVideoDecoder({ codec, renderer });
        bridge.renderer = renderer;
        bridge.decoder = decoder;
        bridge.writer = decoder.writable.getWriter() as unknown as VirtualCameraBridge["writer"];
        addLog(`Virtual camera decoder attached at ${bridge.targetWidth}x${bridge.targetHeight}.`);
        return;
      }

      if (packet.type !== "packet" || !bridge.writer) return;
      const data = packet.data instanceof ArrayBuffer ? new Uint8Array(packet.data) : ArrayBuffer.isView(packet.data) ? new Uint8Array(packet.data.buffer, packet.data.byteOffset, packet.data.byteLength) : null;
      if (!data) return;
      const mediaPacket = {
        type: packet.packetType === "configuration" ? "configuration" : "data",
        data,
        keyframe: Boolean(packet.keyframe),
        pts: typeof packet.pts === "string" ? BigInt(packet.pts) : undefined
      } as ScrcpyMediaStreamPacket;
      void bridge.writer.write(mediaPacket).catch((error: unknown) => {
        addLog(`Virtual camera decode failed: ${errorMessage(error)}`, "error");
        resetVirtualBridge();
      });
    });
  }, [addLog, resetVirtualBridge]);

  const selectedDevice = useMemo(
    () => devices.find((device) => device.serial === settings.selectedDevice) ?? null,
    [devices, settings.selectedDevice]
  );

  const filteredApps = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return apps.filter((appInfo) => {
      if (settings.appFilter === "user" && appInfo.system) return false;
      if (settings.appFilter === "system" && !appInfo.system) return false;
      if (!normalizedQuery) return true;
      return `${appInfo.name} ${appInfo.packageName}`.toLowerCase().includes(normalizedQuery);
    });
  }, [apps, query, settings.appFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredApps.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pagedApps = useMemo(
    () => filteredApps.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE),
    [currentPage, filteredApps]
  );

  useEffect(() => {
    setPage(0);
  }, [query, settings.appFilter]);

  useEffect(() => {
    if (page > totalPages - 1) setPage(totalPages - 1);
  }, [page, totalPages]);

  useEffect(() => {
    appIconsRef.current = appIcons;
  }, [appIcons]);

  useEffect(() => {
    appIconsRef.current = {};
    iconLoadingRef.current.clear();
    setAppIcons({});
    setIconsLoading({});
  }, [settings.selectedDevice]);

  useEffect(() => {
    if (!studioApi || !ready || apps.length === 0) return;
    const api = studioApi;
    let cancelled = false;
    const missing = apps
      .filter((appInfo) => !(appInfo.packageName in appIconsRef.current) && !iconLoadingRef.current.has(appInfo.packageName))
      .slice(0, 240);
    if (missing.length === 0) return;

    for (const appInfo of missing) iconLoadingRef.current.add(appInfo.packageName);
    setIconsLoading((current) => {
      const next = { ...current };
      for (const appInfo of missing) next[appInfo.packageName] = true;
      return next;
    });

    async function loadIcons() {
      let index = 0;
      const workers = Array.from({ length: Math.min(5, missing.length) }, async () => {
        while (!cancelled) {
          const appInfo = missing[index++];
          if (!appInfo) break;
          try {
            const icon = await api.getAppIcon({
              selectedDevice: settings.selectedDevice,
              packageName: appInfo.packageName,
              name: appInfo.name
            });
            if (!cancelled) {
              setAppIcons((current) => {
                const next = { ...current, [appInfo.packageName]: icon.dataUrl };
                appIconsRef.current = next;
                return next;
              });
            }
          } catch (error) {
            if (!cancelled) {
              setAppIcons((current) => {
                const next = { ...current, [appInfo.packageName]: null };
                appIconsRef.current = next;
                return next;
              });
              addLog(`Icon unavailable for ${appInfo.name}: ${errorMessage(error)}`, "warn");
            }
          } finally {
            iconLoadingRef.current.delete(appInfo.packageName);
            if (!cancelled) {
              setIconsLoading((current) => ({ ...current, [appInfo.packageName]: false }));
            }
          }
        }
      });
      await Promise.all(workers);
    }

    void loadIcons();
    return () => {
      cancelled = true;
    };
  }, [addLog, apps, ready, settings.selectedDevice]);

  const activePreset = useMemo(
    () =>
      DISPLAY_PRESETS.find(
        (preset) => preset.width === settings.width && preset.height === settings.height && preset.dpi === settings.dpi
      )?.id ?? "custom",
    [settings.dpi, settings.height, settings.width]
  );
  const v4l2Available = appPlatform === "linux";
  const isCameraRunning = Boolean(virtualCameraStatus?.running);
  const cameraTransform = useMemo(() => cameraTransformFromOrientation(settings.cameraOrientation), [settings.cameraOrientation]);

  useEffect(() => {
    const bridge = virtualBridgeRef.current;
    bridge.transform = cameraTransform;
    bridge.renderer?.setTransform(cameraTransform);
  }, [cameraTransform]);

  const launchApp = useCallback(
    async (appInfo: AndroidAppInfo) => {
      if (!studioApi) return;
      setLaunchingPackage(appInfo.packageName);
      try {
        const session = await studioApi.launchApp({
          selectedDevice: settings.selectedDevice,
          packageName: appInfo.packageName,
          name: appInfo.name,
          width: settings.width,
          height: settings.height,
          dpi: settings.dpi,
          flex: settings.flex,
          keepActive: settings.keepActive,
          forceStop: settings.forceStop,
          audio: settings.audio,
          audioDup: settings.audioDup,
          audioSource: settings.audioSource,
          audioCodec: settings.audioCodec,
          audioBitRate: settings.audioBitRate,
          audioBuffer: settings.audioBuffer,
          audioOutputBuffer: settings.audioOutputBuffer,
          requireAudio: settings.requireAudio,
          systemDecorations: settings.systemDecorations,
          noVdDestroyContent: settings.noVdDestroyContent,
          displayImePolicy: settings.displayImePolicy,
          videoCodec: settings.videoCodec,
          bitRate: settings.bitRate,
          maxFps: settings.maxFps,
          maxSize: settings.maxSize,
          videoBuffer: settings.videoBuffer,
          turnScreenOff: settings.turnScreenOff,
          stayAwake: settings.stayAwake,
          screenOffTimeout: settings.screenOffTimeout,
          showTouches: settings.showTouches,
          powerOffOnClose: settings.powerOffOnClose,
          noPowerOn: settings.noPowerOn,
          alwaysOnTop: settings.alwaysOnTop,
          borderless: settings.borderless,
          mouseMode: settings.mouseMode,
          keyboardMode: settings.keyboardMode
        });
        upsertSession(session);
        setActiveView("sessions");
      } catch (error) {
        addLog(`Could not open ${appInfo.name}: ${errorMessage(error)}`, "error");
      } finally {
        setLaunchingPackage(null);
      }
    },
    [addLog, settings, upsertSession]
  );

  const stopSession = useCallback(
    async (sessionId: string) => {
      if (!studioApi) return;
      try {
        await studioApi.stopAppSession(sessionId);
        setSessions((current) => current.filter((session) => session.id !== sessionId));
      } catch (error) {
        addLog(`Could not close app window: ${errorMessage(error)}`, "error");
      }
    },
    [addLog]
  );

  const stopAllSessions = useCallback(async () => {
    if (!studioApi) return;
    try {
      await studioApi.stopAllAppSessions();
      setSessions([]);
    } catch (error) {
      addLog(`Could not close app windows: ${errorMessage(error)}`, "error");
    }
  }, [addLog]);

  const runUtility = useCallback(
    async (flag: string, label: string) => {
      if (!studioApi) return;
      setUtilityBusy(flag);
      try {
        const result = await studioApi.runUtility({ selectedDevice: settings.selectedDevice, flag });
        setUtilityOutput(result.output || `${label} finished without output.`);
        addLog(`${label} finished.`);
      } catch (error) {
        const message = errorMessage(error);
        setUtilityOutput(message);
        addLog(`${label} failed: ${message}`, "error");
      } finally {
        setUtilityBusy(null);
      }
    },
    [addLog, settings.selectedDevice]
  );

  const startPhoneMirror = useCallback(async () => {
    if (!studioApi) return;
    try {
      await studioApi.openMirrorWindow({
        profile: {
          selectedDevice: settings.selectedDevice,
          embedWindow: true,
          flexibleStage: false,
          optionState: buildPhoneMirrorOptionState(settings)
        }
      });
    } catch (error) {
      addLog(`Phone mirror failed: ${errorMessage(error)}`, "error");
    }
  }, [addLog, settings]);

  const stopPhoneMirror = useCallback(async () => {
    if (!studioApi) return;
    try {
      resetVirtualBridge();
      await studioApi.stop();
    } catch (error) {
      addLog(`Could not stop phone mirror: ${errorMessage(error)}`, "error");
    }
  }, [addLog, resetVirtualBridge]);

  const runScreenAction = useCallback(
    async (action: "screen-off" | "screen-on") => {
      if (!studioApi) return;
      try {
        await studioApi.runDeviceAction({ selectedDevice: settings.selectedDevice, action });
        addLog(action === "screen-off" ? "Requested black phone screen." : "Requested phone screen wake.");
      } catch (error) {
        addLog(`Screen action failed: ${errorMessage(error)}`, "error");
      }
    },
    [addLog, settings.selectedDevice]
  );

  const resetAudioDefaults = useCallback(() => {
    updateSettings({
      audio: true,
      audioSource: "output",
      audioDup: false,
      audioCodec: "opus",
      audioBitRate: "128K",
      audioBuffer: 50,
      audioOutputBuffer: 50,
      requireAudio: true
    });
    addLog("Audio defaults restored.");
  }, [addLog, updateSettings]);

  const checkForUpdates = useCallback(async () => {
    if (!studioApi) return;
    try {
      await studioApi.checkForUpdates();
    } catch (error) {
      addLog(`Update check failed: ${errorMessage(error)}`, "error");
    }
  }, [addLog]);

  const restartCameraCapture = useCallback(
    async (nextSettings: LauncherSettings, reason: string) => {
      if (!studioApi || v4l2Available || !virtualBridgeRef.current.active) return;
      const optionState = buildCameraOptionState(nextSettings, false, v4l2Available);
      optionState["--video-codec"] = { enabled: true, value: "h264", kind: "value" };
      optionState["--no-audio"] = { enabled: true, kind: "boolean" };

      setVirtualCameraBusy(true);
      try {
        await studioApi.start({
          selectedDevice: nextSettings.selectedDevice,
          embedWindow: true,
          flexibleStage: false,
          optionState
        });
        addLog(reason);
      } catch (error) {
        addLog(`Camera restart failed: ${errorMessage(error)}`, "error");
      } finally {
        setVirtualCameraBusy(false);
      }
    },
    [addLog, v4l2Available]
  );

  const updateCameraFacing = useCallback(
    (cameraFacing: CameraFacing) => {
      const nextSettings = { ...settings, cameraFacing, cameraId: "" };
      updateSettings({ cameraFacing, cameraId: "" });
      if (isCameraRunning) void restartCameraCapture(nextSettings, `Switched camera to ${cameraFacing}.`);
    },
    [isCameraRunning, restartCameraCapture, settings, updateSettings]
  );

  const updateCameraOrientation = useCallback(
    (cameraOrientation: CameraOrientation) => {
      updateSettings({ cameraOrientation });
      virtualBridgeRef.current.transform = cameraTransformFromOrientation(cameraOrientation);
      virtualBridgeRef.current.renderer?.setTransform(virtualBridgeRef.current.transform);
    },
    [updateSettings]
  );

  const setCameraTorch = useCallback(
    (cameraTorch: boolean) => {
      updateSettings({ cameraTorch });
      if (!isCameraRunning || v4l2Available) return;
      void studioApi?.sendControl({ type: "action", action: cameraTorch ? "camera-torch-on" : "camera-torch-off" }).catch((error) => {
        addLog(`Torch control failed: ${errorMessage(error)}`, "error");
      });
    },
    [addLog, isCameraRunning, updateSettings, v4l2Available]
  );

  const sendCameraLiveAction = useCallback(
    (action: "camera-zoom-in" | "camera-zoom-out") => {
      if (!isCameraRunning || v4l2Available) return;
      void studioApi?.sendControl({ type: "action", action }).catch((error) => {
        addLog(`Camera control failed: ${errorMessage(error)}`, "error");
      });
    },
    [addLog, isCameraRunning, v4l2Available]
  );

  const installVirtualCamera = useCallback(async () => {
    if (!studioApi) return;
    setVirtualCameraBusy(true);
    try {
      await studioApi.installVirtualCamera();
      addLog("OBS DirectShow virtual camera registered.");
      await refreshVirtualCameraStatus();
    } catch (error) {
      addLog(`Virtual camera install failed: ${errorMessage(error)}`, "error");
    } finally {
      setVirtualCameraBusy(false);
    }
  }, [addLog, refreshVirtualCameraStatus]);

  const uninstallVirtualCamera = useCallback(async () => {
    if (!studioApi) return;
    setVirtualCameraBusy(true);
    try {
      await studioApi.uninstallVirtualCamera();
      addLog("OBS DirectShow virtual camera unregistered.");
      await refreshVirtualCameraStatus();
    } catch (error) {
      addLog(`Virtual camera uninstall failed: ${errorMessage(error)}`, "error");
    } finally {
      setVirtualCameraBusy(false);
    }
  }, [addLog, refreshVirtualCameraStatus]);

  const stopCameraVirtual = useCallback(async () => {
    if (!studioApi) return;
    resetVirtualBridge();
    try {
      await studioApi.stop();
      await studioApi.stopVirtualCamera();
      await refreshVirtualCameraStatus();
    } catch (error) {
      addLog(`Virtual camera stop failed: ${errorMessage(error)}`, "error");
    }
  }, [addLog, refreshVirtualCameraStatus, resetVirtualBridge]);

  const startCameraVirtual = useCallback(async () => {
    if (!studioApi) return;
    if (!v4l2Available) {
      if (!WebCodecsVideoDecoder.isSupported) {
        addLog("This Electron runtime does not expose WebCodecs, so decoded camera frames cannot be bridged to DirectShow.", "error");
        return;
      }
      const { width, height } = parseSize(settings.cameraSize, 1280, 720);
      const fps = settings.cameraFps > 0 ? settings.cameraFps : 30;
      const optionState = buildCameraOptionState(settings, false, v4l2Available);
      optionState["--video-codec"] = { enabled: true, value: "h264", kind: "value" };
      optionState["--no-audio"] = { enabled: true, kind: "boolean" };

      setVirtualCameraBusy(true);
      resetVirtualBridge();
      let writerStarted = false;
      try {
        await studioApi.startVirtualCamera({ width, height, fps, mode: "stdin" });
        writerStarted = true;
        virtualBridgeRef.current = {
          active: true,
          targetWidth: width,
          targetHeight: height,
          targetFps: fps,
          transform: cameraTransformFromOrientation(settings.cameraOrientation),
          decoder: null,
          writer: null,
          renderer: null,
          offlineTimer: null
        };
        await studioApi.start({
          selectedDevice: settings.selectedDevice,
          embedWindow: true,
          flexibleStage: false,
          optionState
        });
        addLog(`Windows virtual camera started at ${width}x${height} ${fps} FPS.`);
        await refreshVirtualCameraStatus();
      } catch (error) {
        resetVirtualBridge();
        if (writerStarted) {
          startOfflineVirtualFrames(width, height, fps);
          await refreshVirtualCameraStatus();
          addLog(`Android camera stream unavailable; showing KairoMirror standby frame. ${errorMessage(error)}`, "warn");
        } else {
          await studioApi.stopVirtualCamera().catch(() => undefined);
          addLog(`Virtual camera failed: ${errorMessage(error)}`, "error");
        }
      } finally {
        setVirtualCameraBusy(false);
      }
      return;
    }
    try {
      await studioApi.start({
        selectedDevice: settings.selectedDevice,
        embedWindow: false,
        flexibleStage: false,
        optionState: buildCameraOptionState(settings, true, v4l2Available)
      });
    } catch (error) {
      addLog(`Virtual camera failed: ${errorMessage(error)}`, "error");
    }
  }, [addLog, refreshVirtualCameraStatus, resetVirtualBridge, settings, startOfflineVirtualFrames, v4l2Available]);

  const startVirtualCameraTest = useCallback(async () => {
    if (!studioApi) return;
    const { width, height } = parseSize(settings.cameraSize, 1280, 720);
    const fps = settings.cameraFps > 0 ? settings.cameraFps : 30;
    setVirtualCameraBusy(true);
    resetVirtualBridge();
    try {
      await studioApi.startVirtualCamera({ width, height, fps, mode: "test" });
      addLog(`Virtual camera test pattern started at ${width}x${height} ${fps} FPS.`);
      await refreshVirtualCameraStatus();
    } catch (error) {
      addLog(`Virtual camera test failed: ${errorMessage(error)}`, "error");
    } finally {
      setVirtualCameraBusy(false);
    }
  }, [addLog, refreshVirtualCameraStatus, resetVirtualBridge, settings.cameraFps, settings.cameraSize]);

  if (!studioApi) {
    return (
      <main className="fatal-screen">
        <h1>KairoMirror</h1>
        <p>Electron preload is not available.</p>
      </main>
    );
  }

  return (
    <main className="launcher-shell">
      <aside className="rail">
        <div className="brand-mark">
          <Smartphone size={24} />
        </div>
        <nav>
          <NavButton active={activeView === "mirror"} icon={Smartphone} label="Mirror" onClick={() => setActiveView("mirror")} />
          <NavButton active={activeView === "apps"} icon={AppWindow} label="Apps" badge={apps.length} onClick={() => setActiveView("apps")} />
          <NavButton active={activeView === "sessions"} icon={Monitor} label="Windows" badge={sessions.length} onClick={() => setActiveView("sessions")} />
          <NavButton active={activeView === "camera"} icon={Camera} label="Webcam" onClick={() => setActiveView("camera")} />
          <NavButton active={activeView === "settings"} icon={SlidersHorizontal} label="Settings" onClick={() => setActiveView("settings")} />
          <NavButton active={activeView === "tools"} icon={Wrench} label="Tools" onClick={() => setActiveView("tools")} />
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">scrcpy 4.0</span>
            <h1>
              {activeView === "apps"
                ? "Android Apps"
                : activeView === "sessions"
                  ? "App Windows"
                  : activeView === "settings"
                    ? "Settings"
                    : activeView === "camera"
                      ? "Webcam"
                      : activeView === "mirror"
                        ? "Phone Mirror"
                        : "Device Tools"}
            </h1>
          </div>
          <div className="device-picker">
            <Smartphone size={18} />
            <select
              value={settings.selectedDevice}
              onChange={(event) => updateSettings({ selectedDevice: event.currentTarget.value })}
              disabled={devices.length === 0}
            >
              {devices.length === 0 ? <option value="">No device</option> : null}
              {devices.map((device) => (
                <option value={device.serial} key={device.serial}>
                  {device.label}
                </option>
              ))}
            </select>
            <button className="icon-button" type="button" onClick={() => void refreshDevices()} disabled={devicesLoading} title="Refresh devices">
              <RefreshCw size={18} />
            </button>
          </div>
        </header>

        {activeView === "mirror" ? (
          <section className="task-layout">
            <article className="hero-panel">
              <div className="hero-icon">
                <Smartphone size={28} />
              </div>
              <div>
                <h2>Phone screen</h2>
                <p>Opens a clean Electron mirror window with Back, Home, app switch, rotate, and power controls below the screen.</p>
              </div>
              <button className="primary-action" type="button" onClick={() => void startPhoneMirror()}>
                <Play size={18} />
                Open mirror
              </button>
            </article>

            <article className="settings-panel">
              <div className="panel-heading">
                <h2>Sound</h2>
                <span>{settings.audio ? settings.audioSource : "Off"}</span>
              </div>
              <div className="option-cards">
                <button
                  type="button"
                  className={settings.audio && settings.audioSource === "output" ? "active" : ""}
                  onClick={() => updateSettings({ audio: true, audioSource: "output", audioDup: false })}
                >
                  <Volume2 size={19} />
                  <strong>Computer</strong>
                  <small>Route phone audio here</small>
                </button>
                <button
                  type="button"
                  className={settings.audio && settings.audioSource === "playback" && settings.audioDup ? "active" : ""}
                  onClick={() => updateSettings({ audio: true, audioSource: "playback", audioDup: true })}
                >
                  <Volume2 size={19} />
                  <strong>Both</strong>
                  <small>Keep phone speaker on</small>
                </button>
                <button type="button" className={!settings.audio ? "active" : ""} onClick={() => updateSettings({ audio: false })}>
                  <VolumeX size={19} />
                  <strong>Muted</strong>
                  <small>No audio stream</small>
                </button>
              </div>
              <ToggleRow label="Fail if audio cannot start" value={settings.requireAudio} disabled={!settings.audio} onChange={(requireAudio) => updateSettings({ requireAudio })} />
              <div className="field-grid two">
                <NumberInput label="Audio buffer" value={settings.audioBuffer} min={0} max={2000} onChange={(audioBuffer) => updateSettings({ audioBuffer })} />
                <NumberInput label="Output buffer" value={settings.audioOutputBuffer} min={0} max={2000} onChange={(audioOutputBuffer) => updateSettings({ audioOutputBuffer })} />
              </div>
            </article>

            <article className="settings-panel">
              <div className="panel-heading">
                <h2>Phone</h2>
                <span>{settings.turnScreenOff ? "Black screen" : "Screen on"}</span>
              </div>
              <ToggleRow label="Black phone screen while mirroring" value={settings.turnScreenOff} onChange={(turnScreenOff) => updateSettings({ turnScreenOff })} />
              <ToggleRow label="Show physical touches" value={settings.showTouches} onChange={(showTouches) => updateSettings({ showTouches })} />
              <ToggleRow label="Turn phone screen off when mirror closes" value={settings.powerOffOnClose} onChange={(powerOffOnClose) => updateSettings({ powerOffOnClose })} />
              <div className="action-row">
                <button className="ghost-action" type="button" onClick={() => void runScreenAction("screen-off")}>
                  Black screen now
                </button>
                <button className="ghost-action" type="button" onClick={() => void runScreenAction("screen-on")}>
                  Wake screen
                </button>
              </div>
            </article>
          </section>
        ) : null}

        {activeView === "apps" ? (
          <section className="view-stack">
            <div className="control-strip">
              <label className="search-box">
                <Search size={18} />
                <input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search apps or packages" />
              </label>
              <div className="segmented">
                {FILTERS.map((filter) => (
                  <button
                    type="button"
                    key={filter.id}
                    className={settings.appFilter === filter.id ? "active" : ""}
                    onClick={() => updateSettings({ appFilter: filter.id })}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
              <button className="primary-action" type="button" onClick={() => void refreshApps()} disabled={appsLoading || !ready}>
                <RefreshCw size={18} />
                Refresh apps
              </button>
            </div>

            <div className="status-row">
              <span>{selectedDevice ? selectedDevice.label : "No device selected"}</span>
              <i />
              <span>
                {appsLoading
                  ? "Loading apps"
                  : `${filteredApps.length} shown from ${apps.length} · page ${currentPage + 1} of ${totalPages}`}
              </span>
              {appError ? (
                <>
                  <i />
                  <span className="error-text">{appError}</span>
                </>
              ) : null}
            </div>

            <div className="app-grid">
              {pagedApps.map((appInfo) => {
                const hue = stableHue(appInfo.packageName);
                const isLaunching = launchingPackage === appInfo.packageName;
                const iconUrl = appIcons[appInfo.packageName];
                const isIconLoading = iconsLoading[appInfo.packageName];
                return (
                  <article className="app-card" key={appInfo.packageName}>
                    <div className="app-icon" style={{ "--icon-hue": hue } as Record<string, number>}>
                      {iconUrl ? <img src={iconUrl} alt="" /> : <span>{isIconLoading ? "" : getInitials(appInfo.name)}</span>}
                    </div>
                    <div className="app-card-main">
                      <div className="app-title-row">
                        <h2 title={appInfo.name}>{appInfo.name}</h2>
                        <span className={appInfo.system ? "app-badge system" : "app-badge"}>{appInfo.system ? "System" : "User"}</span>
                      </div>
                      <p title={appInfo.packageName}>{appInfo.packageName}</p>
                      <button className="launch-button" type="button" onClick={() => void launchApp(appInfo)} disabled={isLaunching || !ready}>
                        <Play size={17} />
                        {isLaunching ? "Opening" : "Open window"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>

            {filteredApps.length > PAGE_SIZE ? (
              <div className="pager">
                <button className="ghost-action" type="button" disabled={currentPage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>
                  Previous
                </button>
                <span>
                  {currentPage + 1} / {totalPages}
                </span>
                <button
                  className="ghost-action"
                  type="button"
                  disabled={currentPage >= totalPages - 1}
                  onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}
                >
                  Next
                </button>
              </div>
            ) : null}

            {!appsLoading && filteredApps.length === 0 ? (
              <div className="empty-state">
                <AppWindow size={32} />
                <h2>No apps shown</h2>
                <p>{apps.length === 0 ? "Connect a device and refresh the app list." : "Change the filter or search text."}</p>
              </div>
            ) : null}
          </section>
        ) : null}

        {activeView === "sessions" ? (
          <section className="view-stack">
            <div className="control-strip compact">
              <button className="primary-action" type="button" onClick={() => setActiveView("apps")}>
                <AppWindow size={18} />
                Open another app
              </button>
              <button className="ghost-action" type="button" onClick={() => void stopAllSessions()} disabled={sessions.length === 0}>
                <X size={18} />
                Close all
              </button>
            </div>
            <div className="session-list wide">
              {sessions.map((session) => (
                <article className="session-card" key={session.id}>
                  <div className="session-dot" />
                  <div>
                    <h2>{session.name}</h2>
                    <p>{session.packageName}</p>
                    <span>Started {formatTime(session.startedAt)}{session.pid ? ` · PID ${session.pid}` : ""}</span>
                  </div>
                  <button className="icon-button" type="button" title="Close window" onClick={() => void stopSession(session.id)}>
                    <X size={18} />
                  </button>
                </article>
              ))}
            </div>
            {sessions.length === 0 ? (
              <div className="empty-state">
                <Monitor size={32} />
                <h2>No app windows</h2>
                <p>Choose an app to start a separate virtual-display window.</p>
              </div>
            ) : null}
          </section>
        ) : null}

        {activeView === "settings" ? (
          <section className="settings-grid">
            <article className="settings-panel">
              <div className="panel-heading">
                <h2>Virtual Display</h2>
                <span>{settings.width}x{settings.height} / {settings.dpi} dpi</span>
              </div>
              <div className="preset-row">
                {DISPLAY_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={activePreset === preset.id ? "active" : ""}
                    onClick={() => updateSettings({ width: preset.width, height: preset.height, dpi: preset.dpi })}
                  >
                    {preset.name}
                    <small>{preset.width}x{preset.height}</small>
                  </button>
                ))}
              </div>
              <div className="field-grid">
                <NumberInput label="Width" value={settings.width} min={320} max={7680} onChange={(width) => updateSettings({ width })} />
                <NumberInput label="Height" value={settings.height} min={320} max={7680} onChange={(height) => updateSettings({ height })} />
                <NumberInput label="DPI" value={settings.dpi} min={80} max={960} onChange={(dpi) => updateSettings({ dpi })} />
              </div>
              <ToggleRow label="Resizable app display" value={settings.flex} onChange={(flex) => updateSettings({ flex })} />
              <ToggleRow label="Keep device awake" value={settings.keepActive} onChange={(keepActive) => updateSettings({ keepActive })} />
              <ToggleRow label="Force stop before launch" value={settings.forceStop} onChange={(forceStop) => updateSettings({ forceStop })} />
              <ToggleRow label="System bars in app window" value={settings.systemDecorations} onChange={(systemDecorations) => updateSettings({ systemDecorations })} />
              <ToggleRow label="Move app to phone on close" value={settings.noVdDestroyContent} onChange={(noVdDestroyContent) => updateSettings({ noVdDestroyContent })} />
              <label className="field">
                <span>Keyboard display</span>
                <select value={settings.displayImePolicy} onChange={(event) => updateSettings({ displayImePolicy: coerceImePolicy(event.currentTarget.value) })}>
                  <option value="default">Phone display</option>
                  <option value="local">App window</option>
                </select>
              </label>
            </article>

            <article className="settings-panel">
              <div className="panel-heading">
                <h2>Playback</h2>
                <span>{settings.videoCodec.toUpperCase()} · {settings.bitRate}</span>
              </div>
              <div className="preset-row">
                <button
                  type="button"
                  className={settings.audio && settings.audioSource === "output" ? "active" : ""}
                  onClick={() => updateSettings({ audio: true, audioSource: "output", audioDup: false })}
                >
                  PC audio
                  <small>Most reliable</small>
                </button>
                <button
                  type="button"
                  className={settings.audio && settings.audioSource === "playback" && settings.audioDup ? "active" : ""}
                  onClick={() => updateSettings({ audio: true, audioSource: "playback", audioDup: true })}
                >
                  PC + phone
                  <small>App playback</small>
                </button>
                <button type="button" className={!settings.audio ? "active" : ""} onClick={() => updateSettings({ audio: false })}>
                  Silent
                  <small>No audio</small>
                </button>
              </div>
              <ToggleRow label="Audio playback" value={settings.audio} onChange={(audio) => updateSettings({ audio })} />
              <ToggleRow
                label="Also keep audio on device"
                value={settings.audioDup}
                disabled={!settings.audio || settings.audioSource !== "playback"}
                onChange={(audioDup) => updateSettings({ audioDup })}
              />
              <ToggleRow label="Require audio" value={settings.requireAudio} disabled={!settings.audio} onChange={(requireAudio) => updateSettings({ requireAudio })} />
              <details className="advanced-panel">
                <summary>Advanced playback</summary>
                <div className="advanced-content">
                  <label className="field">
                    <span>Video codec</span>
                    <select value={settings.videoCodec} onChange={(event) => updateSettings({ videoCodec: coerceCodec(event.currentTarget.value) })}>
                      <option value="h264">H.264</option>
                      <option value="h265">H.265</option>
                      <option value="av1">AV1</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Video bitrate</span>
                    <input value={settings.bitRate} onChange={(event) => updateSettings({ bitRate: event.currentTarget.value })} />
                  </label>
                  <div className="field-grid">
                    <NumberInput label="Max FPS" value={settings.maxFps} min={0} max={240} onChange={(maxFps) => updateSettings({ maxFps })} />
                    <NumberInput label="Max size" value={settings.maxSize} min={0} max={7680} onChange={(maxSize) => updateSettings({ maxSize })} />
                    <NumberInput label="Video buffer" value={settings.videoBuffer} min={0} max={2000} onChange={(videoBuffer) => updateSettings({ videoBuffer })} />
                  </div>
                  <label className="field">
                    <span>Audio source</span>
                    <select value={settings.audioSource} disabled={!settings.audio} onChange={(event) => updateSettings({ audioSource: coerceAudioSource(event.currentTarget.value) })}>
                      <option value="output">Output</option>
                      <option value="playback">Playback</option>
                      <option value="mic">Microphone</option>
                      <option value="mic-unprocessed">Raw microphone</option>
                      <option value="mic-camcorder">Camcorder mic</option>
                      <option value="mic-voice-recognition">Voice recognition</option>
                      <option value="mic-voice-communication">Voice communication</option>
                      <option value="voice-call">Voice call</option>
                      <option value="voice-call-uplink">Call uplink</option>
                      <option value="voice-call-downlink">Call downlink</option>
                      <option value="voice-performance">Voice performance</option>
                    </select>
                  </label>
                  <div className="field-grid">
                    <label className="field">
                      <span>Audio codec</span>
                      <select value={settings.audioCodec} disabled={!settings.audio} onChange={(event) => updateSettings({ audioCodec: coerceAudioCodec(event.currentTarget.value) })}>
                        <option value="opus">Opus</option>
                        <option value="aac">AAC</option>
                        <option value="flac">FLAC</option>
                        <option value="raw">Raw</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Audio bitrate</span>
                      <input value={settings.audioBitRate} disabled={!settings.audio} onChange={(event) => updateSettings({ audioBitRate: event.currentTarget.value })} />
                    </label>
                    <NumberInput label="Audio buffer" value={settings.audioBuffer} min={0} max={2000} onChange={(audioBuffer) => updateSettings({ audioBuffer })} />
                    <NumberInput label="Output buffer" value={settings.audioOutputBuffer} min={0} max={2000} onChange={(audioOutputBuffer) => updateSettings({ audioOutputBuffer })} />
                  </div>
                </div>
              </details>
              <div className="action-row">
                <button className="ghost-action" type="button" onClick={resetAudioDefaults}>
                  Reset audio
                </button>
              </div>
            </article>

            <article className="settings-panel">
              <div className="panel-heading">
                <h2>Window And Input</h2>
                <span>{settings.mouseMode === "default" ? "Default input" : settings.mouseMode.toUpperCase()}</span>
              </div>
              <ToggleRow label="Always on top" value={settings.alwaysOnTop} onChange={(alwaysOnTop) => updateSettings({ alwaysOnTop })} />
              <ToggleRow label="Borderless windows" value={settings.borderless} onChange={(borderless) => updateSettings({ borderless })} />
              <label className="field">
                <span>Mouse mode</span>
                <select value={settings.mouseMode} onChange={(event) => updateSettings({ mouseMode: coerceInputMode(event.currentTarget.value) })}>
                  <option value="default">Default</option>
                  <option value="sdk">SDK</option>
                  <option value="uhid">UHID</option>
                  <option value="disabled">Disabled</option>
                </select>
              </label>
              <label className="field">
                <span>Keyboard mode</span>
                <select value={settings.keyboardMode} onChange={(event) => updateSettings({ keyboardMode: coerceInputMode(event.currentTarget.value) })}>
                  <option value="default">Default</option>
                  <option value="sdk">SDK</option>
                  <option value="uhid">UHID</option>
                  <option value="disabled">Disabled</option>
                </select>
              </label>
            </article>

            <article className="settings-panel">
              <div className="panel-heading">
                <h2>Updates</h2>
                <span>{settings.checkForUpdates ? "Startup check" : "Manual"}</span>
              </div>
              <ToggleRow label="Check for updates at startup" value={settings.checkForUpdates} onChange={(checkForUpdates) => updateSettings({ checkForUpdates })} />
              <div className="action-row">
                <button className="ghost-action" type="button" onClick={() => void checkForUpdates()}>
                  <RefreshCw size={18} />
                  Check now
                </button>
              </div>
            </article>
          </section>
        ) : null}

        {activeView === "camera" ? (
          <section className="settings-grid">
            <article className="settings-panel">
              <div className="panel-heading">
                <h2>Camera Source</h2>
                <span>{isCameraRunning ? "Running" : "Android 12+"}</span>
              </div>
              <div className="field-grid">
                <label className="field">
                  <span>Facing</span>
                  <select value={settings.cameraFacing} disabled={virtualCameraBusy} onChange={(event) => updateCameraFacing(coerceCameraFacing(event.currentTarget.value))}>
                    <option value="auto">Auto</option>
                    <option value="front">Front</option>
                    <option value="back">Back</option>
                    <option value="external">External</option>
                  </select>
                </label>
                <label className="field">
                  <span>Camera ID</span>
                  <input value={settings.cameraId} disabled={isCameraRunning} onChange={(event) => updateSettings({ cameraId: event.currentTarget.value })} placeholder="0" />
                </label>
                <label className="field">
                  <span>Orientation</span>
                  <select value={settings.cameraOrientation} onChange={(event) => updateCameraOrientation(coerceCameraOrientation(event.currentTarget.value))}>
                    <option value="0">0</option>
                    <option value="90">90</option>
                    <option value="180">180</option>
                    <option value="270">270</option>
                    <option value="flip0">Flip 0</option>
                    <option value="flip90">Flip 90</option>
                    <option value="flip180">Flip 180</option>
                    <option value="flip270">Flip 270</option>
                  </select>
                </label>
              </div>
              <div className="live-camera-strip">
                <button type="button" title="Rotate left" onClick={() => updateCameraOrientation(nextCameraOrientation(settings.cameraOrientation, -90))}>
                  <RotateCcw size={18} />
                  <span>Left</span>
                </button>
                <button type="button" title="Rotate right" onClick={() => updateCameraOrientation(nextCameraOrientation(settings.cameraOrientation, 90))}>
                  <RotateCw size={18} />
                  <span>Right</span>
                </button>
                <button type="button" title="Flip horizontally" onClick={() => updateCameraOrientation(flippedCameraOrientation(settings.cameraOrientation))}>
                  <FlipHorizontal2 size={18} />
                  <span>Flip</span>
                </button>
                <button type="button" title="Switch front/back" disabled={virtualCameraBusy} onClick={() => updateCameraFacing(settings.cameraFacing === "front" ? "back" : "front")}>
                  <SwitchCamera size={18} />
                  <span>Lens</span>
                </button>
                <button type="button" className={settings.cameraTorch ? "active" : ""} title="Toggle torch" onClick={() => setCameraTorch(!settings.cameraTorch)}>
                  <Flashlight size={18} />
                  <span>Torch</span>
                </button>
                <button type="button" title="Zoom out" disabled={!isCameraRunning || v4l2Available} onClick={() => sendCameraLiveAction("camera-zoom-out")}>
                  <ZoomOut size={18} />
                  <span>Out</span>
                </button>
                <button type="button" title="Zoom in" disabled={!isCameraRunning || v4l2Available} onClick={() => sendCameraLiveAction("camera-zoom-in")}>
                  <ZoomIn size={18} />
                  <span>In</span>
                </button>
              </div>
              <details className="advanced-panel">
                <summary>Camera tuning</summary>
                <div className="advanced-content">
                  <div className="field-grid">
                    <label className="field">
                      <span>Camera size</span>
                      <input value={settings.cameraSize} disabled={isCameraRunning} onChange={(event) => updateSettings({ cameraSize: event.currentTarget.value })} placeholder="1920x1080" />
                    </label>
                    <label className="field">
                      <span>Aspect ratio</span>
                      <input value={settings.cameraAr} disabled={isCameraRunning || Boolean(settings.cameraSize.trim())} onChange={(event) => updateSettings({ cameraAr: event.currentTarget.value })} placeholder="16:9 or sensor" />
                    </label>
                    <NumberInput label="Camera FPS" value={settings.cameraFps} min={0} max={240} onChange={(cameraFps) => updateSettings({ cameraFps })} />
                  </div>
                  <div className="field-grid">
                    <label className="field">
                      <span>Zoom</span>
                      <input value={settings.cameraZoom} onChange={(event) => updateSettings({ cameraZoom: event.currentTarget.value })} placeholder="1.0" />
                    </label>
                    <NumberInput label="Max size" value={settings.maxSize} min={0} max={7680} onChange={(maxSize) => updateSettings({ maxSize })} />
                    <NumberInput label="Video buffer" value={settings.videoBuffer} min={0} max={2000} onChange={(videoBuffer) => updateSettings({ videoBuffer })} />
                  </div>
                  <ToggleRow label="High speed capture" value={settings.cameraHighSpeed} onChange={(cameraHighSpeed) => updateSettings({ cameraHighSpeed })} />
                </div>
              </details>
            </article>

            <article className="settings-panel">
              <div className="panel-heading">
                <h2>Camera Audio</h2>
                <span>{settings.cameraAudio ? settings.cameraAudioSource : "Off"}</span>
              </div>
              <ToggleRow label="Capture audio" value={settings.cameraAudio} onChange={(cameraAudio) => updateSettings({ cameraAudio })} />
              <ToggleRow label="Record without playback" value={settings.cameraNoAudioPlayback} disabled={!settings.cameraAudio} onChange={(cameraNoAudioPlayback) => updateSettings({ cameraNoAudioPlayback })} />
              <label className="field">
                <span>Audio source</span>
                <select value={settings.cameraAudioSource} disabled={!settings.cameraAudio} onChange={(event) => updateSettings({ cameraAudioSource: coerceAudioSource(event.currentTarget.value) })}>
                  <option value="mic">Microphone</option>
                  <option value="mic-unprocessed">Raw microphone</option>
                  <option value="mic-camcorder">Camcorder mic</option>
                  <option value="mic-voice-recognition">Voice recognition</option>
                  <option value="mic-voice-communication">Voice communication</option>
                  <option value="output">Device output</option>
                  <option value="playback">Playback</option>
                </select>
              </label>
              <div className="field-grid">
                <label className="field">
                  <span>Video codec</span>
                  <select value={settings.videoCodec} onChange={(event) => updateSettings({ videoCodec: coerceCodec(event.currentTarget.value) })}>
                    <option value="h264">H.264</option>
                    <option value="h265">H.265</option>
                    <option value="av1">AV1</option>
                  </select>
                </label>
                <label className="field">
                  <span>Bitrate</span>
                  <input value={settings.bitRate} onChange={(event) => updateSettings({ bitRate: event.currentTarget.value })} />
                </label>
                <label className="field">
                  <span>Audio bitrate</span>
                  <input value={settings.audioBitRate} disabled={!settings.cameraAudio} onChange={(event) => updateSettings({ audioBitRate: event.currentTarget.value })} />
                </label>
              </div>
            </article>

            <article className="settings-panel">
              <div className="panel-heading">
                <h2>Virtual Camera</h2>
                <span>{v4l2Available ? "V4L2" : "Windows bridge"}</span>
              </div>
              {v4l2Available ? (
                <>
                  <p className="panel-note">Output can be sent to a v4l2 loopback camera device.</p>
                  <label className="field">
                    <span>V4L2 device</span>
                    <input value={settings.v4l2Sink} onChange={(event) => updateSettings({ v4l2Sink: event.currentTarget.value })} />
                  </label>
                  <NumberInput label="V4L2 buffer" value={settings.v4l2Buffer} min={0} max={2000} onChange={(v4l2Buffer) => updateSettings({ v4l2Buffer })} />
                  <ToggleRow label="Hide preview window" value={settings.v4l2NoPlayback} onChange={(v4l2NoPlayback) => updateSettings({ v4l2NoPlayback })} />
                </>
              ) : (
                <>
                  <div className="virtual-status-grid">
                    <div className={virtualCameraStatus?.registered64 ? "ready" : ""}>
                      <strong>64-bit camera</strong>
                      <span>{virtualCameraStatus?.registered64 ? "Registered" : "Not registered"}</span>
                    </div>
                    <div className={virtualCameraStatus?.registered32 ? "ready" : ""}>
                      <strong>32-bit camera</strong>
                      <span>{virtualCameraStatus?.registered32 ? "Registered" : "Not registered"}</span>
                    </div>
                    <div className={virtualCameraStatus?.running ? "ready" : ""}>
                      <strong>Bridge</strong>
                      <span>{virtualCameraStatus?.running ? "Running" : "Stopped"}</span>
                    </div>
                  </div>
                  <p className="panel-note">
                    Uses OBS's DirectShow module and shared-memory frame queue. Install/repair opens the Windows elevation prompt because camera registration writes to HKLM.
                  </p>
                </>
              )}
              <div className="action-row">
                {!v4l2Available ? (
                  <button className="ghost-action" type="button" onClick={() => void installVirtualCamera()} disabled={virtualCameraBusy || !virtualCameraStatus?.available}>
                    Install/repair
                  </button>
                ) : null}
                <button
                  className="primary-action"
                  type="button"
                  onClick={() => void startCameraVirtual()}
                  disabled={virtualCameraBusy || (!v4l2Available && !virtualCameraStatus?.registered64)}
                >
                  <Camera size={18} />
                  Start webcam
                </button>
                <button className="ghost-action" type="button" onClick={() => void stopCameraVirtual()}>
                  <Square size={18} />
                  Stop
                </button>
              </div>
              {!v4l2Available ? (
                <div className="secondary-action-row">
                  <button type="button" onClick={() => void startVirtualCameraTest()} disabled={virtualCameraBusy || !virtualCameraStatus?.registered64}>
                    Test pattern
                  </button>
                  <button type="button" onClick={() => void uninstallVirtualCamera()} disabled={virtualCameraBusy || (!virtualCameraStatus?.registered64 && !virtualCameraStatus?.registered32)}>
                    Uninstall camera
                  </button>
                </div>
              ) : null}
            </article>

            <article className="settings-panel">
              <div className="panel-heading">
                <h2>Camera Tools</h2>
                <span>Device report</span>
              </div>
              <div className="tool-buttons">
                <button className="ghost-action" type="button" onClick={() => void runUtility("--list-cameras", "Camera list")} disabled={Boolean(utilityBusy)}>
                  <Camera size={18} />
                  Cameras
                </button>
                <button className="ghost-action" type="button" onClick={() => void runUtility("--list-camera-sizes", "Camera sizes")} disabled={Boolean(utilityBusy)}>
                  <ChevronRight size={18} />
                  Sizes
                </button>
              </div>
              <pre className="utility-output compact">{utilityBusy ? "Running..." : utilityOutput || "Camera output appears here."}</pre>
            </article>
          </section>
        ) : null}

        {activeView === "tools" ? (
          <section className="tools-layout">
            <article className="settings-panel">
              <div className="panel-heading">
                <h2>Device</h2>
                <span>{selectedDevice?.state ?? "offline"}</span>
              </div>
              <div className="device-details">
                <strong>{selectedDevice?.label ?? "No device"}</strong>
                <span>{selectedDevice?.details || "ADB must show the device as allowed."}</span>
              </div>
              <div className="tool-buttons">
                <button className="ghost-action" type="button" onClick={() => void runUtility("--list-displays", "Display list")} disabled={Boolean(utilityBusy)}>
                  <Monitor size={18} />
                  Displays
                </button>
                <button className="ghost-action" type="button" onClick={() => void runUtility("--list-encoders", "Encoder list")} disabled={Boolean(utilityBusy)}>
                  <Settings size={18} />
                  Encoders
                </button>
                <button className="ghost-action" type="button" onClick={() => void runUtility("--list-cameras", "Camera list")} disabled={Boolean(utilityBusy)}>
                  <ChevronRight size={18} />
                  Cameras
                </button>
              </div>
            </article>
            <pre className="utility-output">{utilityBusy ? "Running..." : utilityOutput || "Tool output appears here."}</pre>
          </section>
        ) : null}
      </section>

      <aside className="side-panel">
        <section className="mini-card">
          <div className="mini-heading">
            <h2>Running</h2>
            {sessions.length > 0 ? <button type="button" onClick={() => void stopAllSessions()}>Close all</button> : null}
          </div>
          <div className="session-list">
            {sessions.slice(0, 5).map((session) => (
              <article className="session-card small" key={session.id}>
                <div className="session-dot" />
                <div>
                  <h3>{session.name}</h3>
                  <p>{formatTime(session.startedAt)}</p>
                </div>
                <button className="icon-button" type="button" title="Close window" onClick={() => void stopSession(session.id)}>
                  <X size={16} />
                </button>
              </article>
            ))}
            {sessions.length === 0 ? <p className="muted-text">No separate app windows.</p> : null}
          </div>
        </section>

        <section className="mini-card">
          <div className="mini-heading">
            <h2>Launch</h2>
            {settings.audio ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </div>
          <dl className="launch-summary">
            <div>
              <dt>Display</dt>
              <dd>{settings.width}x{settings.height}</dd>
            </div>
            <div>
              <dt>Flex</dt>
              <dd>{settings.flex ? "On" : "Off"}</dd>
            </div>
            <div>
              <dt>Audio</dt>
              <dd>{settings.audio ? (settings.audioDup ? "PC + device" : "PC") : "Off"}</dd>
            </div>
            <div>
              <dt>Codec</dt>
              <dd>{settings.videoCodec.toUpperCase()}</dd>
            </div>
            <div>
              <dt>Phone screen</dt>
              <dd>{settings.turnScreenOff ? "Black" : "On"}</dd>
            </div>
          </dl>
        </section>

        <section className="mini-card log-card">
          <div className="mini-heading">
            <h2>Log</h2>
            <button type="button" onClick={() => setLogs([])}>Clear</button>
          </div>
          <div className="log-list">
            {logs.map((entry) => (
              <article className={`log-line ${entry.level}`} key={entry.id}>
                <span>{entry.time}</span>
                <p>{entry.message}</p>
              </article>
            ))}
            {logs.length === 0 ? <p className="muted-text">No events yet.</p> : null}
          </div>
        </section>
      </aside>
    </main>
  );
}
