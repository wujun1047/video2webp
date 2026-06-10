/**
 * 后处理引擎 — Canvas ImageData 像素操作
 * 精确对应 Python 脚本的算法逻辑：
 *   cleanup_black.py  → cleanupBlack()
 *   despill.py        → despillGreen()
 *   restore_alpha.py  → restoreAlpha()
 *   cleanup_blue.py   → cleanupBlue()
 *   despill_blue.py   → despillBlue()
 */

import type { BgType } from '../utils/bgDetector';
import { isBlueBg } from '../utils/bgDetector';
import { cloneImageData } from '../utils/imageDataUtils';

// ---- 通用：黑色残留清理 ----
// 对应 cleanup_black.py
// 凡 nobg 中不透明、且原图对应像素 max(R,G,B) <= 15 的 → 透明

const CLEANUP_BLACK_THRESHOLD = 15;

export function cleanupBlack(
  origFrame: ImageData,
  nobgFrame: ImageData,
): ImageData {
  const result = cloneImageData(nobgFrame);
  const orig = origFrame.data;
  const dst = result.data;

  for (let i = 0; i < dst.length; i += 4) {
    const a = dst[i + 3];
    if (a > 0) {
      const maxOrig = Math.max(orig[i], orig[i + 1], orig[i + 2]);
      if (maxOrig <= CLEANUP_BLACK_THRESHOLD) {
        dst[i] = 0;
        dst[i + 1] = 0;
        dst[i + 2] = 0;
        dst[i + 3] = 0;
      }
    }
  }
  return result;
}

// ---- 绿幕溢色修复 ----
// 对应 despill.py
// 如果 G > (R+B)/2，压制 G 到 (R+B)/2

export function despillGreen(frame: ImageData): ImageData {
  const result = cloneImageData(frame);
  const px = result.data;

  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    const a = px[i + 3];
    if (a > 0 && g > (r + b) / 2) {
      px[i + 1] = Math.round((r + b) / 2);
    }
  }
  return result;
}

// ---- 蓝幕溢色修复 ----
// 对应 despill_blue.py
// 如果 B > (R+G)/2，压制 B 到 (R+G)/2

export function despillBlue(frame: ImageData): ImageData {
  const result = cloneImageData(frame);
  const px = result.data;

  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    const a = px[i + 3];
    if (a > 0 && b > (r + g) / 2) {
      px[i + 2] = Math.round((r + g) / 2);
    }
  }
  return result;
}

// ---- 前景修复 ----
// 对应 restore_alpha.py
// 修复被去背景模型误判的前景像素（镂空和变黑）
// 规则：原图非蓝色背景的像素，如果在 nobg 中被抠掉或变暗 → 用原图颜色恢复

const RESTORE_DARK_THRESHOLD = 10;

export function restoreAlpha(
  origFrame: ImageData,
  nobgFrame: ImageData,
): ImageData {
  const result = cloneImageData(nobgFrame);
  const orig = origFrame.data;
  const dst = result.data;

  for (let i = 0; i < dst.length; i += 4) {
    const a = dst[i + 3];
    const or = orig[i];
    const og = orig[i + 1];
    const ob = orig[i + 2];

    // 原图是蓝色背景像素，跳过
    if (isBlueBg(or, og, ob)) continue;

    // 被完全抠掉（镂空）或变黑（RGB 接近 0,0,0）或 半透明
    if (a === 0 || (a > 0 && Math.max(dst[i], dst[i + 1], dst[i + 2]) < RESTORE_DARK_THRESHOLD) || (a > 0 && a < 255)) {
      dst[i] = or;
      dst[i + 1] = og;
      dst[i + 2] = ob;
      dst[i + 3] = 255;
    }
  }
  return result;
}

// ---- 蓝幕清理 ----
// 对应 cleanup_blue.py
// 参照原图，凡原图对应像素为蓝色背景的 → 在去背景帧中设为透明

export function cleanupBlue(
  origFrame: ImageData,
  nobgFrame: ImageData,
): ImageData {
  const result = cloneImageData(nobgFrame);
  const orig = origFrame.data;
  const dst = result.data;

  for (let i = 0; i < dst.length; i += 4) {
    const a = dst[i + 3];
    if (a > 0) {
      const or = orig[i];
      const og = orig[i + 1];
      const ob = orig[i + 2];
      if (isBlueBg(or, og, ob)) {
        dst[i] = 0;
        dst[i + 1] = 0;
        dst[i + 2] = 0;
        dst[i + 3] = 0;
      }
    }
  }
  return result;
}

/**
 * 根据背景类型执行完整的后处理流水线
 * 返回处理后的 ImageData
 *
 * 流水线顺序（来自项目经验）：
 *   蓝幕: restore_alpha → cleanup_blue → despill_blue
 *   绿幕: cleanup_black → despill_green
 *   黑幕: cleanup_black
 */
export function postProcessFrame(
  origFrame: ImageData,
  nobgFrame: ImageData,
  bgType: BgType,
): ImageData {
  let result = nobgFrame;

  switch (bgType) {
    case 'blue':
      // restore_alpha → cleanup_blue → despill_blue
      result = restoreAlpha(origFrame, result);
      result = cleanupBlue(origFrame, result);
      result = despillBlue(result);
      break;

    case 'green':
    case 'auto':
      // cleanup_black → despill_green
      result = cleanupBlack(origFrame, result);
      result = despillGreen(result);
      break;

    case 'black':
      // cleanup_black only
      result = cleanupBlack(origFrame, result);
      break;
  }

  return result;
}
