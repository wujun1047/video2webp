# Web App 实现审查报告（终版）

审查时间：2026-06-11，更新至 2026-06-12

## 整体评估

实现完整，所有验收标准通过。5 个单元测试全过，`npm run build` 通过，Vercel 生产环境正常运行。

## 验收标准达成情况

| # | 验收标准 | 结果 |
|---|---|---|
| 1 | `npm run build` 通过 | ✅ |
| 2 | 本地 `npm run dev` 可打开页面 | ✅ |
| 3 | 页面可选择视频文件并校验大小 | ✅ |
| 4 | 未配置 `BLOB_READ_WRITE_TOKEN` 时返回明确错误 | ✅ |
| 5 | `mode=auto\|green\|blue` 通过校验 | ✅ |
| 6 | `mode=black` 被拒绝 | ✅ |
| 7 | 使用 `/tmp/<jobId>/` 完成后清理 | ✅ |
| 8 | 文档说明 Vercel Blob 配置步骤和素材限制 | ✅ |

## 实际目录结构

```text
web-app/
  docs/
    01-solution-design.md
    02-execution-plan.md
    03-review.md
  package.json
  next.config.ts
  tsconfig.json
  vercel.json
  src/
    app/
      api/
        upload/route.ts      # Blob 上传 token
        convert/route.ts     # 主转换管线
        download/route.ts    # 同域代理下载
        debug/route.ts       # 依赖状态诊断
      page.tsx
      layout.tsx
      globals.css
    components/
      converter-form.tsx     # 主界面
    lib/
      chroma-key.ts          # 六步色度键控
      chroma-key.test.ts
      ffmpeg.ts              # ffmpeg 提帧 + img2webp 编码
      temp-dir.ts            # /tmp 临时目录管理
      validation.ts          # 限制常量 + 参数校验
      validation.test.ts
    types/
      sharp.d.ts
```

限制常量和校验逻辑合并到 `validation.ts`（未按执行文档单独建 `limits.ts`）。

## 核心依赖

| 包 | 用途 | 部署注意 |
|---|---|---|
| `@ffmpeg-installer/ffmpeg` | 提帧、视频探测 | `serverExternalPackages` + NFT 追踪 |
| `libwebp-static` | img2webp 编码（修复 FFmpeg WebP muxer bug） | `serverExternalPackages` + NFT 追踪 |
| `sharp` | PNG 像素读写、色度键控处理 | `serverExternalPackages` |
| `@vercel/blob` | 视频上传和 WebP 存储 | 需 `BLOB_READ_WRITE_TOKEN` |

## 色度键控算法

已从 Python `chroma_key.py` 完整移植六步算法：

| 步骤 | 内容 | 实现 |
|---|---|---|
| 1. 色差键 | key = 幕布通道 - max(另两通道) | ✅ |
| 2. 连续 alpha | 线性过渡 low=20~high=90 | ✅ |
| 3. 背景反混合 | 中位数估计背景色，反解前景 | ✅ |
| 4. 边缘带 despill | MinFilter 限定边缘带，保护前景合法色 | ✅ |
| 5. 软收边 | top-hat 保护细发丝，外圈 alpha 减半 | ✅ |
| 6. 颜色净化 | 核心色 18 次迭代向外延展 | ✅ |

## 部署问题与解决方案

| 问题 | 根因 | 方案 |
|---|---|---|
| ffmpeg 500 | NFT 追踪未包含 Linux 二进制 | `outputFileTracingIncludes` + `serverExternalPackages` |
| sharp 500 | 被 webpack 打包后找不到 libvips | 加入 `serverExternalPackages` |
| 动图残影 | FFmpeg WebP muxer frame blending bug (ticket #7941) | 改用 `libwebp-static` 的 `img2webp` |
| 下载按钮不触发另存为 | 跨域 `<a download>` 被忽略 | 同域 `/api/download` 代理 + `Content-Disposition: attachment` |
| 下载无法选目录 | 浏览器安全限制 | `showSaveFilePicker` API (Chrome/Edge) + 传统回退 |

## 已实现增强功能

- **文件清理**：输入视频即时删除 + 输出文件惰性清理（超 1 小时自动删）
- **转换计时器**：上传/转换期间显示已等待秒数和"请不要关闭页面"警告
- **完成耗时**：转换结束后显示总耗时
- **版本号**：页面底部显示北京时间构建版本号（`vYYYYMMDD.HHmm`）
- **诊断端点**：`/api/debug` 可排查原生依赖状态

## 已知限制

- 仅支持绿幕/蓝幕，不支持 black 模式和复杂背景
- Hobby 计划并发上限（1-2 个），大并发需迁 Cloud Run
- 输出 WebP > 20MB 会报错（保护限制）
- `showSaveFilePicker` 仅 Chrome/Edge 支持，Safari/Firefox 回退传统下载
