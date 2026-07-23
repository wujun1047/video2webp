# 视频转透明 WebP Web App

基于 Next.js、Vercel Blob 和 Vercel Function 的视频转透明 WebP 工具（绿幕/蓝幕键控，或直接用源文件 alpha 通道）。

## 支持范围

- 输入：`.mp4`、`.mov`
- 背景：自动检测、绿幕、蓝幕、带Alpha（源文件自带透明通道时直接用，效果最好）
- 输出：透明背景 animated WebP
- 默认参数：24fps、720px、质量 85
- 可选帧率：15fps、24fps、30fps

暂不支持：

- `black` 模式
- 普通自然背景
- 白底、红底等非绿/蓝幕背景
- 批量转换和历史记录

## 素材限制

- 输入视频不超过 50 MB
- 视频时长不超过 8 秒
- 最大输出边长 720px
- 输出 WebP 目标不超过 20 MB

30fps 会更流畅，但转换更慢。若转换超时，优先改用 24fps 或 15fps。

## 文件生命周期

- **输入视频**：转换完成后立即从 Blob 删除。
- **输出 WebP**：每次转换时自动清理超过 1 小时的旧文件。
- **`/tmp` 中间文件**：每次请求结束后自动清除。

日常使用即可自清理，无需手动管理。

## 本地开发

```bash
npm install
npm run dev
```

打开：

```text
http://localhost:3000
```

本地真实上传和转换需要配置 Vercel Blob token。

## Vercel Blob 配置

1. 在 Vercel 项目中创建 Blob Store。
2. 确认项目环境变量中有 `BLOB_READ_WRITE_TOKEN`。
3. 本地开发时拉取环境变量：

```bash
vercel env pull .env.local
```

没有该变量时，上传和转换接口会返回明确错误。

## 命令行部署

```bash
# 创建并链接 Blob Store（只需一次）
vercel blob create-store video2webp --access public --yes

# 部署
vercel --prod
```

## 功能特性

- 上传中显示进度百分比，转换中显示计时器和"请不要关闭页面"警告
- 转换完成后显示总耗时、帧数、文件大小
- 下载时在 Chrome/Edge 中弹出"另存为"对话框（可选择保存目录），其他浏览器回退传统下载
- 文件名含转换参数：`<原视频名>_<分辨率>px_<帧率>fps_q<质量>_<时间戳>.webp`

## 验证

```bash
npm test
npm run lint
npm run build
```

真实转换验证建议使用：

- 8 秒以内
- 720p 或以下
- 绿幕或蓝幕
- 24fps

## 常见问题

### 提示缺少 `BLOB_READ_WRITE_TOKEN`

说明 Vercel Blob 没配置好。先创建 Blob Store，再拉取或设置环境变量。

```bash
vercel blob create-store video2webp --access public --yes
vercel env pull .env.local
```

### 提示未检测到绿幕或蓝幕

自动检测只看画面四角的主导颜色。可以手动选择绿幕或蓝幕重试。复杂背景暂不支持。

### 「带Alpha」模式怎么用

适用于源文件本身就带透明通道的视频（如 qtrle/argb 的 `.mov`、ProRes 4444、yuva 编码）。勾选后跳过色度键控，直接用源 alpha 通道，边缘最干净、无闪烁。

若报错"该视频没有 alpha 通道"，说明源是普通 mp4 之类不带通道，请改用自动/绿幕/蓝幕，或换带通道的源文件。

### 转换超时

降低帧率、降低最大边长或裁剪视频时长。Vercel Function 不是长视频转码服务。

### 转换返回 500 错误

通常是因为部署包缺少原生二进制（ffmpeg、sharp、libwebp）。确认 `next.config.ts` 中 `serverExternalPackages` 和 `outputFileTracingIncludes` 配置完整：

```ts
serverExternalPackages: [
  "@ffmpeg-installer/ffmpeg",
  "libwebp-static",
  "sharp",
],
outputFileTracingIncludes: {
  "**/*": [
    "./node_modules/@ffmpeg-installer/**/ffmpeg*",
    "./node_modules/@img/**/*.node",
    "./node_modules/@img/**/*.so*",
    "./node_modules/sharp/**/*.node",
    "./node_modules/libwebp-static/binaries/**/*",
  ],
},
```

### 输出文件过大

降低质量或帧率。第一版目标是适合展示和转发的小 WebP 动图。
