#!/usr/bin/env python3
"""
对蓝幕去背后的 PNG 做二次清理：
- 参照原始帧，凡原图对应像素为蓝色背景的 → 在去背景帧中设为透明
- 蓝色背景特征：B 高、R 很低、B 远大于 G
"""
import sys
from pathlib import Path
from PIL import Image


def is_blue_bg(r, g, b):
    """判断是否为蓝色背景像素"""
    return b > 150 and r < 80 and b > g * 2


def cleanup(orig_path, nobg_path, output_path):
    orig = Image.open(orig_path).convert("RGB")
    nobg = Image.open(nobg_path).convert("RGBA")
    assert orig.size == nobg.size

    orig_px = orig.load()
    nobg_px = nobg.load()
    w, h = nobg.size

    for x in range(w):
        for y in range(h):
            r, g, b, a = nobg_px[x, y]
            if a > 0:
                or_, og, ob = orig_px[x, y]
                if is_blue_bg(or_, og, ob):
                    nobg_px[x, y] = (0, 0, 0, 0)

    nobg.save(output_path)


if __name__ == "__main__":
    if len(sys.argv) == 4:
        cleanup(sys.argv[1], sys.argv[2], sys.argv[3])
        print(f"完成: {sys.argv[3]}")
    elif len(sys.argv) == 3:
        orig_dir = Path(sys.argv[1])
        nobg_dir = Path(sys.argv[2])
        files = sorted(nobg_dir.glob("*.png"))
        total = len(files)
        for i, nobg_f in enumerate(files, 1):
            orig_f = orig_dir / nobg_f.name
            if orig_f.exists():
                cleanup(str(orig_f), str(nobg_f), str(nobg_f))
            if i % 20 == 0:
                print(f"  {i}/{total}")
        print(f"完成 {total} 帧")
    else:
        print("用法:")
        print("  python3 cleanup_blue.py <orig.png> <nobg.png> <output.png>")
        print("  python3 cleanup_blue.py <orig_dir> <nobg_dir>")
        sys.exit(1)
