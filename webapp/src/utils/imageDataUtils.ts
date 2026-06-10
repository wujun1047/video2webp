/**
 * ImageData 像素操作工具
 * 提供创建、克隆、像素级操作等基础能力
 */

/** 创建一个新的 ImageData，用指定颜色填充 */
export function createImageData(
  width: number,
  height: number,
  fill: [number, number, number, number] = [0, 0, 0, 0],
): ImageData {
  const data = new ImageData(width, height);
  const [r, g, b, a] = fill;
  for (let i = 0; i < data.data.length; i += 4) {
    data.data[i] = r;
    data.data[i + 1] = g;
    data.data[i + 2] = b;
    data.data[i + 3] = a;
  }
  return data;
}

/** 深拷贝 ImageData */
export function cloneImageData(src: ImageData): ImageData {
  const dst = new ImageData(src.width, src.height);
  dst.data.set(src.data);
  return dst;
}

/** 从 ImageBitmap 创建 ImageData（通过 Canvas） */
export function imageBitmapToImageData(bitmap: ImageBitmap): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

/** 将 ImageData 绘制到 Canvas 并返回 */
export function imageDataToCanvas(imgData: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = imgData.width;
  canvas.height = imgData.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/** 缩放 ImageData 到指定尺寸 */
export function resizeImageData(
  src: ImageData,
  targetWidth: number,
  targetHeight: number,
): ImageData {
  const srcCanvas = imageDataToCanvas(src);
  const dstCanvas = document.createElement('canvas');
  dstCanvas.width = targetWidth;
  dstCanvas.height = targetHeight;
  const ctx = dstCanvas.getContext('2d')!;
  ctx.drawImage(srcCanvas, 0, 0, targetWidth, targetHeight);
  return ctx.getImageData(0, 0, targetWidth, targetHeight);
}

/** 从 Blob/ArrayBuffer 创建 ImageData */
export async function blobToImageData(blob: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob);
  const result = imageBitmapToImageData(bitmap);
  bitmap.close();
  return result;
}
