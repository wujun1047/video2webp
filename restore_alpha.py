#!/usr/bin/env python3
"""
修复去背景时的前景误判：
- 对原图中非蓝色背景的像素，如果被去背景处理成了半透明或被抠掉，用原图颜色恢复
- 同时修复镂空（alpha=0）和变黑（RGB 接近 0,0,0 但 alpha>0）两种问题
"""
import sys
from pathlib import Path
from PIL import Image


def is_blue_bg(r, g, b):
    return b > 150 and r < 80 and b > g * 2


def restore(orig_path, nobg_path, output_path):
    orig = Image.open(orig_path).convert("RGB")
    nobg = Image.open(nobg_path).convert("RGBA")
    assert orig.size == nobg.size

    orig_px = orig.load()
    nobg_px = nobg.load()
    w, h = nobg.size

    for x in range(w):
        for y in range(h):
            r, g, b, a = nobg_px[x, y]
            or_, og, ob = orig_px[x, y]
            if is_blue_bg(or_, og, ob):
                continue
            # 被完全抠掉（镂空）或变黑（RGB 接近 0,0,0）
            if a == 0 or (a > 0 and max(r, g, b) < 10):
                nobg_px[x, y] = (or_, og, ob, 255)
            elif 0 < a < 255:
                nobg_px[x, y] = (or_, og, ob, 255)

    nobg.save(output_path)


if __name__ == "__main__":
    if len(sys.argv) == 4:
        restore(sys.argv[1], sys.argv[2], sys.argv[3])
        print(f"完成: {sys.argv[3]}")
    elif len(sys.argv) == 3:
        orig_dir = Path(sys.argv[1])
        nobg_dir = Path(sys.argv[2])
        files = sorted(nobg_dir.glob("*.png"))
        total = len(files)
        for i, nobg_f in enumerate(files, 1):
            orig_f = orig_dir / nobg_f.name
            if orig_f.exists():
                restore(str(orig_f), str(nobg_f), str(nobg_f))
            if i % 20 == 0:
                print(f"  {i}/{total}")
        print(f"完成 {total} 帧")
    else:
        print("用法:")
        print("  python3 restore_alpha.py <orig.png> <nobg.png> <output.png>")
        print("  python3 restore_alpha.py <orig_dir> <nobg_dir>")
        sys.exit(1)
