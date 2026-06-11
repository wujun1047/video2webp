"use client";

import { upload } from "@vercel/blob/client";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  DEFAULT_MAX_FPS,
  DEFAULT_MAX_SIZE,
  formatBytes,
  MAX_INPUT_BYTES,
  type BackgroundMode,
} from "@/lib/validation";

type ConvertResult = {
  outputUrl: string;
  sizeBytes: number;
  frames: number;
  durationMs: number;
};

type Stage = "idle" | "uploading" | "converting" | "done" | "error";

const modes: Array<{ value: BackgroundMode; label: string }> = [
  { value: "auto", label: "自动" },
  { value: "green", label: "绿幕" },
  { value: "blue", label: "蓝幕" },
];

export function ConverterForm() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<BackgroundMode>("auto");
  const [quality, setQuality] = useState(85);
  const [maxFps, setMaxFps] = useState(DEFAULT_MAX_FPS);
  const [maxSize, setMaxSize] = useState(DEFAULT_MAX_SIZE);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const finalElapsedRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 转换/上传期间计时器，完成时保存最终耗时
  useEffect(() => {
    if (stage === "uploading" || stage === "converting") {
      setElapsed(0);
      finalElapsedRef.current = 0;
      timerRef.current = setInterval(() => setElapsed((n) => {
        finalElapsedRef.current = n + 1;
        return n + 1;
      }), 1000);
    } else if (stage === "done" || stage === "error") {
      if (timerRef.current) clearInterval(timerRef.current);
      // elapsed 已通过 ref 保存，setState 的异步更新也通过 finalElapsedRef 保证准确
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [stage]);

  function formatElapsed(s: number) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}分${sec}秒` : `${sec}秒`;
  }

  const canSubmit = file && stage !== "uploading" && stage !== "converting";
  const statusText = useMemo(() => {
    if (stage === "uploading") return `上传中 ${progress}%`;
    if (stage === "converting") return "转换中";
    if (stage === "done") return "已完成";
    if (stage === "error") return "失败";
    return "待处理";
  }, [progress, stage]);

  async function handleSubmit() {
    if (!file) return;
    if (file.size > MAX_INPUT_BYTES) {
      fail(`视频不能超过 ${formatBytes(MAX_INPUT_BYTES)}`);
      return;
    }

    setStage("uploading");
    setProgress(0);
    setError("");
    setResult(null);

    try {
      const pathname = `inputs/${sanitizeFileName(file.name)}`;
      const blob = await upload(pathname, file, {
        access: "public",
        handleUploadUrl: "/api/upload",
        multipart: true,
        contentType: file.type || "video/mp4",
        onUploadProgress(event) {
          setProgress(Math.round(event.percentage));
        },
      });

      setStage("converting");
      const response = await fetch("/api/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputUrl: blob.url,
          pathname: blob.pathname,
          filename: file.name,
          mode,
          quality,
          maxFps,
          maxSize,
          sizeBytes: file.size,
        }),
      });

      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error || "转换失败");
      }

      setResult(json);
      setStage("done");
    } catch (err) {
      fail(err instanceof Error ? err.message : "转换失败");
    }
  }

  function fail(message: string) {
    setError(message);
    setStage("error");
  }

  // 下载文件名：原文件名_参数_时间戳.webp
  const downloadName = useMemo(() => {
    if (!file || !result) return "output.webp";
    const base = file.name.replace(/\.[^.]+$/, "").replace(/[^\w一-鿿]+/g, "-").slice(0, 50);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `${base}_${maxSize}px_${maxFps}fps_q${quality}_${ts}.webp`;
  }, [file, result, maxSize, maxFps, quality]);

  // 同域代理下载 URL，避免跨域导致浏览器忽略 download 属性
  const downloadUrl = result
    ? `/api/download?url=${encodeURIComponent(result.outputUrl)}&name=${encodeURIComponent(downloadName)}`
    : "";

  async function handleDownload() {
    if (!result || !downloadUrl) return;
    // 优先使用 showSaveFilePicker（Chrome/Edge 支持），弹出"另存为"对话框让用户选目录
    const w = window as unknown as { showSaveFilePicker?: (opts: {
      suggestedName: string;
      types: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<{ createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }> };
    if (w.showSaveFilePicker) {
      try {
        const res = await fetch(downloadUrl);
        const blob = await res.blob();
        const handle = await w.showSaveFilePicker({
          suggestedName: downloadName,
          types: [{ description: "WebP 图片", accept: { "image/webp": [".webp"] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return; // 用户取消
      }
    }
    // 回退：传统下载方式
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <section className="grid flex-1 gap-6 lg:grid-cols-[minmax(0,1.2fr)_360px]">
      <div className="flex flex-col gap-5">
        <label className="group flex min-h-64 cursor-pointer flex-col items-center justify-center border-2 border-dashed border-[#b9ad98] bg-[#fffdf8] px-6 py-10 text-center transition hover:border-[#191714]">
          <input
            className="sr-only"
            type="file"
            accept="video/mp4,video/quicktime,.mp4,.mov"
            onChange={(event) => {
              const selected = event.target.files?.[0] ?? null;
              setFile(selected);
              setResult(null);
              setError("");
              setStage("idle");
            }}
          />
          <span className="font-mono text-xs uppercase tracking-[0.18em] text-[#766d5f]">
            选择视频
          </span>
          <strong className="mt-4 max-w-full break-words text-2xl font-semibold">
            {file ? file.name : "拖入或点击选择 MOV / MP4"}
          </strong>
          <span className="mt-3 text-sm text-[#766d5f]">
            {file ? formatBytes(file.size) : "50 MB 内，8 秒内"}
          </span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="bg-[#fffdf8] p-4">
            <label className="text-sm font-medium">背景模式</label>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {modes.map((item) => (
                <button
                  className={`h-11 border text-sm transition ${
                    mode === item.value
                      ? "border-[#191714] bg-[#191714] text-white"
                      : "border-[#d8d1c3] bg-white text-[#191714] hover:border-[#191714]"
                  }`}
                  key={item.value}
                  type="button"
                  onClick={() => setMode(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-[#fffdf8] p-4">
            <label className="flex items-center justify-between text-sm font-medium">
              <span>质量</span>
              <span className="font-mono">{quality}</span>
            </label>
            <input
              className="mt-4 w-full accent-[#191714]"
              type="range"
              min="10"
              max="100"
              value={quality}
              onChange={(event) => setQuality(Number(event.target.value))}
            />
          </div>

          <div className="bg-[#fffdf8] p-4">
            <label className="text-sm font-medium">帧率</label>
            <select
              className="mt-3 h-11 w-full border border-[#d8d1c3] bg-white px-3"
              value={maxFps}
              onChange={(event) => setMaxFps(Number(event.target.value))}
            >
              <option value={15}>15fps</option>
              <option value={24}>24fps 默认</option>
              <option value={30}>30fps 高质量</option>
            </select>
          </div>

          <div className="bg-[#fffdf8] p-4">
            <label className="text-sm font-medium">最大边长</label>
            <select
              className="mt-3 h-11 w-full border border-[#d8d1c3] bg-white px-3"
              value={maxSize}
              onChange={(event) => setMaxSize(Number(event.target.value))}
            >
              <option value={480}>480px</option>
              <option value={720}>720px</option>
            </select>
          </div>
        </div>

        <button
          className="h-12 bg-[#191714] px-5 font-medium text-white transition hover:bg-[#3a3328] disabled:cursor-not-allowed disabled:bg-[#aaa194]"
          disabled={!canSubmit}
          type="button"
          onClick={handleSubmit}
        >
          开始转换
        </button>
      </div>

      <aside className="flex flex-col gap-4 bg-[#24201a] p-5 text-[#f8f3e7]">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-[#c8bda9]">
            状态
          </p>
          <h2 className="mt-3 text-2xl font-semibold">{statusText}</h2>
        </div>

        <div className="h-2 bg-[#4a4134]">
          <div
            className="h-full bg-[#f8f3e7] transition-all"
            style={{
              width:
                stage === "done"
                  ? "100%"
                  : stage === "uploading"
                    ? `${progress}%`
                    : stage === "converting"
                      ? "72%"
                      : "0%",
            }}
          />
        </div>

        {(stage === "uploading" || stage === "converting") && (
          <div className="flex flex-col gap-2 text-sm">
            <p className="font-mono text-[#c8bda9]">
              已等待 {formatElapsed(elapsed)}
            </p>
            <p className="flex items-center gap-2 rounded border border-[#5a4a2f] bg-[#2d2410] px-3 py-2 text-[#ffd98c]">
              ⚠️ 转换中，请不要关闭页面
            </p>
          </div>
        )}

        {error && (
          <p className="border border-[#a9533d] bg-[#3d211a] p-3 text-sm text-[#ffd9cb]">
            {error}
          </p>
        )}

        {result && (
          <div className="mt-auto flex flex-col gap-3 border-t border-[#4a4134] pt-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-[#c8bda9]">帧数</dt>
                <dd className="font-mono">{result.frames}</dd>
              </div>
              <div>
                <dt className="text-[#c8bda9]">大小</dt>
                <dd className="font-mono">{formatBytes(result.sizeBytes)}</dd>
              </div>
              <div>
                <dt className="text-[#c8bda9]">耗时</dt>
                <dd className="font-mono">{formatElapsed(finalElapsedRef.current)}</dd>
              </div>
            </dl>
            <button
              className="flex h-11 cursor-pointer items-center justify-center bg-[#f8f3e7] text-sm font-medium text-[#191714] transition hover:bg-white"
              type="button"
              onClick={handleDownload}
            >
              下载 WebP
            </button>
          </div>
        )}
      </aside>
    </section>
  );
}

function sanitizeFileName(filename: string) {
  return filename.replace(/[^\w.-]+/g, "-").slice(0, 100);
}
