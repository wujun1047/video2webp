#!/usr/bin/env python3
"""
去除视频帧右下角静态水印（如"即梦"标识）。
通过比较多帧检测静态像素 → 生成水印 mask → OpenCV inpainting 修补。

用法:
    python3 remove_watermark.py <输入目录> <输出目录>
    python3 remove_watermark.py outputs/南博-莫卧儿艺术展-712x960_nobg outputs/南博-莫卧儿艺术展-712x960_clean
"""

import sys
import os
import numpy as np
from PIL import Image
import cv2
from pathlib import Path


# ---------- 配置 ----------
ROI_BOTTOM = 70      # 底部 ROI 高度（像素），水印检测区域
ROI_RIGHT = 180      # 右侧 ROI 宽度
SAMPLE_COUNT = 8     # 帧对相似性检测采样帧数（帧对数量 = C(N,2)）
SIMILARITY_PCT = 0.8 # 至少 80% 的帧对中相似才认为是水印
PAIR_DIFF_THRESHOLD = 20  # 帧对 RGB 差异阈值
ALPHA_MIN = 10       # Alpha 最小值
DILATE_KERNEL = 3    # mask 膨胀核大小
INPAINT_RADIUS = 5   # OpenCV inpainting 半径


def detect_watermark_mask(frames_dir: str, h: int, w: int):
    """通过帧对相似性检测静态水印像素。
    对每对采样帧比较 ROI 区域，统计每个像素在多少帧对中保持相似。
    在大多数帧对中都相似的像素被认为是静态水印。"""
    frames = sorted(Path(frames_dir).glob("*.png"))
    if len(frames) < 2:
        raise ValueError(f"至少需要 2 帧，当前只有 {len(frames)} 帧")

    n_sample = min(SAMPLE_COUNT, len(frames))
    indices = np.linspace(0, len(frames) - 1, n_sample, dtype=int)

    y1, y2 = h - ROI_BOTTOM, h
    x1, x2 = w - ROI_RIGHT, w

    print(f"水印检测: ROI=({x1},{y1})-({x2},{y2}), 采样 {n_sample} 帧, "
          f"帧对差异阈值={PAIR_DIFF_THRESHOLD}, 相似比例阈值={SIMILARITY_PCT*100:.0f}%")

    # 加载采样帧的 ROI
    samples = []
    for idx in indices:
        img = np.array(Image.open(frames[idx]))
        if img.shape[-1] == 4:
            roi = img[y1:y2, x1:x2].astype(np.float32)
        else:
            # RGB 帧，补 alpha=255
            rgb = img[y1:y2, x1:x2].astype(np.float32)
            alpha = np.full((rgb.shape[0], rgb.shape[1], 1), 255, dtype=np.float32)
            roi = np.concatenate([rgb, alpha], axis=2)
        samples.append(roi)

    # 对每对帧计算相似像素
    roi_h, roi_w = y2 - y1, x2 - x1
    similarity_count = np.zeros((roi_h, roi_w), dtype=np.float32)
    total_pairs = 0

    for i in range(len(samples)):
        for j in range(i + 1, len(samples)):
            diff = np.abs(samples[i] - samples[j])
            max_diff = diff.max(axis=2)
            similarity_count += (max_diff <= PAIR_DIFF_THRESHOLD).astype(np.float32)
            total_pairs += 1

    # 在足够多帧对中都相似 + 有一定 alpha
    min_pairs = int(total_pairs * SIMILARITY_PCT)
    first_alpha = samples[0][:, :, 3]
    static = (similarity_count >= min_pairs) & (first_alpha > ALPHA_MIN)

    print(f"总帧对数: {total_pairs}, 最少需相似: {min_pairs}")
    print(f"检测到 {static.sum()} 个静态水印像素")

    if static.sum() == 0:
        raise RuntimeError("未检测到静态水印像素，可能需要调整参数")

    # 形态学膨胀
    kernel = np.ones((DILATE_KERNEL, DILATE_KERNEL), np.uint8)
    mask_dilated = cv2.dilate(static.astype(np.uint8), kernel, iterations=1)
    print(f"膨胀后 mask 像素数: {mask_dilated.sum()}")

    return mask_dilated.astype(np.uint8) * 255, (y1, y2, x1, x2)


def remove_watermark_frame(rgba: np.ndarray, mask: np.ndarray, roi: tuple) -> np.ndarray:
    """对单帧去除水印。mask 只在 ROI 区域，其余区域不动。"""
    y1, y2, x1, x2 = roi
    result = rgba.copy()

    # 提取 ROI 区域
    roi_rgba = rgba[y1:y2, x1:x2]

    # 分离 RGB 和 Alpha
    roi_rgb = roi_rgba[:, :, :3]
    roi_a = roi_rgba[:, :, 3]

    # 只在水印区域做 inpainting
    inpaint_mask = mask.astype(np.uint8)

    # cv2.inpaint 需要 BGR 格式
    roi_bgr = cv2.cvtColor(roi_rgb, cv2.COLOR_RGB2BGR)
    inpainted_bgr = cv2.inpaint(roi_bgr, inpaint_mask, INPAINT_RADIUS, cv2.INPAINT_TELEA)
    inpainted_rgb = cv2.cvtColor(inpainted_bgr, cv2.COLOR_BGR2RGB)

    # Alpha 通道：水印区域参考邻近非水印像素的 alpha 值做平滑
    roi_a_inpainted = cv2.inpaint(roi_a, inpaint_mask, INPAINT_RADIUS, cv2.INPAINT_TELEA)
    # 确保 alpha 值不超出范围
    roi_a_inpainted = np.clip(roi_a_inpainted, 0, 255).astype(np.uint8)

    # 只替换水印区域的像素
    mask_3d = np.stack([inpaint_mask > 0] * 3, axis=-1)
    roi_rgba[:, :, :3] = np.where(mask_3d, inpainted_rgb, roi_rgba[:, :, :3])
    roi_rgba[:, :, 3] = np.where(inpaint_mask > 0, roi_a_inpainted, roi_rgba[:, :, 3])

    result[y1:y2, x1:x2] = roi_rgba
    return result


def preview_mask(input_dir: str):
    """只生成水印 mask 预览，不处理帧。"""
    frames = sorted(Path(input_dir).glob("*.png"))
    if not frames:
        print(f"错误: {input_dir} 中没有 PNG 文件")
        sys.exit(1)

    first = np.array(Image.open(frames[0]))
    h, w = first.shape[:2]
    print(f"输入: {input_dir} ({len(frames)} 帧)")
    print(f"帧尺寸: {w}×{h}")

    print("\n--- 检测水印 mask ---")
    mask, (y1, y2, x1, x2) = detect_watermark_mask(input_dir, h, w)

    # 输出到工程 tmp 目录
    tmp_dir = Path("tmp")
    tmp_dir.mkdir(exist_ok=True)

    mask_bin = mask > 128
    roi_h, roi_w = y2 - y1, x2 - x1

    # 1. 保存 mask
    mask_path = tmp_dir / "watermark_mask.png"
    Image.fromarray(mask).save(str(mask_path))

    # 2. 保存 mask 叠加在第一帧上的预览图（红色=水印区域）
    roi_viz = first[y1:y2, x1:x2].copy()
    roi_viz[mask_bin, :3] = [255, 0, 0]
    viz = first.copy()
    viz[y1:y2, x1:x2] = roi_viz
    overlay_path = tmp_dir / "watermark_mask_overlay.png"
    Image.fromarray(viz).save(str(overlay_path))

    # 3. 保存水印区域放大图（便于检查）
    zoom_path = tmp_dir / "watermark_roi_zoom.png"
    Image.fromarray(roi_viz).save(str(zoom_path))

    print(f"\n预览文件已保存到 tmp/ 目录:")
    print(f"  {mask_path}          — 水印 mask（白色=水印）")
    print(f"  {overlay_path}  — 红色叠加在第一帧上")
    print(f"  {zoom_path}     — ROI 区域放大")


def main():
    if len(sys.argv) < 2:
        print(f"用法:")
        print(f"  {sys.argv[0]} --preview <输入目录>       仅生成 mask 预览")
        print(f"  {sys.argv[0]} <输入目录> <输出目录>     完整处理")
        sys.exit(1)

    if sys.argv[1] == "--preview":
        input_dir = sys.argv[2] if len(sys.argv) > 2 else sys.argv[1]
        preview_mask(sys.argv[2])
        return

    if len(sys.argv) < 3:
        print(f"用法: {sys.argv[0]} <输入目录> <输出目录>")
        sys.exit(1)

    input_dir = sys.argv[1]
    output_dir = sys.argv[2]

    frames = sorted(Path(input_dir).glob("*.png"))
    if not frames:
        print(f"错误: {input_dir} 中没有 PNG 文件")
        sys.exit(1)

    print(f"输入: {input_dir} ({len(frames)} 帧)")
    print(f"输出: {output_dir}")

    first = np.array(Image.open(frames[0]))
    h, w = first.shape[:2]
    print(f"帧尺寸: {w}×{h}")

    # 第一阶段：检测水印 mask
    print("\n--- 阶段 1: 检测水印 mask ---")
    mask, roi = detect_watermark_mask(input_dir, h, w)

    # 保存 mask
    tmp_dir = Path("tmp")
    tmp_dir.mkdir(exist_ok=True)
    mask_path = tmp_dir / "watermark_mask.png"
    Image.fromarray(mask).save(str(mask_path))
    print(f"水印 mask 已保存: {mask_path}")

    # 第二阶段：逐帧处理
    print(f"\n--- 阶段 2: 逐帧 inpainting ---")
    os.makedirs(output_dir, exist_ok=True)

    for i, fpath in enumerate(frames):
        rgba = np.array(Image.open(fpath))
        cleaned = remove_watermark_frame(rgba, mask, roi)
        out_path = os.path.join(output_dir, fpath.name)
        Image.fromarray(cleaned).save(out_path)

        if (i + 1) % 30 == 0 or i == 0 or i == len(frames) - 1:
            print(f"  已处理 {i + 1}/{len(frames)} 帧")

    print(f"\n完成！清理后帧已保存到: {output_dir}")


if __name__ == "__main__":
    main()
