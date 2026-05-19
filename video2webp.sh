#!/bin/zsh
# 将 mov/mp4 视频转为透明背景的 WebP 动图
# 用法: ./video2webp.sh <输入视频> [输出.webp] [quality 1-100]

set -e

INPUT="$1"
OUTPUT="${2:-outputs/$(basename "${INPUT%.*}").webp}"
QUALITY="${3:-85}"

if [[ -z "$INPUT" ]]; then
    echo "用法: $0 <input.mov|mp4> [output.webp] [quality]"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE="$(basename "${INPUT%.*}")"
source "$SCRIPT_DIR/.venv/bin/activate"
FRAMES_DIR="$SCRIPT_DIR/outputs/${BASE}_frames"
NOBG_DIR="$SCRIPT_DIR/outputs/${BASE}_nobg"
mkdir -p "$FRAMES_DIR" "$NOBG_DIR"

# 获取帧率
FPS=$(ffprobe -v quiet -select_streams v:0 -show_entries stream=r_frame_rate \
    -of default=noprint_wrappers=1:nokey=1 "$INPUT" | bc)
DURATION_MS=$(echo "1000 / $FPS" | bc)

echo "▶ 提取帧 (${FPS}fps)..."
ffmpeg -i "$INPUT" -vf "fps=$FPS" "$FRAMES_DIR/frame_%04d.png" -y -loglevel error
TOTAL=$(ls "$FRAMES_DIR"/*.png | wc -l | tr -d ' ')
echo "  共 $TOTAL 帧"

echo "▶ 去除背景 (backgroundremover, 4并发)..."
count=0
total_done=0
for f in "$FRAMES_DIR"/*.png; do
    backgroundremover -i "$f" -o "$NOBG_DIR/$(basename "$f")" 2>/dev/null &
    count=$((count + 1))
    total_done=$((total_done + 1))
    if [[ $count -ge 4 ]]; then
        wait
        count=0
        echo "  已处理 $total_done / $TOTAL 帧"
    fi
done
wait
echo "  处理完成"

echo "▶ 合成 WebP..."
mkdir -p "$(dirname "$OUTPUT")"
img2webp -d "$DURATION_MS" -lossy -q "$QUALITY" \
    $(ls "$NOBG_DIR"/frame_*.png | sort) -o "$OUTPUT"

SIZE=$(du -sh "$OUTPUT" | cut -f1)
echo "✓ 输出: $OUTPUT ($SIZE)"
