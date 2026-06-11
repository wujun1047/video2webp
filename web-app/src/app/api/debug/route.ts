import { NextResponse } from "next/server";
import { statSync } from "node:fs";

export const runtime = "nodejs";

export async function GET() {
  const info: Record<string, unknown> = {};
  const errors: string[] = [];

  // 1. 检查 ffmpeg 导入
  try {
    const ffmpeg = await import("@ffmpeg-installer/ffmpeg");
    info.ffmpegPath = ffmpeg.default.path;
    info.ffmpegVersion = ffmpeg.default.version;
    info.ffmpegExists = statSync(ffmpeg.default.path).isFile();
  } catch (e) {
    errors.push(`ffmpeg: ${String(e)}`);
  }

  // 2. 检查 sharp
  try {
    await import("sharp");
    info.sharpOk = true;
  } catch (e) {
    errors.push(`sharp: ${String(e)}`);
  }

  // 3. 检查 Blob token
  info.hasBlobToken = !!process.env.BLOB_READ_WRITE_TOKEN;

  // 4. /tmp 目录
  try {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "debug-"));
    info.tmpWritable = true;
    const { rmSync } = await import("node:fs");
    rmSync(dir, { recursive: true });
  } catch (e) {
    errors.push(`/tmp: ${String(e)}`);
  }

  return NextResponse.json({
    info,
    errors,
    nodeVersion: process.version,
    platform: process.platform,
  });
}
