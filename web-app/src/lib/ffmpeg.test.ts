import { describe, expect, test } from "vitest";

import { parseVideoInfo } from "./ffmpeg";

describe("parseVideoInfo", () => {
  test("qtrle(argb) 检测出 alpha 通道", () => {
    const info = parseVideoInfo(
      `  Duration: 00:00:05.00, bitrate: 443 kb/s\n` +
        `  Stream #0:0[0x1]: Video: qtrle (rle  / 0x20656C72), argb(bt709), 1440x1440, 443223 kb/s, 30 fps, 30 tbr (default)`,
    );
    expect(info.hasAlpha).toBe(true);
    expect(info.width).toBe(1440);
    expect(info.height).toBe(1440);
    expect(info.fps).toBe(30);
    expect(info.durationSeconds).toBe(5);
  });

  test("h264(yuv444p) 无 alpha", () => {
    const info = parseVideoInfo(
      `  Duration: 00:00:05.00\n` +
        `  Stream #0:0[0x1](und): Video: h264 (High 4:4:4 Predictive) (avc1 / 0x31637661), yuv444p(tv, unknown/bt709/bt709, progressive), 1440x1440, 842 kb/s, 30 fps`,
    );
    expect(info.hasAlpha).toBe(false);
  });

  test("yuva 系列也判为带 alpha", () => {
    const info = parseVideoInfo(
      `  Duration: 00:00:03.00\n` +
        `  Stream #0:0: Video: vp9, yuva420p, 1280x720, 24 fps`,
    );
    expect(info.hasAlpha).toBe(true);
  });
});
