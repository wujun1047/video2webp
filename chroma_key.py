#!/usr/bin/env python3
"""
纯色幕（绿幕/蓝幕）色度键控去背景 — 替代 backgroundremover 的主路径。

算法（六步，详见 docs-claude/去背景方案分析与改进建议.md）：
  1. 色差键：key = 幕布通道 - max(另两通道)
  2. 连续 alpha：key<=low 全前景，key>=high 全背景，中间线性过渡 → 软边缘
  3. 背景反混合：已知背景色 B，解 I = a*F + (1-a)*B 得到真实前景色
  4. 边缘带 despill：距透明区 band_px 内，幕布通道压到另两通道均值
     （只在边缘带做强压制，内部合法的绿/蓝色元素不受影响）
  5. 软收边：最外 ~2px 轮廓 alpha 减半（4:2:0 渗色最重的像素退为半透明），
     top-hat 保护细发丝/羽毛保留 85% alpha
  6. 颜色净化：核心区（实色区内缩 band_px）颜色向外延展，
     alpha<0.65 的像素 RGB 全部替换为核心延展色

用法:
  python3 chroma_key.py <frames_dir> <output_dir> [--color green|blue|auto]
                        [--low 20] [--high 90] [--band 4] [--workers 4]
                        [--no-extend] [--no-choke]

黑幕/非纯色背景不适用：detect_key_channel 会抛 ValueError，CLI 以非零退出，
调用方（video2webp.sh / gui.py / pipeline.py）据此回退到 backgroundremover 管线。

依赖: numpy, Pillow
"""
import argparse
import sys
import time
from multiprocessing import Pool
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def detect_key_channel(img: np.ndarray) -> int:
    """自动检测幕布颜色：取四角像素均值，返回主导通道（1=绿幕, 2=蓝幕）。

    黑幕/白底/非纯色背景抛 ValueError，调用方据此回退到 NN 管线。
    """
    h, w = img.shape[:2]
    s = min(50, h // 4, w // 4)
    corners = np.concatenate([
        img[:s, :s].reshape(-1, 3), img[:s, -s:].reshape(-1, 3),
        img[-s:, :s].reshape(-1, 3), img[-s:, -s:].reshape(-1, 3),
    ]).astype(np.float32)
    mean = corners.mean(axis=0)
    ch = int(mean.argmax())
    other_max = max(mean[c] for c in (0, 1, 2) if c != ch)
    if ch == 0 or mean[ch] < 90 or mean[ch] < 1.5 * other_max:
        raise ValueError(f'四角均值 {mean.round(0)} 不是绿幕/蓝幕（黑幕或复杂背景请走 AI 去背景）')
    return ch


def chroma_key(img_rgb: np.ndarray, channel: int, low: float = 20, high: float = 90,
               band_px: int = 4, extend: bool = True, choke: bool = True) -> np.ndarray:
    """对单帧 RGB 数组做色度键控，返回 RGBA uint8 数组"""
    img = img_rgb.astype(np.float32)
    others = [c for c in (0, 1, 2) if c != channel]
    K = img[:, :, channel]
    M = np.maximum(img[:, :, others[0]], img[:, :, others[1]])

    # 1) 色差键 + 2) 连续 alpha
    key = K - M
    alpha = 1.0 - np.clip((key - low) / (high - low), 0.0, 1.0)

    # 3) 背景反混合：用纯背景像素的中位数估计背景色
    bg_mask = key > high
    a3 = alpha[:, :, None]
    if bg_mask.sum() > 100:
        bg_color = np.median(img[bg_mask], axis=0)
        fg = np.where(a3 > 0.01, (img - (1 - a3) * bg_color) / np.maximum(a3, 0.01), 0)
        fg = np.clip(fg, 0, 255)
    else:
        fg = img.copy()

    # 4) 边缘带强 despill：4:2:0 色度压缩会让幕布色渗进前景边缘 1-2 像素，
    #    压到 max(另两通道) 仍是橄榄色，必须压到均值才回到暖色
    a_u8 = (alpha * 255).astype(np.uint8)
    eroded = np.array(
        Image.fromarray(a_u8).filter(ImageFilter.MinFilter(band_px * 2 + 1)),
        dtype=np.float32)
    band = (alpha > 0) & (eroded < 250)
    o_mean = (fg[:, :, others[0]] + fg[:, :, others[1]]) / 2
    fg[:, :, channel] = np.where(band, np.minimum(fg[:, :, channel], o_mean),
                                 fg[:, :, channel])

    # 5) 软收边：渗色最重的最外圈退为半透明，交给第 6 步换干净颜色；
    #    top-hat 保护细发丝/羽毛
    if choke:
        A = alpha * 255
        er = np.array(Image.fromarray(a_u8).filter(ImageFilter.MinFilter(5)), np.float32)
        op = np.array(Image.fromarray(er.astype(np.uint8)).filter(ImageFilter.MaxFilter(5)), np.float32)
        tophat = np.clip(A - op, 0, 255)
        soft = (A + er) / 2
        alpha = np.minimum(np.maximum(soft, tophat * 0.85), A) / 255.0

    # 6) 颜色净化：核心区颜色向外延展，半透明像素 RGB 全部替换
    if extend:
        solid = alpha >= 0.65
        core = np.array(
            Image.fromarray((solid * 255).astype(np.uint8))
            .filter(ImageFilter.MinFilter(band_px * 2 + 1))) > 128
        color = np.where(core[:, :, None], fg, 0.0)
        filled = core.copy()
        for _ in range(10 + band_px * 2):
            if filled.all():
                break
            s = np.zeros_like(color)
            n = np.zeros(filled.shape, np.float32)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if dy == 0 and dx == 0:
                        continue
                    cs = np.roll(np.roll(color, dy, 0), dx, 1)
                    fs = np.roll(np.roll(filled, dy, 0), dx, 1)
                    s += cs * fs[:, :, None]
                    n += fs
            new = (~filled) & (n > 0)
            color[new] = s[new] / n[new][:, None]
            filled |= new
        replace = (alpha < 0.65)[:, :, None] & filled[:, :, None]
        fg = np.where(replace, color, fg)

    return np.dstack([np.clip(fg, 0, 255), alpha * 255]).astype(np.uint8)


def key_file(args_tuple):
    """多进程 worker：处理单帧文件"""
    in_path, out_path, channel, low, high, band_px, extend, choke = args_tuple
    arr = np.array(Image.open(in_path).convert('RGB'))
    result = chroma_key(arr, channel, low=low, high=high,
                        band_px=band_px, extend=extend, choke=choke)
    Image.fromarray(result, 'RGBA').save(out_path)


def main():
    ap = argparse.ArgumentParser(description='纯色幕色度键控去背景')
    ap.add_argument('frames_dir', help='原始帧目录（frame_*.png）')
    ap.add_argument('output_dir', help='输出目录')
    ap.add_argument('--color', choices=['green', 'blue', 'auto'], default='auto')
    ap.add_argument('--low', type=float, default=20, help='低阈值：色差低于此值视为全前景')
    ap.add_argument('--high', type=float, default=90, help='高阈值：色差高于此值视为全背景')
    ap.add_argument('--band', type=int, default=4, help='边缘强 despill 带宽（像素）')
    ap.add_argument('--workers', type=int, default=4, help='并发进程数')
    ap.add_argument('--no-extend', action='store_true', help='关闭颜色净化')
    ap.add_argument('--no-choke', action='store_true', help='关闭软收边')
    args = ap.parse_args()

    frames = sorted(Path(args.frames_dir).glob('*.png'))
    if not frames:
        sys.exit(f'未找到 PNG 帧: {args.frames_dir}')
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    first = np.array(Image.open(frames[0]).convert('RGB'))
    channel = {'green': 1, 'blue': 2}.get(args.color) or detect_key_channel(first)
    print(f'幕布类型: {"绿幕" if channel == 1 else "蓝幕"}, 共 {len(frames)} 帧, {args.workers} 并发')

    tasks = [(str(f), str(out_dir / f.name), channel, args.low, args.high,
              args.band, not args.no_extend, not args.no_choke) for f in frames]
    t0 = time.time()
    if args.workers > 1:
        with Pool(args.workers) as pool:
            for i, _ in enumerate(pool.imap_unordered(key_file, tasks), 1):
                if i % 30 == 0:
                    print(f'  {i}/{len(frames)}')
    else:
        for i, t in enumerate(tasks, 1):
            key_file(t)
            if i % 30 == 0:
                print(f'  {i}/{len(frames)}')
    dt = time.time() - t0
    print(f'完成: {len(frames)} 帧, {dt:.1f}s ({dt / len(frames) * 1000:.0f}ms/帧) → {out_dir}')


if __name__ == '__main__':
    main()
