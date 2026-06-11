#!/usr/bin/env python3
"""对透明 PNG 做蓝幕溢色修复（despill）：压制 B 通道到 (R+G)/2"""
import sys
from pathlib import Path
from PIL import Image


def despill(img: Image.Image) -> Image.Image:
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    for x in range(w):
        for y in range(h):
            r, g, b, a = px[x, y]
            if a > 0 and b > (r + g) / 2:
                px[x, y] = (r, g, int((r + g) / 2), a)
    return img


if __name__ == "__main__":
    if len(sys.argv) == 3 and not Path(sys.argv[1]).is_dir():
        despill(Image.open(sys.argv[1])).save(sys.argv[2])
        print(f"完成: {sys.argv[2]}")
    elif len(sys.argv) == 2:
        d = Path(sys.argv[1])
        files = sorted(d.glob("*.png"))
        total = len(files)
        for i, f in enumerate(files, 1):
            despill(Image.open(f)).save(f)
            if i % 30 == 0:
                print(f"  {i}/{total}")
        print(f"完成 {total} 帧")
    else:
        print("用法: python3 despill_blue.py <目录> 或 <input.png> <output.png>")
        sys.exit(1)
