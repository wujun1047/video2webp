import ffmpeg from "@ffmpeg-installer/ffmpeg";
import { createRequire } from "node:module";
import { mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);

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
  // libwebp-static 在 npm install 时提供对应平台的静态二进制
  const { img2webp } = require("libwebp-static");
  const durationMs = Math.round(1000 / options.fps);
  await spawnPromise(
    img2webp,
    [
      "-d",
      String(durationMs),
      "-lossy",
      "-q",
      String(options.quality),
      "-loop",
      "0",
      "-o",
      options.outputPath,
      ...frames,
    ],
  );

  const outputStat = await stat(options.outputPath);
  return outputStat.size;
}

export async function listPngFrames(dir: string) {
  const files = await readdir(dir);
  return files
    .filter((file) => file.endsWith(".png"))
    .sort()
    .map((file) => join(dir, file));
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
      reject(new Error(`${command} 执行失败: ${stderr.slice(0, 2000)}`));
    });
  });
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
