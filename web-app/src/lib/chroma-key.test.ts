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

/** 画一个矩形前景区域 */
function fillRect(
  data: Uint8ClampedArray,
  width: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rgb: [number, number, number],
) {
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      const i = (y * width + x) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 255;
    }
  }
}

describe("chroma key", () => {
  test("自动检测绿幕并把绿色背景变透明、前景保留", () => {
    const width = 12;
    const height = 12;
    // 全图绿幕
    const frame = makeFrame(width, height, [0, 220, 0]);
    // 8×6 红色前景块，确保中心像素不受边缘腐蚀影响
    fillRect(frame, width, 2, 3, 9, 8, [220, 40, 30]);

    expect(detectKeyChannel(frame, width, height)).toBe("green");

    const keyed = chromaKeyRgba(frame, width, height, "auto");

    // 四角：纯绿背景 → 全透明
    expect(keyed[3]).toBe(0);
    expect(keyed[(height - 1) * width * 4 + 3]).toBe(0);

    // 前景中心 (6, 5)：距边缘 >3px，不受软收边影响 → alpha 255
    const centerIdx = (5 * width + 6) * 4 + 3;
    expect(keyed[centerIdx]).toBe(255);

    // 前景边缘附近 (3, 4)：受软收边影响 → alpha 降低但不为 0
    const edgeIdx = (4 * width + 3) * 4 + 3;
    expect(keyed[edgeIdx]).toBeGreaterThan(0);
    expect(keyed[edgeIdx]).toBeLessThan(255);
  });

  test("自动检测蓝幕并拒绝非绿蓝背景", () => {
    const blueFrame = makeFrame(8, 8, [0, 40, 220]);
    expect(detectKeyChannel(blueFrame, 8, 8)).toBe("blue");

    const grayFrame = makeFrame(8, 8, [120, 120, 120]);
    expect(() => detectKeyChannel(grayFrame, 8, 8)).toThrow("未检测到绿幕或蓝幕");
  });

  test("强制指定绿幕模式正确去除绿色背景", () => {
    const width = 12;
    const height = 12;
    const frame = makeFrame(width, height, [0, 200, 0]);
    fillRect(frame, width, 2, 3, 9, 8, [200, 30, 20]);

    const keyed = chromaKeyRgba(frame, width, height, "green");

    // 背景角 alpha = 0
    expect(keyed[3]).toBe(0);
    // 前景中心 alpha = 255
    expect(keyed[(5 * width + 6) * 4 + 3]).toBe(255);
  });

  test("实色暖黄像素在 despill 边缘带内不被压绿", () => {
    // 回归场景：源 4:2:0 噪声让黄色图案部分像素 alpha 微降，
    // 9x9 腐蚀把整个邻域划入 despill band；暖黄天然满足 G > (R+B)/2，
    // 若无条件压制会把黄色压成深橙色的"噪点块"
    const width = 20;
    const height = 20;
    const frame = makeFrame(width, height, [0, 200, 0]);
    // 大块暖黄前景 (230, 175, 60)
    fillRect(frame, width, 4, 4, 15, 15, [230, 175, 60]);
    // 中心挖一个偏绿像素（alpha 低洼，会把周围 4px 拖进 despill band）
    const holeIdx = (9 * width + 9) * 4;
    frame[holeIdx] = 100;
    frame[holeIdx + 1] = 220;
    frame[holeIdx + 2] = 40;

    const keyed = chromaKeyRgba(frame, width, height, "green");

    // 距洞 3px 的暖黄像素 (9,6)：处于 despill band（半径 4px）内、
    // 又在软收边（半径 2px）之外 → alpha = 1 且 RGB 保留键控结果。
    // G 通道必须保持 175 附近（误伤时会被压到 (230+60)/2 = 145）
    const nearIdx = (6 * width + 9) * 4;
    expect(keyed[nearIdx + 3]).toBe(255);
    expect(keyed[nearIdx + 1]).toBeGreaterThanOrEqual(170);
    // R 通道保持暖色
    expect(keyed[nearIdx]).toBeGreaterThanOrEqual(225);
  });
});
