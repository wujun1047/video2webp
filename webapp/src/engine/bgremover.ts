/**
 * @imgly/background-removal 封装
 *
 * 在浏览器中运行 AI 模型去除图片背景
 * 模型文件首次使用时自动下载（~40MB），之后缓存于浏览器
 */

import { removeBackground } from '@imgly/background-removal';
import { imageBitmapToImageData } from '../utils/imageDataUtils';

/** 模型配置类型 */
export type ModelConfig = 'small' | 'medium' | 'large';

/** 处理选项 */
export interface BgRemovalOptions {
  model?: ModelConfig;
  onProgress?: (current: number, total: number) => void;
}

/** 单帧去背景结果：同时保留原始帧和去背景帧（后处理需要原始帧做参考） */
export interface FramePair {
  original: ImageData;
  nobg: ImageData;
}

/**
 * 对单张图片去背景
 * @returns { original, nobg } — 原始帧和去背景帧
 */
export async function removeBgSingle(
  bitmap: ImageBitmap,
  options: BgRemovalOptions = {},
): Promise<FramePair> {
  const { model = 'medium' } = options;

  // 映射模型名到 @imgly 的模型 ID
  const modelMap: Record<ModelConfig, string> = {
    small: 'isnet_quint8',
    medium: 'isnet_fp16',
    large: 'isnet',
  };

  // 保存原始帧 ImageData
  const original = imageBitmapToImageData(bitmap);

  // 将 ImageBitmap 转为 Blob 用于去背景 API
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), 'image/png'),
  );

  // 调用去背景
  const resultBlob = await removeBackground(blob, {
    model: modelMap[model] as 'isnet' | 'isnet_fp16' | 'isnet_quint8',
    output: {
      format: 'image/png',
      quality: 1,
    },
  });

  // 转回 ImageData
  const resultBitmap = await createImageBitmap(resultBlob);
  const nobg = imageBitmapToImageData(resultBitmap);
  resultBitmap.close();

  return { original, nobg };
}

/**
 * 批量去背景处理
 * @returns FramePair 数组，每个包含原始帧和去背景帧
 */
export async function removeBgBatch(
  frames: ImageBitmap[],
  options: BgRemovalOptions = {},
): Promise<FramePair[]> {
  const { onProgress } = options;
  const total = frames.length;
  const results: FramePair[] = [];

  for (let i = 0; i < total; i++) {
    const pair = await removeBgSingle(frames[i], options);
    results.push(pair);
    onProgress?.(i + 1, total);
  }

  return results;
}
