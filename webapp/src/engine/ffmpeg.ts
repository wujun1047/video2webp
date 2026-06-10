/**
 * ffmpeg.wasm 封装 — 视频解码与帧提取
 *
 * 负责：
 * 1. 初始化 ffmpeg.wasm（加载 WASM core）
 * 2. 将上传的视频文件转为浏览器可解码的 MP4
 * 3. 提取所有帧为 ImageBitmap[]
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpeg: FFmpeg | null = null;

/** 初始化 ffmpeg.wasm（只加载一次） */
export async function initFFmpeg(): Promise<FFmpeg> {
  if (ffmpeg && ffmpeg.loaded) return ffmpeg;

  ffmpeg = new FFmpeg();

  // 加载 WASM core（从 CDN）
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  });

  return ffmpeg;
}

/** 将视频文件转为 MP4（浏览器 video 元素可解码的格式） */
export async function convertToMp4(file: File): Promise<Uint8Array> {
  const ff = await initFFmpeg();
  const inputName = 'input' + getExt(file.name);

  await ff.writeFile(inputName, await fetchFile(file));
  await ff.exec([
    '-i', inputName,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'ultrafast',
    '-crf', '18',
    '-an', // 去掉音频
    'output.mp4',
  ]);

  const data = await ff.readFile('output.mp4');
  // 清理
  await ff.deleteFile(inputName);
  await ff.deleteFile('output.mp4');

  return data as Uint8Array;
}

/** 获取视频文件扩展名 */
function getExt(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot) : '.mp4';
}

/**
 * 从视频文件提取所有帧
 * 返回 ImageBitmap 数组
 *
 * @param file 视频文件（MP4 或 MOV）
 * @param targetFps 目标帧率，0 表示保持原帧率
 * @param maxSize 最大边长，0 表示不缩放
 * @param onProgress 进度回调 (current, total)
 */
export async function extractFrames(
  file: File,
  options: {
    targetFps?: number;
    maxSize?: number;
    onProgress?: (current: number, total: number) => void;
  } = {},
): Promise<{
  frames: ImageBitmap[];
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
}> {
  const { targetFps = 0, maxSize = 0, onProgress } = options;

  // 步骤 1：转换为浏览器可播放的 MP4
  onProgress?.(0, 0); // 表示"正在解码视频"

  let videoBlob: Blob;
  const isMp4 = file.name.toLowerCase().endsWith('.mp4');

  if (isMp4) {
    videoBlob = file;
  } else {
    const mp4Data = await convertToMp4(file);
    videoBlob = new Blob([mp4Data as unknown as BlobPart], { type: 'video/mp4' });
  }

  // 步骤 2：用 video 元素提取帧
  const videoUrl = URL.createObjectURL(videoBlob);

  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('视频加载失败'));
    video.src = videoUrl;
  });

  // 获取视频信息
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  const duration = video.duration;
  const sourceFps = targetFps > 0 ? targetFps : 30; // 默认 30fps
  const totalFrames = Math.floor(duration * sourceFps);

  // 计算输出尺寸
  let outWidth = videoWidth;
  let outHeight = videoHeight;
  if (maxSize > 0 && Math.max(videoWidth, videoHeight) > maxSize) {
    const scale = maxSize / Math.max(videoWidth, videoHeight);
    outWidth = Math.round(videoWidth * scale);
    outHeight = Math.round(videoHeight * scale);
  }

  // Canvas 用于提取帧
  const canvas = document.createElement('canvas');
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext('2d')!;

  const frameInterval = 1 / sourceFps;
  const frames: ImageBitmap[] = [];

  for (let i = 0; i < totalFrames; i++) {
    const time = i * frameInterval;
    if (time >= duration) break;

    // Seek 到指定时间
    video.currentTime = time;
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
    });

    // 绘制帧到 Canvas
    ctx.drawImage(video, 0, 0, outWidth, outHeight);

    // 转为 ImageBitmap（比 ImageData 更适合后续处理）
    const bitmap = await createImageBitmap(canvas);
    frames.push(bitmap);

    onProgress?.(i + 1, totalFrames);
  }

  URL.revokeObjectURL(videoUrl);

  return {
    frames,
    width: outWidth,
    height: outHeight,
    fps: sourceFps,
    totalFrames: frames.length,
  };
}

/** 获取 ffmpeg 实例（用于销毁等操作） */
export function getFFmpeg(): FFmpeg | null {
  return ffmpeg;
}
