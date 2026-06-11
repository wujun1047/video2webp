#!/usr/bin/env python3
"""
对 Vision 去背后的 PNG 做二次清理：
- 参照原始帧，凡 nobg 帧中仍不透明、且原图对应像素 max(R,G,B) <= 5 的像素 → 透明
- 阈值 5 基于实测：背景像素 max≤5，角色帽子最暗像素 max=6，刚好分离
"""
import sys
from pathlib import Path
from PIL import Image

THRESHOLD = 15  # 原图像素 max(R,G,B) 低于此值视为背景残留（背景噪声最高~21，帽子最暗像素 max=6）

def cleanup(orig_path: str, nobg_path: str, output_path: str):
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
                if max(or_, og, ob) <= THRESHOLD:
                    nobg_px[x, y] = (0, 0, 0, 0)

    nobg.save(output_path)


if __name__ == "__main__":
    if len(sys.argv) == 4:
        cleanup(sys.argv[1], sys.argv[2], sys.argv[3])
        print(f"完成: {sys.argv[3]}")
    elif len(sys.argv) == 3:
        # 批量模式: orig_dir nobg_dir (原地修改 nobg_dir)
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
        print("  python3 cleanup_black.py <orig.png> <nobg.png> <output.png>")
        print("  python3 cleanup_black.py <orig_dir> <nobg_dir>")
        sys.exit(1)
