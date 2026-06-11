#!/bin/zsh
# 将 mov/mp4 视频转为透明背景的 WebP 动图
# 用法: ./video2webp.sh <输入视频> [输出.webp] [quality 1-100] [auto|green|blue|black]

set -e

INPUT="$1"
OUTPUT="${2:-outputs/$(basename "${INPUT%.*}").webp}"
QUALITY="${3:-85}"
BG_TYPE="${4:-auto}"

if [[ -z "$INPUT" ]]; then
    echo "用法: $0 <input.mov|mp4> [output.webp] [quality] [auto|green|blue|black]"
    exit 1
fi

case "$BG_TYPE" in
    auto|green|blue|black) ;;
    *)
        echo "背景类型不支持: $BG_TYPE"
        echo "用法: $0 <input.mov|mp4> [output.webp] [quality] [auto|green|blue|black]"
        exit 1
        ;;
esac

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

echo "▶ 去除背景..."
run_backgroundremover() {
    echo "  backgroundremover (4并发)..."
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
}

case "$BG_TYPE" in
    auto)
        if python3 "$SCRIPT_DIR/chroma_key.py" "$FRAMES_DIR" "$NOBG_DIR" --color auto --workers 4 2>/dev/null; then
            echo "  色度键控完成"
        else
            echo "  未检测到绿幕/蓝幕。复杂背景暂不支持；黑幕素材请用: $0 \"$INPUT\" \"$OUTPUT\" \"$QUALITY\" black"
            exit 2
        fi
        ;;
    green|blue)
        python3 "$SCRIPT_DIR/chroma_key.py" "$FRAMES_DIR" "$NOBG_DIR" --color "$BG_TYPE" --workers 4
        echo "  色度键控完成"
        ;;
    black)
        run_backgroundremover
        echo "  黑幕清理..."
        python3 "$SCRIPT_DIR/cleanup_black.py" "$FRAMES_DIR" "$NOBG_DIR"
        echo "  黑幕处理完成"
        ;;
esac

echo "▶ 合成 WebP..."
mkdir -p "$(dirname "$OUTPUT")"
img2webp -d "$DURATION_MS" -lossy -q "$QUALITY" \
    $(ls "$NOBG_DIR"/frame_*.png | sort) -o "$OUTPUT"

SIZE=$(du -sh "$OUTPUT" | cut -f1)
echo "✓ 输出: $OUTPUT ($SIZE)"
