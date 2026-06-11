# 视频转透明 WebP Web App

基于 Next.js、Vercel Blob 和 Vercel Function 的绿幕/蓝幕视频转透明 WebP 工具。

## 支持范围

- 输入：`.mp4`、`.mov`
- 背景：自动检测、绿幕、蓝幕
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

## 部署

推荐用 Vercel Git 集成部署。

也可以使用 CLI：

```bash
vercel
vercel --prod
```

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

### 提示未检测到绿幕或蓝幕

自动检测只看画面四角的主导颜色。可以手动选择绿幕或蓝幕重试。复杂背景暂不支持。

### 转换超时

降低帧率、降低最大边长或裁剪视频时长。Vercel Function 不是长视频转码服务。

### 输出文件过大

降低质量或帧率。第一版目标是适合展示和转发的小 WebP 动图。
