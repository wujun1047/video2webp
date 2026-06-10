# 视频转透明 WebP — 桌面应用设计文档

## 背景

现有命令行工具集（video2webp.sh + Python 后处理脚本）已验证可用，可将绿幕/蓝幕/黑幕视频转为透明 WebP 动图。目标是做成跨平台桌面应用（macOS + Windows），用户下载后双击即用，无需安装任何依赖。

## 架构

```
浏览器 UI (localhost) ← HTTP → Flask API ← subprocess → 处理管线
```

| 层 | 职责 | 技术 |
|---|---|---|
| UI | 上传、设置、进度、预览、下载 | 单页 HTML + JS（Fetch + SSE/轮询）|
| API | 编排处理流程 | Flask 4 个端点 |
| 处理 | 视频解码 → 去背景 → 后处理 → 合成 | ffmpeg + backgroundremover + Python + img2webp |

## 文件结构

```
app/
├── main.py              # Flask 入口，启动时自动打开浏览器
├── templates/
│   └── index.html       # 单页 UI
├── static/
│   ├── style.css        # 页面样式（Tailwind CDN）
│   └── app.js           # 前端逻辑（可选，可内嵌于 index.html）
├── pipeline.py          # 处理流水线编排（调用现有脚本）
├── scripts/             # 现有脚本（符号链接或直接复制）
│   ├── video2webp.sh
│   ├── restore_alpha.py
│   ├── cleanup_blue.py
│   ├── cleanup_black.py
│   ├── despill_blue.py
│   └── despill.py
├── bin/                 # 平台二进制（构建时注入）
│   ├── ffmpeg
│   ├── ffprobe
│   └── img2webp
└── build_config.py      # PyInstaller 配置
```

## API 设计

4 个端点，无认证，只监听 localhost：

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/upload` | POST | 接收视频文件，返回 file_id |
| `/api/process` | POST | 开始处理，参数：file_id, bg_type, fps, quality |
| `/api/progress` | GET | 返回当前进度 {stage, current, total} |
| `/api/download` | GET | 下载最终 WebP 文件 |

处理流程在后台线程中执行，进度写入内存共享状态，`/api/progress` 轮询读取。

## UI 布局（单页流程式）

```
┌──────────────────────────────────────────────┐
│           视频转透明 WebP 动图                │
│           纯本地处理，不上传网络               │
├──────────────────────────────────────────────┤
│  ┌──────────────────────────────────────┐    │
│  │   拖拽或点击上传 MOV / MP4 文件       │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  背景类型 ●自动  ○绿色  ○蓝色  ○黑色         │
│  帧率    ●原帧  ○15fps  ○30fps              │
│  最大尺寸 ●原尺寸 ○512px ○768px              │
│  质量    [━━━━━━━━━●━━━━━] 85               │
│                                              │
│  [开始处理]                                   │
│                                              │
│  ████████████░░░░ 65% (100/151 帧)           │
│                                              │
│  ┌──────────┐  ┌──────────┐                 │
│  │ 原始帧    │  │ 去背景后  │                 │
│  └──────────┘  └──────────┘                 │
│                                              │
│  [下载 WebP]  [重新处理]                     │
└──────────────────────────────────────────────┘
```

页面状态机：idle → uploading → processing → done/error

## 处理管线

直接复用现有脚本，通过 `subprocess` 调用：

```
1. video2webp.sh 提取帧 + backgroundremover 去背景 + 初步合成
2. 根据背景类型运行对应后处理：
   - 绿幕: cleanup_black → despill
   - 蓝幕: restore_alpha → cleanup_blue → despill_blue
   - 黑幕: cleanup_black
3. img2webp 重新合成最终 WebP
```

复用现有 `.venv` 环境中的依赖。打包时 PyInstaller 自动收集 Python 依赖。

## 打包策略

- **工具**：PyInstaller（PyInstaller 5.x+）
- **入口**：`main.py`
- **附加数据**：
  - `templates/` 目录
  - `static/` 目录
  - `scripts/` 目录
  - `bin/` 目录（平台特定 ffmpeg/img2webp 二进制）
- **隐式依赖**：backgroundremover 的 U2-Net 模型文件（`~/.u2net/u2net.pth`，构建时预先下载并打包）
- **构建**：GitHub Actions，macOS runner 构建 .app，Windows runner 构建 .exe

## 跨平台适配

| 平台 | 二进制来源 | 输出格式 |
|---|---|---|
| macOS | Homebrew ffmpeg 静态编译 | .app 目录 → DMG |
| Windows | ffmpeg 官方 Windows 静态构建 | 单文件 .exe（NSIS 安装包） |

打包时根据构建平台选择对应的 `bin/` 目录内容。backgroundremover 的 PyTorch 依赖在所有平台上自动可用（PyInstaller 收集）。

## 错误处理

- 非法视频格式：上传时前端校验扩展名 + 后端 ffprobe 校验
- 处理失败：捕获 subprocess 异常，返回错误信息和当前阶段
- 磁盘空间不足：处理前检查输出目录可用空间
- 端口占用：Flask 启动时自动选择可用端口

## 暂不实现

- 视频剪辑/裁剪功能
- 批量处理
- 自定义后处理参数
- 自动更新
