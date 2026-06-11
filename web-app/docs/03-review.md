# Web App 实现审查报告

审查时间：2026-06-11

## 整体评估

**实现基本完整，代码质量良好**。对照 `02-execution-plan.md` 的 11 个步骤，核心功能全部落地。4 个单元测试全过，`npm run build` 通过。

## 验收标准达成情况

| # | 验收标准 | 结果 |
|---|---|---|
| 1 | `npm run build` 通过 | ✅ |
| 2 | 本地 `npm run dev` 可打开页面 | ✅ |
| 3 | 页面可选择视频文件并校验大小 | ✅ 前端按钮在 `file.size > 50MB` 时禁用 |
| 4 | 未配置 `BLOB_READ_WRITE_TOKEN` 时返回明确错误 | ✅ upload/convert 两个接口均校验 |
| 5 | `mode=auto\|green\|blue` 通过校验 | ✅ `isBackgroundMode()` 类型守卫 |
| 6 | `mode=black` 被拒绝 | ✅ `MODES` 常量不包含 `black` |
| 7 | 使用 `/tmp/<jobId>/` 完成后清理 | ✅ `finally` 块调用 `cleanupJob()` |
| 8 | 文档说明 Vercel Blob 配置步骤和素材限制 | ✅ README 完整覆盖 |

## 色度键控算法对比（Python vs TypeScript）

| 步骤 | Python (`chroma_key.py`) | TypeScript (`chroma-key.ts`) |
|---|---|---|
| 1. 色差键 | ✅ | ✅ |
| 2. 连续 alpha | ✅ | ✅ |
| 3. 背景反混合 | ✅ 用纯背景像素中位数估计背景色 | ❌ 缺失 |
| 4. 边缘带 despill | ✅ MinFilter 形态学限定边缘带 | ⚠️ 简化：对所有半透明像素做 despill |
| 5. 软收边 (choke) | ✅ top-hat 保护细发丝 | ❌ 缺失 |
| 6. 颜色净化 (extend) | ✅ 10+band*2 迭代延展 | ❌ 缺失 |

### 影响分析

- **步骤 3（背景反混合）缺失**：前景物体边缘可能出现幕布色光晕。Python 版通过反混合恢复真实前景色，TS 版直接用原始 RGB 值。
- **步骤 4（边缘带 despill）简化**：TS 版对所有半透明像素压 B/G 通道，不限制边缘带范围。可能导致前景中合法的绿色/蓝色元素被错误去饱和。
- **步骤 5-6 缺失**：边缘可能更粗糙，但执行文档明确写了"第一版允许简化"。

**建议**：优先用真实绿幕/蓝幕素材验证效果。如果边缘光晕或锯齿明显，按以下顺序补齐：

1. 背景反混合（步骤 3）
2. 边缘带限定（步骤 4 改进）
3. 软收边 + 颜色净化（步骤 5-6）

## 发现的问题

### 1. 🟡 `durationMs` 语义错误

`convert/route.ts:90`：

```ts
durationMs: Math.round(1000 / effectiveFps),
```

计算的是每帧间隔毫秒数，并非接口文档中标注的"durationMs"（通常理解为处理耗时）。好在 `converter-form.tsx` 没有展示这个字段，不影响用户。

### 2. 🟡 目录结构微小偏差

执行文档要求创建 `src/lib/limits.ts`，实际实现将所有限制常量和校验逻辑合并到 `src/lib/validation.ts`。功能无误。

### 3. 🟢 ffmpeg spawn 无超时控制

`ffmpeg.ts` 的 `runFfmpeg` 使用 `child_process.spawn`，未设置超时。生产环境由 Vercel `maxDuration=300` 秒兜底，风险可控。

### 4. 🟢 globals.css 冗余 dark mode 规则

`globals.css` 中有 `@media (prefers-color-scheme: dark)` 规则，但页面组件全部使用硬编码 Tailwind 颜色值（如 `bg-[#f6f4ef]`），不依赖 CSS 变量。属 `create-next-app` 模板遗留。

### 5. 🟢 `src/types/sharp.d.ts` 可能冗余

sharp 0.35+ 自带类型声明，独立的 `.d.ts` 可能不需要。

## 架构设计亮点

1. **Vercel Blob client upload 绕开 4.5MB 限制**：前端直传 Blob，后端只收 URL，遵循 Vercel Function 最佳实践。

2. **独立 jobId 隔离**：`temp-dir.ts` 使用 `mkdtemp` 创建独立临时目录，避免并发任务互相干扰。

3. **参数校验层**：`validation.ts` 的 `normalizeConvertOptions` 统一校验，含 Blob URL 域名白名单（`isTrustedBlobUrl`），防止 SSRF 攻击。

4. **错误信息对用户友好**：`getErrorMessage` 过滤堆栈，只返回 `error.message`。

5. **前端状态机清晰**：`Stage` 类型覆盖 `idle → uploading → converting → done/error` 完整流程，上传中禁用提交按钮防止重复提交。

6. **Vercel 配置合理**：`vercel.json` 为 convert 函数分配 3009MB 内存和 300s 超时，next.config.ts 配置 `serverExternalPackages` 确保 ffmpeg 二进制正确打包。
