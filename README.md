# video2webp

将 `mov` / `mp4` 视频转换为透明背景 WebP 动图。

当前主路径面向绿幕/蓝幕素材：先提取视频帧，再用色度键控生成透明 PNG，最后合成为 WebP。黑幕素材保留旧的 `backgroundremover + cleanup_black.py` 流程。复杂自然背景暂不支持。

## 依赖

- `ffmpeg` / `ffprobe`：提取帧、读取帧率
- `img2webp`：合成 WebP 动图
- Python 3.12 虚拟环境 `.venv`
- Python 包：`numpy`、`Pillow`
- 黑幕路径额外依赖 `backgroundremover`

## 用法

```bash
./video2webp.sh <输入视频> [输出.webp] [quality 1-100] [auto|green|blue|black]
```

示例：

```bash
# 自动识别绿幕/蓝幕
./video2webp.sh Assets/input.mov outputs/input_720x720_30fps_q85.webp 85 auto

# 明确指定绿幕
./video2webp.sh Assets/input.mov outputs/input_720x720_30fps_q85_green.webp 85 green

# 黑幕素材走旧模型路径
./video2webp.sh Assets/input.mov outputs/input_720x720_30fps_q85_black.webp 85 black
```

## 背景类型

| 类型 | 处理方式 |
|---|---|
| `auto` | 自动检测绿幕/蓝幕，检测失败则退出并提示不支持 |
| `green` | 强制按绿幕键控 |
| `blue` | 强制按蓝幕键控 |
| `black` | 使用 `backgroundremover` 后再执行黑幕清理 |

复杂背景、白底、红底、普通照片背景暂不支持自动去背景。

## 输出命名建议

建议文件名包含关键参数，方便对比：

```text
<素材名>_<分辨率>_<帧率>fps_q<质量>[_green|_blue|_black].webp
```

例如：

```text
南博-莫卧儿艺术展-720x720_30fps_q85.webp
南博-莫卧儿艺术展-640x640_30fps_q85.webp
```

## 目录约定

- `Assets/`：输入视频，不纳入版本控制
- `outputs/`：最终 WebP 与中间帧目录，不纳入版本控制
- `tmp/`：临时测试文件，仅保留已跟踪的固定调试素材

## 核心脚本

| 脚本 | 用途 |
|---|---|
| `video2webp.sh` | 主流程：提取帧、去背景、合成 WebP |
| `chroma_key.py` | 绿幕/蓝幕色度键控去背景 |
| `cleanup_black.py` | 黑幕残留清理 |
| `restore_alpha.py` / `cleanup_blue.py` / `despill*.py` | 旧流程辅助脚本，保留用于人工排查 |

## Web App

`web-app/` 是基于 Next.js + Vercel Blob + Vercel Function 的在线版本，功能与 CLI 管线基本对齐（绿幕/蓝幕键控），并额外支持带 alpha 通道的源文件，提供浏览器上传、在线转换、直接下载。详见 [web-app/README.md](./web-app/README.md)。

## 注意

- 绿幕/蓝幕素材优先使用 `auto`、`green` 或 `blue`，不要走模型路径。
- 如果 `auto` 检测失败，但你确定素材是绿幕或蓝幕，可以显式传 `green` 或 `blue`。
- 黑幕素材需要显式传 `black`。
