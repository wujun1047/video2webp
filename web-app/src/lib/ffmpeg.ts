import ffmpeg from "@ffmpeg-installer/ffmpeg";
import { mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

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
  const framePattern = join(options.keyedDir, "frame_%04d.png");
  await runFfmpeg([
    "-y",
    "-framerate",
    String(options.fps),
    "-i",
    framePattern,
    // yuva420p 像素格式确保 WebP 输出保留 alpha 通道，避免帧间残影
    "-pix_fmt",
    "yuva420p",
    "-loop",
    "0",
    "-c:v",
    "libwebp",
    "-lossless",
    "0",
    "-q:v",
    String(options.quality),
    "-preset",
    "default",
    "-an",
    "-vsync",
    "0",
    options.outputPath,
  ]);

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
