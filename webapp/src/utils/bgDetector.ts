/** 支持的背景类型 */
export type BgType = 'green' | 'blue' | 'black' | 'auto';

/**
 * 背景色自动检测
 * 采样图片四角和边缘区域，统计主色调
 */
export function detectBgType(imgData: ImageData): BgType {
  const { data, width, height } = imgData;
  const sampleRadius = Math.min(20, Math.floor(Math.min(width, height) * 0.05));

  // 采样区域：四角 + 四边中点
  const regions: [number, number][] = [
    [sampleRadius, sampleRadius], // 左上角
    [width - sampleRadius, sampleRadius], // 右上角
    [sampleRadius, height - sampleRadius], // 左下角
    [width - sampleRadius, height - sampleRadius], // 右下角
    [Math.floor(width / 2), sampleRadius], // 上边中点
    [Math.floor(width / 2), height - sampleRadius], // 下边中点
    [sampleRadius, Math.floor(height / 2)], // 左边中点
    [width - sampleRadius, Math.floor(height / 2)], // 右边中点
  ];

  let totalR = 0, totalG = 0, totalB = 0, count = 0;

  for (const [cx, cy] of regions) {
    for (let dx = -sampleRadius; dx <= sampleRadius; dx++) {
      for (let dy = -sampleRadius; dy <= sampleRadius; dy++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        const idx = (y * width + x) * 4;
        totalR += data[idx];
        totalG += data[idx + 1];
        totalB += data[idx + 2];
        count++;
      }
    }
  }

  const avgR = totalR / count;
  const avgG = totalG / count;
  const avgB = totalB / count;

  // 判断逻辑
  if (avgB > 120 && avgR < 100 && avgB > avgG * 1.5) return 'blue';
  if (avgG > 100 && avgG > avgR * 1.2 && avgG > avgB * 1.2) return 'green';
  if (Math.max(avgR, avgG, avgB) < 30) return 'black';
  return 'green'; // 默认绿幕（最常见的色键背景）
}

/** 判断像素是否为蓝色背景 */
export function isBlueBg(r: number, g: number, b: number): boolean {
  return b > 150 && r < 80 && b > g * 2;
}
