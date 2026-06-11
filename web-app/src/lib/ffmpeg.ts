import ffmpeg from "@ffmpeg-installer/ffmpeg";
import { existsSync } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { execSync, spawn } from "node:child_process";

export type VideoInfo = {
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
};

export async function probeVideo(inputPath: string): Promise<VideoInfo> {
  const result = await runFfmpeg(["-hide_banner", "-i", inputPath], {
    allowNonZeroExit: true,
  });
  const text = `${result.stderr}\n${result.stdout}`;
  const duration = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const stream = text.match(/Video:.*?,\s*(\d{2,5})x(\d{2,5}).*?(?:(\d+(?:\.\d+)?)\s*fps)?/);

  if (!duration || !stream) {
    throw new Error("无法读取视频信息");
  }

  const hours = Number(duration[1]);
  const minutes = Number(duration[2]);
  const seconds = Number(duration[3]);
  const fps = stream[3] ? Math.round(Number(stream[3])) : 30;

  return {
    durationSeconds: hours * 3600 + minutes * 60 + seconds,
    width: Number(stream[1]),
    height: Number(stream[2]),
    fps,
  };
}

export async function extractFrames(options: {
  inputPath: string;
  framesDir: string;
  sourceFps: number;
  maxFps: number;
  maxSize: number;
}) {
  await mkdir(options.framesDir, { recursive: true });
  const fps = Math.min(options.sourceFps || options.maxFps, options.maxFps);
  const scale = `scale='if(gt(iw,ih),min(${options.maxSize},iw),-2)':'if(gt(iw,ih),-2,min(${options.maxSize},ih))'`;

  await runFfmpeg([
    "-y",
    "-i",
    options.inputPath,
    "-vf",
    `fps=${fps},${scale}`,
    join(options.framesDir, "frame_%04d.png"),
  ]);

  return listPngFrames(options.framesDir);
}

export async function encodeWebp(options: {
  keyedDir: string;
  outputPath: string;
  fps: number;
  quality: number;
}) {
  const frames = await listPngFrames(options.keyedDir);
  if (frames.length === 0) {
    throw new Error("没有可编码的帧");
  }

  // 使用 Google 官方 img2webp，避免 ffmpeg WebP muxer 的 frame blending bug
  // ffmpeg 的 WebP muxer 在透明动图上会导致帧间残影（ticket #7941, #9531）
  const durationMs = Math.round(1000 / options.fps);
  const img2webpPath = findBinary("img2webp", ["bin/img2webp"]);
  if (!img2webpPath) {
    throw new Error("未找到 img2webp 二进制，请检查 npm install 是否正常完成");
  }
  await runImg2webp(img2webpPath, frames, durationMs, options.quality, options.outputPath);

  const outputStat = await stat(options.outputPath);
  return outputStat.size;
}

async function runImg2webp(
  binaryPath: string,
  frames: string[],
  durationMs: number,
  quality: number,
  outputPath: string,
) {
  await spawnPromise(
    binaryPath,
    [
      "-d",
      String(durationMs),
      "-lossy",
      "-q",
      String(quality),
      "-loop",
      "0",
      "-o",
      outputPath,
      ...frames,
    ],
  );
}

function spawnPromise(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`img2webp 执行失败: ${stderr.slice(0, 2000)}`));
    });
  });
}

export async function listPngFrames(dir: string) {
  const files = await readdir(dir);
  return files
    .filter((file) => file.endsWith(".png"))
    .sort()
    .map((file) => join(dir, file));
}

function findBinary(name: string, extraPaths: string[]) {
  // 1. 先从项目内搜索（Vercel 通过 outputFileTracingIncludes 引入）
  for (const p of extraPaths) {
    const full = join(process.cwd(), p);
    if (existsSync(full)) return full;
  }
  // 2. 从系统 PATH 搜索（本地开发用）
  try {
    return execSync(`which ${name}`, { encoding: "utf8" }).trim();
  } catch {}
  return null;
}

async function runFfmpeg(
  args: string[],
  options: { allowNonZeroExit?: boolean } = {},
) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(ffmpeg.path, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const result = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };

      if (code === 0 || options.allowNonZeroExit) {
        resolve(result);
        return;
      }

      reject(new Error(`ffmpeg 执行失败: ${result.stderr.slice(0, 2000)}`));
    });
  });
}
