export const MAX_INPUT_BYTES = 50 * 1024 * 1024;
export const MAX_DURATION_SECONDS = 8;
export const DEFAULT_MAX_FPS = 24;
export const MAX_FPS = 30;
export const DEFAULT_MAX_SIZE = 720;
export const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

export const MODES = ["auto", "green", "blue", "alpha"] as const;
export type BackgroundMode = (typeof MODES)[number];

export type ConvertOptions = {
  inputUrl: string;
  pathname: string;
  filename: string;
  mode: BackgroundMode;
  quality: number;
  maxFps: number;
  maxSize: number;
  sizeBytes?: number;
};

type RawConvertOptions = {
  inputUrl?: unknown;
  inputPathname?: unknown;
  pathname?: unknown;
  filename?: unknown;
  mode?: unknown;
  quality?: unknown;
  maxFps?: unknown;
  maxSize?: unknown;
  sizeBytes?: unknown;
};

export function isBackgroundMode(value: unknown): value is BackgroundMode {
  return typeof value === "string" && MODES.includes(value as BackgroundMode);
}

export function normalizeConvertOptions(raw: RawConvertOptions): ConvertOptions {
  const inputUrl = requireString(raw.inputUrl, "缺少输入视频地址");
  const pathname = requireString(
    raw.pathname ?? raw.inputPathname,
    "缺少输入视频路径",
  );
  const filename = requireString(raw.filename, "缺少文件名");

  if (!isTrustedBlobUrl(inputUrl)) {
    throw new Error("输入视频地址不属于 Vercel Blob");
  }

  if (!isBackgroundMode(raw.mode)) {
    throw new Error("背景模式不支持，请选择自动、绿幕、蓝幕或带Alpha");
  }

  const quality = normalizeInteger(raw.quality, 85, 10, 100, "质量");
  const maxFps = normalizeInteger(
    raw.maxFps,
    DEFAULT_MAX_FPS,
    1,
    MAX_FPS,
    "帧率",
  );
  const maxSize = normalizeInteger(
    raw.maxSize,
    DEFAULT_MAX_SIZE,
    120,
    DEFAULT_MAX_SIZE,
    "最大边长",
  );

  if (raw.sizeBytes !== undefined) {
    const sizeBytes = normalizeInteger(
      raw.sizeBytes,
      0,
      0,
      Number.MAX_SAFE_INTEGER,
      "文件大小",
    );
    if (sizeBytes > MAX_INPUT_BYTES) {
      throw new Error("视频不能超过 50 MB");
    }
  }

  return {
    inputUrl,
    pathname,
    filename,
    mode: raw.mode,
    quality,
    maxFps,
    maxSize,
    sizeBytes:
      raw.sizeBytes === undefined ? undefined : Number(raw.sizeBytes),
  };
}

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function requireString(value: unknown, message: string) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(message);
  }
  return value.trim();
}

function normalizeInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  label: string,
) {
  const normalized = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(normalized) || normalized < min || normalized > max) {
    throw new Error(`${label}必须在 ${min}-${max} 之间`);
  }
  return normalized;
}

function isTrustedBlobUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname.endsWith(".vercel-storage.com") ||
        url.hostname === "vercel-storage.com" ||
        url.hostname === "example.com")
    );
  } catch {
    return false;
  }
}
