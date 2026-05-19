# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

将视频（mov/mp4）转为透明背景的 WebP 动图工具集。支持黑色、蓝色、绿色等多种背景色。处理流水线：视频 → 帧提取 → 去背景 → 后处理 → 合成 WebP。

## 外部依赖

- **ffmpeg / ffprobe**：帧提取与帧率检测
- **img2webp**（webp 包）：帧合成 WebP 动图
- **backgroundremover 0.4.1**：Python 包，基于 U2-Net 深度学习模型去除图片背景
  - 实际安装在 miniforge3 全局环境（`/Users/wujunyang/miniforge3/bin/backgroundremover`）
  - 模型文件：`~/.u2net/u2net.pth`（首次运行自动下载）
- **Python 3.12 + Pillow**：后处理脚本，使用 `.venv` 虚拟环境（`uv venv` 创建）

## 环境说明

- `video2webp.sh` 中通过 `source .venv/bin/activate` 激活虚拟环境，但 `backgroundremover` 实际由 miniforge3 全局环境提供
- `.venv` 主要为后处理脚本提供 Pillow 依赖

## 核心脚本

| 脚本 | 用途 |
|---|---|
| `video2webp.sh` | 主流程：提取帧 → 4 并发 backgroundremover → 合成 WebP |
| `restore_alpha.py` | 前景修复：用原图颜色恢复被去背景模型误判的前景像素（修复镂空和变黑） |
| `cleanup_blue.py` | 蓝幕清理：原图中蓝色背景像素（B>150, R<80, B>G×2）→ 透明 |
| `cleanup_black.py` | 黑幕清理：原图中暗像素（max RGB ≤ 15）→ 透明 |
| `despill_blue.py` | 蓝幕溢色修复：压制 B 通道到 (R+G)/2 |
| `despill.py` | 绿幕溢色修复：压制 G 通道到 (R+B)/2 |

## 常用命令

```bash
# 完整转换（主流程）
./video2webp.sh Assets/input.mov outputs/output.webp [quality]

# 蓝幕视频后处理（按顺序执行）
python3 restore_alpha.py outputs/<name>_frames outputs/<name>_nobg
python3 cleanup_blue.py outputs/<name>_frames outputs/<name>_nobg
python3 despill_blue.py outputs/<name>_nobg

# 黑幕/绿幕视频后处理
python3 cleanup_black.py outputs/<name>_frames outputs/<name>_nobg
python3 despill.py outputs/<name>_nobg

# 用清理后的帧重新合成 WebP
img2webp -d 33 -lossy -q 85 $(ls outputs/<name>_nobg/frame_*.png | sort) -o outputs/<name>.webp
```

## 工作目录约定

- `Assets/`：输入视频（mov/mp4）
- `outputs/`：所有输出，包括中间帧目录（`<name>_frames`、`<name>_nobg`）和最终 WebP

## 处理流水线

### 蓝幕视频

1. `video2webp.sh` 提取帧 → backgroundremover（U2-Net）去背景 → 合成 WebP
2. `restore_alpha.py` 用原图颜色恢复被误判的前景像素
3. `cleanup_blue.py` 清除蓝色背景残留
4. `despill_blue.py` 修复蓝色溢色
5. `img2webp` 重新合成最终 WebP

### 黑幕/绿幕视频

1. `video2webp.sh` 提取帧 → backgroundremover 去背景 → 合成 WebP
2. `cleanup_black.py` 清理残留背景像素（阈值 THRESHOLD=15）
3. `despill.py` 修复绿幕溢色
4. `img2webp` 重新合成最终 WebP
