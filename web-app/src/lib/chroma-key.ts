import sharp from "sharp";

import type { BackgroundMode } from "./validation";

type KeyChannel = "green" | "blue";

const LOW = 20;
const HIGH = 90;

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

export function chromaKeyRgba(
  rgba: Uint8ClampedArray | Buffer,
  width: number,
  height: number,
  mode: BackgroundMode,
) {
  const keyChannel = mode === "auto" ? detectKeyChannel(rgba, width, height) : mode;
  const channel = keyChannel === "green" ? 1 : 2;
  const output = new Uint8ClampedArray(rgba.length);
  const others = channel === 1 ? [0, 2] : [0, 1];

  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const values = [r, g, b];
    const key = values[channel] - Math.max(values[others[0]], values[others[1]]);
    const alphaRatio = 1 - clamp((key - LOW) / (HIGH - LOW), 0, 1);

    output[i] = r;
    output[i + 1] = g;
    output[i + 2] = b;
    output[i + 3] = Math.round(alphaRatio * 255);

    if (alphaRatio > 0 && alphaRatio < 1) {
      const otherMean = Math.round((values[others[0]] + values[others[1]]) / 2);
      output[i + channel] = Math.min(values[channel], otherMean);
    }
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
