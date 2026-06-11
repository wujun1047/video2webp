import { describe, expect, test } from "vitest";

import { chromaKeyRgba, detectKeyChannel } from "./chroma-key";

function makeFrame(width: number, height: number, rgb: [number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return data;
}

function setPixel(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  rgb: [number, number, number],
) {
  const index = (y * width + x) * 4;
  data[index] = rgb[0];
  data[index + 1] = rgb[1];
  data[index + 2] = rgb[2];
  data[index + 3] = 255;
}

describe("chroma key", () => {
  test("自动检测绿幕并把绿色背景变透明", () => {
    const width = 8;
    const height = 8;
    const frame = makeFrame(width, height, [0, 220, 0]);
    setPixel(frame, width, 3, 3, [220, 40, 30]);

    expect(detectKeyChannel(frame, width, height)).toBe("green");

    const keyed = chromaKeyRgba(frame, width, height, "auto");
    const cornerAlpha = keyed[3];
    const subjectAlpha = keyed[(3 * width + 3) * 4 + 3];

    expect(cornerAlpha).toBe(0);
    expect(subjectAlpha).toBe(255);
  });

  test("自动检测蓝幕并拒绝非绿蓝背景", () => {
    const blueFrame = makeFrame(8, 8, [0, 40, 220]);
    expect(detectKeyChannel(blueFrame, 8, 8)).toBe("blue");

    const grayFrame = makeFrame(8, 8, [120, 120, 120]);
    expect(() => detectKeyChannel(grayFrame, 8, 8)).toThrow("未检测到绿幕或蓝幕");
  });
});
