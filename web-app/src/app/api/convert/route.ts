import { del, list, put } from "@vercel/blob";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { NextResponse } from "next/server";

import { chromaKeyPngFile } from "@/lib/chroma-key";
import { cleanupJob, createJobPaths } from "@/lib/temp-dir";
import {
  encodeWebp,
  extractFrames,
  listPngFrames,
  probeVideo,
} from "@/lib/ffmpeg";
import {
  formatBytes,
  MAX_DURATION_SECONDS,
  MAX_OUTPUT_BYTES,
  normalizeConvertOptions,
} from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "缺少 BLOB_READ_WRITE_TOKEN，请先配置 Vercel Blob" },
      { status: 500 },
    );
  }

  let paths: Awaited<ReturnType<typeof createJobPaths>> | null = null;

  // 惰性清理：每次转换时顺手删除超过 1 小时的旧输出文件
  cleanupOldOutputs().catch((err) =>
    console.error("清理旧输出文件失败", err),
  );

  try {
    const options = normalizeConvertOptions(await request.json());
    paths = await createJobPaths();

    await downloadToFile(options.inputUrl, paths.input);
    const videoInfo = await probeVideo(paths.input);
    if (videoInfo.durationSeconds > MAX_DURATION_SECONDS) {
      throw new Error(`视频不能超过 ${MAX_DURATION_SECONDS} 秒`);
    }

    const frames = await extractFrames({
      inputPath: paths.input,
      framesDir: paths.framesDir,
      sourceFps: videoInfo.fps,
      maxFps: options.maxFps,
      maxSize: options.maxSize,
    });

    await mkdir(paths.keyedDir, { recursive: true });
    for (const frame of frames) {
      await chromaKeyPngFile(
        frame,
        join(paths.keyedDir, basename(frame)),
        options.mode,
      );
    }

    const effectiveFps = Math.min(videoInfo.fps || options.maxFps, options.maxFps);
    const sizeBytes = await encodeWebp({
      keyedDir: paths.keyedDir,
      outputPath: paths.output,
      fps: effectiveFps,
      quality: options.quality,
    });

    if (sizeBytes > MAX_OUTPUT_BYTES) {
      throw new Error(
        `输出 WebP 为 ${formatBytes(sizeBytes)}，超过 ${formatBytes(MAX_OUTPUT_BYTES)}`,
      );
    }

    const output = await put(
      `outputs/${stripExtension(options.filename)}.webp`,
      await readFile(paths.output),
      {
        access: "public",
        addRandomSuffix: true,
        contentType: "image/webp",
      },
    );

    // 转换完成后删除 Blob 中的输入视频，避免文件积累
    del(options.pathname).catch((err) =>
      console.error("删除输入 Blob 文件失败", err),
    );

    return NextResponse.json({
      outputUrl: output.url,
      outputPathname: output.pathname,
      sizeBytes,
      frames: (await listPngFrames(paths.keyedDir)).length,
      durationMs: Math.round(1000 / effectiveFps),
      input: {
        width: videoInfo.width,
        height: videoInfo.height,
        fps: videoInfo.fps,
        durationSeconds: videoInfo.durationSeconds,
      },
    });
  } catch (error) {
    console.error("convert failed", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: error instanceof Error && error.message.includes("不能超过") ? 400 : 500 },
    );
  } finally {
    if (paths) {
      await cleanupJob(paths);
    }
  }
}

async function downloadToFile(url: string, outputPath: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("下载输入视频失败");
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(outputPath, buffer);
}

function stripExtension(filename: string) {
  return filename.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").slice(0, 80);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "转换失败";
}

const CLEANUP_MAX_AGE_MS = 60 * 60 * 1000; // 1 小时

async function cleanupOldOutputs() {
  const now = Date.now();
  let cursor: string | undefined;

  do {
    const result = await list({
      prefix: "outputs/",
      cursor,
      limit: 100,
    });

    for (const blob of result.blobs) {
      if (now - blob.uploadedAt.getTime() > CLEANUP_MAX_AGE_MS) {
        await del(blob.url).catch((err) =>
          console.error(`删除过期文件失败: ${blob.pathname}`, err),
        );
      }
    }

    cursor = result.cursor;
  } while (cursor);
}
