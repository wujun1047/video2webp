# Web App 执行文档：视频转透明 WebP

执行前提：已阅读并接受 `web-app/docs/01-solution-design.md`。第一版只做 `auto`、`green`、`blue`，不做 `black`。

## 1. 目标

在 `web-app/` 中实现一个可部署到 Vercel 的 Next.js 应用：

- 用户上传 `.mp4` 或 `.mov` 视频。
- 视频通过 Vercel Blob 直传，避免 Vercel Function 4.5 MB request body 限制。
- 用户选择背景模式、质量、最大帧率、最大边长。
- 后端下载视频到 `/tmp`，提帧、色度键控、合成透明 WebP。
- 输出 WebP 上传到 Vercel Blob，前端展示下载链接。

## 2. 验收标准

必须满足：

- `npm run build` 通过。
- 本地 `npm run dev` 可打开页面。
- 页面可选择视频文件并校验大小。
- 未配置 `BLOB_READ_WRITE_TOKEN` 时，接口返回明确错误。
- `mode=auto|green|blue` 请求类型校验通过。
- `mode=black` 被拒绝。
- 转换 API 使用 `/tmp/<jobId>/`，完成后清理临时目录。
- 文档说明 Vercel Blob 配置步骤和素材限制。

建议用一段小于 8 秒、720p 以下的绿幕或蓝幕视频做真实转换验证。

## 3. 目录结构

最终目录建议：

```text
web-app/
  docs/
    01-solution-design.md
    02-execution-plan.md
  package.json
  next.config.ts
  tsconfig.json
  vercel.json
  src/
    app/
      api/
        upload/route.ts
        convert/route.ts
      page.tsx
      layout.tsx
      globals.css
    components/
      converter-form.tsx
    lib/
      chroma-key.ts
      ffmpeg.ts
      limits.ts
      temp-dir.ts
      validation.ts
```

## 4. 实施步骤

### 步骤 1：初始化 Next.js

命令：

```bash
cd /Users/wujunyang/Dev/AI/0-MyPorjects/GenerateWebp
npx create-next-app@latest web-app --yes --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --turbopack --use-npm --force
```

注意：

- 因为 `web-app/` 已有 `docs/`，必须加 `--force`。
- 初始化后确认 `docs/` 没被覆盖。

验证：

```bash
cd web-app
npm run build
```

### 步骤 2：安装依赖

命令：

```bash
npm install @vercel/blob @ffmpeg-installer/ffmpeg sharp
npm install -D @types/node
```

说明：

- `@vercel/blob`：上传输入视频和输出 WebP。
- `@ffmpeg-installer/ffmpeg`：提供 ffmpeg 二进制。
- `sharp`：读取和写入 PNG 像素，移植 `chroma_key.py` 核心算法。

验证：

```bash
npm run build
```

### 步骤 3：定义限制常量

文件：`src/lib/limits.ts`

内容要求：

- `MAX_INPUT_BYTES = 50 * 1024 * 1024`
- `MAX_DURATION_SECONDS = 8`
- `DEFAULT_MAX_FPS = 24`
- `MAX_FPS = 30`
- `DEFAULT_MAX_SIZE = 720`
- `MAX_OUTPUT_BYTES = 20 * 1024 * 1024`
- 允许的模式：`auto`、`green`、`blue`

验证：

- `black` 不在允许列表。
- API 和前端共用这些限制。

### 步骤 4：实现 Blob 上传接口

文件：`src/app/api/upload/route.ts`

职责：

- 使用 `@vercel/blob/client` 的 `handleUpload`。
- `allowedContentTypes` 限制为：
  - `video/mp4`
  - `video/quicktime`
- `maximumSizeInBytes` 限制为 50 MB。
- Blob pathname 前缀使用 `inputs/`。

验证：

- 未配置 `BLOB_READ_WRITE_TOKEN` 时返回明确错误。
- 超过 50 MB 的文件被拒绝。

### 步骤 5：实现临时目录工具

文件：`src/lib/temp-dir.ts`

职责：

- 创建 `/tmp/video2webp-<jobId>/`。
- 提供 `frames/`、`nobg/`、`input`、`output.webp` 路径。
- 提供清理函数。

验证：

- 任意异常路径都能调用清理函数。
- 不使用用户文件名拼接目录。

### 步骤 6：实现 ffmpeg 工具

文件：`src/lib/ffmpeg.ts`

职责：

- 找到 `@ffmpeg-installer/ffmpeg` 路径。
- `probeVideo()` 获取时长、宽高、帧率。
- `extractFrames()`：
  - 使用 `fps=min(sourceFps, maxFps)`。
  - 使用 `scale` 限制最大边长。
  - 输出 `frame_%04d.png`。
- `encodeWebp()`：
  - 使用 `-loop 0`
  - 使用 `-q:v` 或合适的 WebP 参数
  - 保留 alpha。

验证：

- 对本地小视频能提取 PNG。
- 输出 WebP 能在浏览器预览透明背景。

### 步骤 7：移植色度键控算法

文件：`src/lib/chroma-key.ts`

实现范围：

- 从 `chroma_key.py` 移植核心逻辑：
  - 自动检测绿幕/蓝幕：取四角像素均值。
  - 色差键：幕布通道减另两通道最大值。
  - 连续 alpha：`low=20`、`high=90`。
  - 背景反混合。
  - 边缘 despill。
  - 软收边和颜色延展可以先做简化版，但必须保留边缘 alpha 和 despill。

第一版允许简化：

- 先不完全复刻 Python 的颜色延展迭代。
- 如果视觉效果明显差，再补齐第 6 步颜色净化。

验证：

- `auto` 可正确识别绿幕或蓝幕。
- 非绿/蓝幕返回明确错误。
- 输出 PNG 有 alpha 通道。

### 步骤 8：实现转换接口

文件：`src/app/api/convert/route.ts`

职责：

1. 校验请求参数。
2. 下载 `inputUrl` 到 `/tmp/jobId/input`。
3. 用 ffmpeg 读取视频信息。
4. 校验时长不超过 8 秒。
5. 提取帧。
6. 对每帧执行 `chromaKeyFrame()`。
7. 合成 WebP。
8. 校验输出大小。
9. 上传到 Blob `outputs/`。
10. 返回下载链接和统计信息。
11. `finally` 清理 `/tmp/jobId/`。

Route Handler 配置：

```ts
export const runtime = "nodejs";
export const maxDuration = 300;
```

验证：

- `black` 请求返回 400。
- 超长视频返回 400。
- ffmpeg 失败返回 500，但不泄漏完整堆栈给前端。

### 步骤 9：实现前端页面

文件：

- `src/app/page.tsx`
- `src/components/converter-form.tsx`
- `src/app/globals.css`

界面要求：

- 第一屏就是工具，不做营销页。
- 文件选择区。
- 背景模式分段控件：自动、绿幕、蓝幕。
- 质量滑块。
- 最大帧率选择：15fps、24fps、30fps，其中 24fps 为默认，30fps 标为高质量模式。
- 最大边长选择：480、720。
- 转换按钮。
- 状态区：上传中、转换中、完成、失败。
- 结果区：下载 WebP。

文案要求：

- 不在页面里解释实现细节。
- 错误提示要可操作。
- 明确显示限制：50 MB、8 秒、720px；30fps 会更流畅但转换更慢。

验证：

- 移动端不重叠。
- 上传中不能重复提交。
- 转换失败后可以重新选择文件。

### 步骤 10：配置 Vercel

文件：`vercel.json`

建议：

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "functions": {
    "src/app/api/convert/route.ts": {
      "memory": 3009,
      "maxDuration": 300
    }
  }
}
```

如果 Vercel 对 Next.js App Router 的函数匹配不接受该路径，以 Route Handler 内的 `export const maxDuration = 300` 为准，并按 Vercel 构建报错调整。

验证：

```bash
npm run build
```

### 步骤 11：补充 README

文件：`web-app/README.md`

必须包含：

- 本地启动命令。
- Vercel Blob 配置步骤。
- `.env.local` 说明。
- 支持范围。
- 素材限制。
- 不支持 `black` 和复杂背景。
- 常见错误排查。

验证：

- 新同事只看 README 能启动本地开发。
- 部署人员只看 README 能创建 Blob Store 并部署。

## 5. 本地验证命令

```bash
cd /Users/wujunyang/Dev/AI/0-MyPorjects/GenerateWebp/web-app
npm run lint
npm run build
npm run dev
```

如果配置了 Vercel CLI：

```bash
vercel env pull .env.local
vercel dev
```

真实转换验证：

1. 打开本地页面。
2. 选择一个 8 秒以内绿幕或蓝幕视频。
3. 选择 `auto`。
4. 设置 `24fps`、`720px`、质量 `85`；需要更流畅时再验证 `30fps`。
5. 转换后下载 WebP。
6. 在浏览器或设计工具中检查透明背景。

## 6. 失败停点

遇到以下情况先暂停并复盘，不要硬绕：

- `@ffmpeg-installer/ffmpeg` 在 Vercel 构建后不可执行。
- Function bundle 超过 Vercel 限制。
- 720p、8 秒、24fps 的样例仍超过 300 秒。
- `/tmp` 空间不足。
- TypeScript 色度键控效果明显差于根目录 `chroma_key.py`。

这些情况说明 Vercel Function 不适合作为长期转码后端，应改用独立计算服务，前端仍可保留在 Vercel。

## 7. 后续可选增强

不进入第一版：

- 异步任务队列和进度轮询。
- 登录和文件历史。
- Blob 自动清理。
- `black` 模式。
- 批量转换。
- 更多调参选项。
- Cloud Run 后端。
