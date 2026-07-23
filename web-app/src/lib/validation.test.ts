import { describe, expect, test } from "vitest";

import {
  DEFAULT_MAX_FPS,
  MAX_INPUT_BYTES,
  normalizeConvertOptions,
} from "./validation";

describe("normalizeConvertOptions", () => {
  test("默认使用 24fps 并保留 30fps 高质量模式", () => {
    expect(DEFAULT_MAX_FPS).toBe(24);

    const defaults = normalizeConvertOptions({
      inputUrl: "https://example.com/input.mp4",
      pathname: "inputs/input.mp4",
      filename: "input.mp4",
      mode: "auto",
      quality: 85,
    });
    expect(defaults.maxFps).toBe(24);

    const highQuality = normalizeConvertOptions({
      inputUrl: "https://example.com/input.mp4",
      pathname: "inputs/input.mp4",
      filename: "input.mp4",
      mode: "green",
      quality: 85,
      maxFps: 30,
    });
    expect(highQuality.maxFps).toBe(30);
  });

  test("拒绝 black 模式和超出限制的文件", () => {
    expect(() =>
      normalizeConvertOptions({
        inputUrl: "https://example.com/input.mp4",
        pathname: "inputs/input.mp4",
        filename: "input.mp4",
        mode: "black",
        quality: 85,
      }),
    ).toThrow("背景模式不支持");

    expect(() =>
      normalizeConvertOptions({
        inputUrl: "https://example.com/input.mp4",
        pathname: "inputs/input.mp4",
        filename: "input.mp4",
        mode: "auto",
        quality: 85,
        sizeBytes: MAX_INPUT_BYTES + 1,
      }),
    ).toThrow("视频不能超过");
  });

  test("接受 alpha 模式（带 alpha 通道的源）", () => {
    const result = normalizeConvertOptions({
      inputUrl: "https://example.com/input.mov",
      pathname: "inputs/input.mov",
      filename: "input.mov",
      mode: "alpha",
      quality: 85,
    });
    expect(result.mode).toBe("alpha");
  });
});
