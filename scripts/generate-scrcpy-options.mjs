import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const helpPath = path.join(root, "vendor", "scrcpy-help.txt");
const outPath = path.join(root, "src", "shared", "scrcpyOptions.ts");

const help = fs.readFileSync(helpPath, "utf8").replace(/\r\n/g, "\n");
const lines = help.split("\n");

const choices = {
  "--audio-codec": ["opus", "aac", "flac", "raw"],
  "--audio-source": [
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
  ],
  "--camera-facing": ["front", "back", "external"],
  "--capture-orientation": ["0", "90", "180", "270", "flip0", "flip90", "flip180", "flip270", "@", "@0", "@90", "@180", "@270"],
  "--display-ime-policy": ["local", "fallback", "hide"],
  "--display-orientation": ["0", "90", "180", "270", "flip0", "flip90", "flip180", "flip270"],
  "--gamepad": ["disabled", "uhid", "aoa"],
  "--keyboard": ["disabled", "sdk", "uhid", "aoa"],
  "--mouse": ["disabled", "sdk", "uhid", "aoa"],
  "--orientation": ["0", "90", "180", "270", "flip0", "flip90", "flip180", "flip270"],
  "--pause-on-exit": ["true", "false", "if-error"],
  "--record-format": ["mp4", "mkv", "m4a", "mka", "opus", "aac", "flac", "wav"],
  "--record-orientation": ["0", "90", "180", "270"],
  "--render-driver": ["direct3d", "opengl", "opengles2", "opengles", "metal", "software"],
  "--render-fit": ["letterbox", "stretched", "unscaled"],
  "--verbosity": ["verbose", "debug", "info", "warn", "error"],
  "--video-codec": ["h264", "h265", "av1"],
  "--video-source": ["display", "camera"]
};

const placeholders = {
  "--angle": "degrees",
  "--audio-bit-rate": "128K",
  "--audio-buffer": "50",
  "--audio-codec-options": "profile:int=1,bitrate-mode:int=2",
  "--audio-encoder": "encoder name",
  "--audio-output-buffer": "10",
  "--background-color": "#000000",
  "--camera-ar": "16:9",
  "--camera-fps": "30",
  "--camera-id": "0",
  "--camera-size": "1920x1080",
  "--camera-zoom": "1.0",
  "--crop": "1080:1920:0:0",
  "--display-id": "0",
  "--max-fps": "60",
  "--max-size": "1920",
  "--min-size-alignment": "1",
  "--mouse-bind": "bhsn:++++",
  "--new-display": "1920x1080/420",
  "--port": "27183:27199",
  "--push-target": "/sdcard/Download/",
  "--record": "recording.mp4",
  "--screen-off-timeout": "300",
  "--serial": "device serial",
  "--shortcut-mod": "lalt,lsuper",
  "--start-app": "com.example.app",
  "--tcpip": "+192.168.1.20:5555",
  "--time-limit": "60",
  "--tunnel-host": "localhost",
  "--tunnel-port": "27183",
  "--v4l2-buffer": "0",
  "--v4l2-sink": "/dev/video0",
  "--video-bit-rate": "8M",
  "--video-buffer": "0",
  "--video-codec-options": "profile:int=1",
  "--video-encoder": "encoder name",
  "--window-height": "1920",
  "--window-title": "scrcpy",
  "--window-width": "1080",
  "--window-x": "auto",
  "--window-y": "auto"
};

function titleFromFlag(flag) {
  if (flag === "-G") return "Enable HID Gamepad";
  if (flag === "-K") return "Enable HID Keyboard";
  if (flag === "-M") return "Enable HID Mouse";
  return flag
    .replace(/^--?/, "")
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function categoryFor(flag) {
  if (["--select-usb", "--select-tcpip", "--serial", "--tcpip", "--port", "--force-adb-forward", "--tunnel-host", "--tunnel-port", "--kill-adb-on-close"].includes(flag)) {
    return "Connection";
  }
  if (flag.startsWith("--audio") || flag === "--no-audio" || flag === "--require-audio") {
    return "Audio";
  }
  if (flag.startsWith("--camera") || flag.startsWith("--v4l2")) {
    return "Camera";
  }
  if (["--record", "--record-format", "--record-orientation", "--time-limit"].includes(flag)) {
    return "Recording";
  }
  if (
    flag.startsWith("--window") ||
    ["--fullscreen", "--always-on-top", "--no-window", "--no-window-aspect-ratio-lock", "--no-video-playback", "--no-audio-playback", "--no-playback", "--pause-on-exit", "--render-driver", "--render-fit", "--background-color", "--disable-screensaver", "--flex-display"].includes(flag)
  ) {
    return "Window";
  }
  if (
    flag.startsWith("--keyboard") ||
    flag.startsWith("--mouse") ||
    flag.startsWith("--gamepad") ||
    ["-G", "-K", "-M", "--otg", "--no-control", "--no-clipboard-autosync", "--legacy-paste", "--prefer-text", "--raw-key-events", "--no-key-repeat", "--no-mouse-hover", "--shortcut-mod", "--show-touches"].includes(flag)
  ) {
    return "Input";
  }
  if (
    flag.startsWith("--list") ||
    ["--help", "--version", "--verbosity", "--print-fps"].includes(flag)
  ) {
    return "Utilities";
  }
  if (
    flag.startsWith("--display") ||
    flag.startsWith("--no-vd") ||
    ["--new-display", "--stay-awake", "--keep-active", "--turn-screen-off", "--screen-off-timeout", "--power-off-on-close", "--no-power-on", "--start-app", "--push-target", "--no-cleanup"].includes(flag)
  ) {
    return "Device";
  }
  return "Video";
}

function inputFor(flag, kind, valueName) {
  if (kind === "boolean") return "toggle";
  if (choices[flag]) return "select";
  if (flag === "--background-color") return "color";
  if (["--window-x", "--window-y", "--window-width", "--window-height", "--angle", "--audio-buffer", "--audio-output-buffer", "--camera-fps", "--camera-zoom", "--display-id", "--max-fps", "--max-size", "--min-size-alignment", "--screen-off-timeout", "--time-limit", "--tunnel-port", "--v4l2-buffer", "--video-buffer"].includes(flag)) {
    return "number";
  }
  if (flag === "--record") return "file";
  if (valueName?.includes("path") || flag === "--push-target") return "path";
  return "text";
}

function parseSignature(signature) {
  const aliasParts = signature.split(",").map((part) => part.trim());
  const aliases = [];
  let valueName;
  let optionalValue = false;

  for (const part of aliasParts) {
    const token = part.split(/\s+/)[0];
    if (!token.startsWith("-")) continue;
    const optionalIndex = token.indexOf("[=");
    const equalsIndex = token.indexOf("=");
    let alias = token;
    if (optionalIndex >= 0) {
      alias = token.slice(0, optionalIndex);
      valueName = token.slice(optionalIndex + 2).replace(/^\[/, "").replace(/\]+$/g, "");
      optionalValue = true;
    } else if (equalsIndex >= 0) {
      alias = token.slice(0, equalsIndex);
      valueName = token.slice(equalsIndex + 1);
    }
    aliases.push(alias);
  }

  const longAlias = aliases.find((alias) => alias.startsWith("--"));
  const flag = longAlias ?? aliases[0];
  const kind = valueName ? (optionalValue ? "optional-value" : "value") : "boolean";
  return { aliases, flag, valueName, kind };
}

const options = [];
for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index];
  if (!/^    -/.test(line)) continue;

  const signature = line.trim();
  const descriptionLines = [];
  let cursor = index + 1;
  while (cursor < lines.length && !/^    -/.test(lines[cursor])) {
    const trimmed = lines[cursor].trim();
    if (trimmed) descriptionLines.push(trimmed);
    cursor += 1;
  }

  const parsed = parseSignature(signature);
  const description = descriptionLines.join(" ").replace(/\s+/g, " ").trim();
  const defaultMatch = description.match(/Default is "?([^".]+)"?\./);
  const optionChoices = choices[parsed.flag] ?? [];
  options.push({
    id: parsed.flag.replace(/^-+/, "").replace(/[^a-zA-Z0-9]+/g, "-"),
    flag: parsed.flag,
    aliases: parsed.aliases,
    signature,
    title: titleFromFlag(parsed.flag),
    category: categoryFor(parsed.flag),
    kind: parsed.kind,
    input: inputFor(parsed.flag, parsed.kind, parsed.valueName),
    valueName: parsed.valueName ?? null,
    placeholder: placeholders[parsed.flag] ?? parsed.valueName ?? "",
    defaultValue: defaultMatch?.[1] ?? "",
    choices: optionChoices,
    description
  });
}

const categories = [...new Set(options.map((option) => option.category))].sort();

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(
  outPath,
  `/* This file is generated by scripts/generate-scrcpy-options.mjs from vendor/scrcpy-help.txt. */\n` +
    `export type ScrcpyOptionKind = "boolean" | "value" | "optional-value";\n` +
    `export type ScrcpyOptionInput = "toggle" | "text" | "number" | "select" | "color" | "file" | "path";\n\n` +
    `export interface ScrcpyOption {\n` +
    `  id: string;\n` +
    `  flag: string;\n` +
    `  aliases: string[];\n` +
    `  signature: string;\n` +
    `  title: string;\n` +
    `  category: string;\n` +
    `  kind: ScrcpyOptionKind;\n` +
    `  input: ScrcpyOptionInput;\n` +
    `  valueName: string | null;\n` +
    `  placeholder: string;\n` +
    `  defaultValue: string;\n` +
    `  choices: string[];\n` +
    `  description: string;\n` +
    `}\n\n` +
    `export const SCRCPY_VERSION = "4.0";\n` +
    `export const SCRCPY_OPTION_CATEGORIES = ${JSON.stringify(categories, null, 2)} as const;\n` +
    `export const SCRCPY_OPTIONS: ScrcpyOption[] = ${JSON.stringify(options, null, 2)};\n`,
  "utf8"
);

console.log(`Generated ${options.length} scrcpy options at ${path.relative(root, outPath)}`);
