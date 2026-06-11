import sharp from "sharp";

import type { BackgroundMode } from "./validation";

type KeyChannel = "green" | "blue";

const LOW = 20;
const HIGH = 90;
const BAND_PX = 4;

// ── 辅助函数 ──────────────────────────────────────────

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** 中位数（排序后取中间值），用于背景色估计 */
function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** 最小值滤波（PIL MinFilter 等价）：方形核 2r+1 × 2r+1 */
function minFilter(
  data: Uint8ClampedArray | Uint8Array | Buffer,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  const out = new Uint8Array(width * height);
  const size = radius * 2 + 1;

  // 逐行滑动窗口最小值
  for (let y = 0; y < height; y++) {
    // 对当前行做 1D min filter
    const rowMin = new Uint8Array(width);
    for (let x = 0; x < width; x++) {
      let minVal = 255;
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = clamp(x + dx, 0, width - 1);
        minVal = Math.min(minVal, data[y * width + nx]);
      }
      rowMin[x] = minVal;
    }

    // 对列方向堆积
    for (let dy = -radius; dy <= radius; dy++) {
      const ny = clamp(y + dy, 0, height - 1);
      for (let x = 0; x < width; x++) {
        if (dy === -radius) {
          out[y * width + x] = rowMin[x];
        } else {
          out[y * width + x] = Math.min(
            out[y * width + x],
            data[ny * width + x],
          );
        }
      }
    }
  }

  // Second pass: column min
  const colResult = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let minVal = 255;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = clamp(y + dy, 0, height - 1);
        minVal = Math.min(minVal, data[ny * width + x]);
      }
      colResult[y * width + x] = minVal;
    }
  }

  return colResult;
}

/** 最大值滤波（PIL MaxFilter 等价）：方形核 2r+1 × 2r+1 */
function maxFilter(
  data: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  const out = new Uint8Array(width * height);

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let maxVal = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const ny = clamp(y + dy, 0, height - 1);
          const nx = clamp(x + dx, 0, width - 1);
          maxVal = Math.max(maxVal, data[ny * width + nx]);
        }
      }
      out[y * width + x] = maxVal;
    }
  }

  return out;
}

// ── 自动检测 ──────────────────────────────────────────

export function detectKeyChannel(
  rgba: Uint8ClampedArray | Buffer,
  width: number,
  height: number,
): KeyChannel {
  const sample = Math.max(1, Math.min(50, Math.floor(width / 4), Math.floor(height / 4)));
  const sums = [0, 0, 0];
  let count = 0;

  const corners: Array<[number, number]> = [
    [0, 0],
    [width - sample, 0],
    [0, height - sample],
    [width - sample, height - sample],
  ];

  for (const [startX, startY] of corners) {
    for (let y = startY; y < startY + sample; y += 1) {
      for (let x = startX; x < startX + sample; x += 1) {
        const index = (y * width + x) * 4;
        sums[0] += rgba[index];
        sums[1] += rgba[index + 1];
        sums[2] += rgba[index + 2];
        count += 1;
      }
    }
  }

  const mean = sums.map((sum) => sum / count);
  const channel = mean[1] >= mean[2] ? 1 : 2;
  const otherMax = Math.max(mean[0], channel === 1 ? mean[2] : mean[1]);

  if (mean[channel] < 90 || mean[channel] < otherMax * 1.5) {
    throw new Error("未检测到绿幕或蓝幕，请选择 green 或 blue 后重试");
  }

  return channel === 1 ? "green" : "blue";
}

// ── 核心色度键控（六步完整算法） ─────────────────────

export function chromaKeyRgba(
  rgba: Uint8ClampedArray | Buffer,
  width: number,
  height: number,
  mode: BackgroundMode,
) {
  const keyChannel = mode === "auto" ? detectKeyChannel(rgba, width, height) : mode;
  const channel = keyChannel === "green" ? 1 : 2;
  const others: [number, number] = channel === 1 ? [0, 2] : [0, 1];
  const pixelCount = width * height;

  // ── 步骤 1+2：色差键 + 连续 alpha ──────────────
  const fg = new Float32Array(pixelCount * 3);
  const alpha = new Float32Array(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    const idx = i * 4;
    const r = rgba[idx];
    const g = rgba[idx + 1];
    const b = rgba[idx + 2];
    const values = [r, g, b];
    const key = values[channel] - Math.max(values[others[0]], values[others[1]]);
    const a = 1.0 - clamp((key - LOW) / (HIGH - LOW), 0, 1);

    fg[i * 3] = r;
    fg[i * 3 + 1] = g;
    fg[i * 3 + 2] = b;
    alpha[i] = a;
  }

  // ── 步骤 3：背景反混合 ─────────────────────────
  // 收集纯背景像素的 RGB，取中位数作为背景色，然后反解前景
  const bgR: number[] = [];
  const bgG: number[] = [];
  const bgB: number[] = [];

  for (let i = 0; i < pixelCount; i++) {
    const values = [fg[i * 3], fg[i * 3 + 1], fg[i * 3 + 2]];
    const key = values[channel] - Math.max(values[others[0]], values[others[1]]);
    if (key > HIGH) {
      bgR.push(values[0]);
      bgG.push(values[1]);
      bgB.push(values[2]);
      if (bgR.length > 5000) break; // 采样足够多就停
    }
  }

  if (bgR.length > 100) {
    const bgColor = [median(bgR), median(bgG), median(bgB)];

    for (let i = 0; i < pixelCount; i++) {
      if (alpha[i] > 0.01) {
        const a = alpha[i];
        fg[i * 3] = clamp((fg[i * 3] - (1 - a) * bgColor[0]) / a, 0, 255);
        fg[i * 3 + 1] = clamp((fg[i * 3 + 1] - (1 - a) * bgColor[1]) / a, 0, 255);
        fg[i * 3 + 2] = clamp((fg[i * 3 + 2] - (1 - a) * bgColor[2]) / a, 0, 255);
      } else {
        fg[i * 3] = 0;
        fg[i * 3 + 1] = 0;
        fg[i * 3 + 2] = 0;
      }
    }
  }

  // ── 步骤 4：边缘带强 despill ────────────────────
  const alphaU8 = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    alphaU8[i] = Math.round(alpha[i] * 255);
  }

  const eroded = minFilter(alphaU8, width, height, BAND_PX);

  for (let i = 0; i < pixelCount; i++) {
    // band: alpha > 0 但 eroded < 250 → 边缘带
    if (alphaU8[i] > 0 && eroded[i] < 250) {
      const oMean = (fg[i * 3 + others[0]] + fg[i * 3 + others[1]]) / 2;
      fg[i * 3 + channel] = Math.min(fg[i * 3 + channel], oMean);
    }
    // 全透明像素颜色清零
    if (alphaU8[i] === 0) {
      fg[i * 3] = 0;
      fg[i * 3 + 1] = 0;
      fg[i * 3 + 2] = 0;
    }
  }

  // ── 步骤 5：软收边（choke），top-hat 保护细发丝 ──
  // er: alpha 5px 腐蚀 → 取内缩后的轮廓
  const er = minFilter(alphaU8, width, height, 2); // radius 2 → 5x5 kernel
  // op: 对腐蚀结果再膨胀
  const op = maxFilter(er, width, height, 2);

  for (let i = 0; i < pixelCount; i++) {
    const A = alphaU8[i];
    const topHat = clamp(A - op[i], 0, 255);
    const soft = (A + er[i]) / 2;
    alpha[i] = Math.min(Math.max(soft, topHat * 0.85), A) / 255.0;
  }

  // ── 步骤 6：颜色净化（extend） ───────────────────
  // 实色区（alpha >= 0.65）内缩 band_px 得到核心区
  const solid = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    solid[i] = alpha[i] >= 0.65 ? 255 : 0;
  }

  const coreMask = minFilter(solid, width, height, BAND_PX);
  const core = new Float32Array(pixelCount * 3);
  let filled = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    if (coreMask[i] > 128) {
      core[i * 3] = fg[i * 3];
      core[i * 3 + 1] = fg[i * 3 + 1];
      core[i * 3 + 2] = fg[i * 3 + 2];
      filled[i] = 1;
    }
  }

  // 迭代向外延展核心颜色
  const iterations = 10 + BAND_PX * 2;
  for (let iter = 0; iter < iterations; iter++) {
    let anyFilled = false;
    const newFilled = new Uint8Array(filled);
    const newColor = new Float32Array(core);

    for (let i = 0; i < pixelCount; i++) {
      if (filled[i]) {
        anyFilled = true;
        continue;
      }

      const y = Math.floor(i / width);
      const x = i - y * width;
      let sumR = 0, sumG = 0, sumB = 0, neighborCount = 0;

      // 检查 8 个邻居
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dy === 0 && dx === 0) continue;
          const ny = y + dy;
          const nx = x + dx;
          if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
          const ni = ny * width + nx;
          if (filled[ni]) {
            sumR += core[ni * 3];
            sumG += core[ni * 3 + 1];
            sumB += core[ni * 3 + 2];
            neighborCount++;
          }
        }
      }

      if (neighborCount > 0) {
        newColor[i * 3] = sumR / neighborCount;
        newColor[i * 3 + 1] = sumG / neighborCount;
        newColor[i * 3 + 2] = sumB / neighborCount;
        newFilled[i] = 1;
      }
    }

    // 更新 core 和 filled
    for (let i = 0; i < pixelCount; i++) {
      if (newFilled[i] && !filled[i]) {
        core[i * 3] = newColor[i * 3];
        core[i * 3 + 1] = newColor[i * 3 + 1];
        core[i * 3 + 2] = newColor[i * 3 + 2];
      }
    }
    filled = newFilled;

    if (anyFilled && filled.every((v) => v === 1)) break;
  }

  // 半透明像素（alpha < 0.65）用延展色替换
  for (let i = 0; i < pixelCount; i++) {
    if (alpha[i] < 0.65 && filled[i]) {
      fg[i * 3] = core[i * 3];
      fg[i * 3 + 1] = core[i * 3 + 1];
      fg[i * 3 + 2] = core[i * 3 + 2];
    }
  }

  // ── 组装输出 RGBA ─────────────────────────────
  const output = new Uint8ClampedArray(pixelCount * 4);
  for (let i = 0; i < pixelCount; i++) {
    const idx = i * 4;
    output[idx] = clamp(Math.round(fg[i * 3]), 0, 255);
    output[idx + 1] = clamp(Math.round(fg[i * 3 + 1]), 0, 255);
    output[idx + 2] = clamp(Math.round(fg[i * 3 + 2]), 0, 255);
    output[idx + 3] = Math.round(alpha[i] * 255);
  }

  return output;
}

export async function chromaKeyPngFile(
  inputPath: string,
  outputPath: string,
  mode: BackgroundMode,
) {
  const image = sharp(inputPath).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const keyed = chromaKeyRgba(data, info.width, info.height, mode);

  await sharp(Buffer.from(keyed), {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .png()
    .toFile(outputPath);
}
