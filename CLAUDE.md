# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

将 `mov` / `mp4` 视频转换为透明背景 WebP 动图。

当前主路径面向绿幕/蓝幕素材：视频 → 帧提取 → 色度键控去背景 → 合成 WebP。黑幕素材保留旧的 `backgroundremover + cleanup_black.py` 流程。复杂自然背景暂不支持。

## 外部依赖

- **ffmpeg / ffprobe**：帧提取与帧率检测
- **img2webp**（webp 包）：帧合成 WebP 动图
- **Python 3.12 + numpy + Pillow**：`chroma_key.py` 色度键控和后处理脚本
- **backgroundremover 0.4.1**：仅黑幕路径使用，基于 U2-Net
  - 实际安装在 miniforge3 全局环境：`/Users/wujunyang/miniforge3/bin/backgroundremover`
  - 模型文件：`~/.u2net/u2net.pth`

## 环境说明

- `video2webp.sh` 会激活项目根目录 `.venv`
- `.venv` 主要提供 `numpy`、`Pillow`
- 黑幕路径仍依赖全局 `backgroundremover`

## 核心脚本

| 脚本 | 用途 |
|---|---|
| `video2webp.sh` | 主流程：提取帧 → 去背景 → 合成 WebP |
| `chroma_key.py` | 绿幕/蓝幕色度键控去背景，当前主路径 |
| `cleanup_black.py` | 黑幕残留清理 |
| `restore_alpha.py` | 旧蓝幕流程中的前景修复脚本，保留用于人工排查 |
| `cleanup_blue.py` | 旧蓝幕流程中的蓝幕残留清理脚本 |
| `despill_blue.py` | 旧蓝幕流程中的蓝色溢色修复脚本 |
| `despill.py` | 旧绿幕流程中的绿色溢色修复脚本 |

## 常用命令

```bash
# 自动检测绿幕/蓝幕
./video2webp.sh Assets/input.mov outputs/input_720x720_30fps_q85.webp 85 auto

# 明确指定绿幕或蓝幕
./video2webp.sh Assets/input.mov outputs/input_720x720_30fps_q85_green.webp 85 green
./video2webp.sh Assets/input.mov outputs/input_720x720_30fps_q85_blue.webp 85 blue

# 黑幕素材走旧模型路径
./video2webp.sh Assets/input.mov outputs/input_720x720_30fps_q85_black.webp 85 black
```

命令格式：

```bash
./video2webp.sh <输入视频> [输出.webp] [quality 1-100] [auto|green|blue|black]
```

## 背景类型策略

| 类型 | 处理方式 |
|---|---|
| `auto` | 自动检测绿幕/蓝幕，检测失败则退出并提示不支持 |
| `green` | 强制按绿幕键控 |
| `blue` | 强制按蓝幕键控 |
| `black` | 使用 `backgroundremover` 后再执行 `cleanup_black.py` |

复杂背景、白底、红底、普通照片背景暂不支持自动去背景。不要在复杂背景上静默回退模型，除非后续明确实现并验证新的复杂背景方案。

## 工作目录约定

- `Assets/`：输入视频，不纳入版本控制
- `outputs/`：最终 WebP 与中间帧目录，不纳入版本控制
- `tmp/`：临时测试文件，仅保留已跟踪的固定调试素材

## Web App

`web-app/` 是 Next.js + TypeScript 的 Web 应用，通过 Vercel Function 部署。其 TypeScript 版色度键控 (`web-app/src/lib/chroma-key.ts`) 与根目录 Python 版功能对齐。该目录有独立的 [CLAUDE.md](./web-app/CLAUDE.md) 和 [README.md](./web-app/README.md)，工作时常需同时参考两个层级的文档。

依赖补充（Web App 侧）：`@ffmpeg-installer/ffmpeg`、`libwebp-static`（img2webp）、`sharp`、`@vercel/blob`。

## 输出命名建议

文件名应包含分辨率、帧率、质量等关键参数：

```text
<素材名>_<分辨率>_<帧率>fps_q<质量>[_green|_blue|_black].webp
```

示例：

```text
南博-莫卧儿艺术展-720x720_30fps_q85.webp
南博-莫卧儿艺术展-640x640_30fps_q85.webp
```
