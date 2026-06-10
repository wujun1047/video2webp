import { useState, useCallback, useRef, useEffect } from 'react';
import { FileDropZone } from './components/FileDropZone';
import { SettingsPanel } from './components/SettingsPanel';
import { PreviewCompare } from './components/PreviewCompare';
import { ProgressBar } from './components/ProgressBar';
import { ResultDownload } from './components/ResultDownload';
import { useVideoProcessor } from './hooks/useVideoProcessor';
import type { ProcessResult, ProcessOptions } from './hooks/useVideoProcessor';
import type { BgType } from './utils/bgDetector';

// Electron 关闭检测用
declare global {
  interface Window {
    __isProcessing?: boolean;
  }
}

export default function App() {
  const { progress, result, process, reset } = useVideoProcessor();

  // 设置
  const [bgType, setBgType] = useState<BgType>('auto');
  const [targetFps, setTargetFps] = useState(0);
  const [quality, setQuality] = useState(85);
  const [maxSize, setMaxSize] = useState(0);

  // 文件
  const [file, setFile] = useState<File | null>(null);
  const [origPreview, setOrigPreview] = useState<ImageBitmap | null>(null);

  // 处理状态
  const [lastResult, setLastResult] = useState<ProcessResult | null>(null);
  const processingRef = useRef(false);

  const isIdle = progress.stage === 'idle';
  const isDone = progress.stage === 'done';

  // 同步处理状态到 window（Electron 关闭检测用）
  useEffect(() => {
    window.__isProcessing = processingRef.current;
    return () => { window.__isProcessing = false; };
  }, []);

  const handleFile = useCallback(async (f: File) => {
    setFile(f);
    setLastResult(null);
    reset();

    // 生成首帧预览
    const videoUrl = URL.createObjectURL(f);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;

    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error('无法加载视频'));
        video.src = videoUrl;
      });

      video.currentTime = 0;
      await new Promise<void>((r) => { video.onseeked = () => r(); });

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(video, 0, 0);
      const bitmap = await createImageBitmap(canvas);
      setOrigPreview(bitmap);
    } catch {
      setOrigPreview(null);
    } finally {
      URL.revokeObjectURL(videoUrl);
    }
  }, [reset]);

  const handleStart = useCallback(async () => {
    if (!file || processingRef.current) return;

    const options: ProcessOptions = { bgType, targetFps, quality, maxSize };

    processingRef.current = true;
    window.__isProcessing = true;
    setLastResult(null);

    try {
      const res = await process(file, options);
      setLastResult(res);
    } catch {
      // 错误已在 hook 中处理
    } finally {
      processingRef.current = false;
      window.__isProcessing = false;
    }
  }, [file, bgType, targetFps, quality, maxSize, process]);

  const handleReset = useCallback(() => {
    reset();
    setFile(null);
    setOrigPreview(null);
    setLastResult(null);
    processingRef.current = false;
    window.__isProcessing = false;
  }, [reset]);

  // 预览帧
  const previewOriginal = origPreview;
  const previewProcessed = result?.previewFrame || lastResult?.previewFrame || null;

  return (
    <div className="min-h-screen bg-slate-900 flex items-start justify-center py-8 px-4">
      <div className="w-full max-w-2xl space-y-6">
        {/* 标题 */}
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-white">
            视频转透明 WebP
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            纯本地处理，文件不上传
          </p>
        </div>

        {/* 上传区 */}
        {isIdle && !processingRef.current && (
          <FileDropZone onFile={handleFile} disabled={processingRef.current} />
        )}

        {/* 文件名显示 */}
        {file && (
          <div className="text-sm text-slate-400 text-center">
            已选择: <span className="text-slate-200">{file.name}</span>
            {' '}({(file.size / (1024 * 1024)).toFixed(2)} MB)
          </div>
        )}

        {/* 设置面板 */}
        {file && isIdle && !processingRef.current && (
          <SettingsPanel
            bgType={bgType} onBgTypeChange={setBgType}
            targetFps={targetFps} onTargetFpsChange={setTargetFps}
            quality={quality} onQualityChange={setQuality}
            maxSize={maxSize} onMaxSizeChange={setMaxSize}
            disabled={processingRef.current}
          />
        )}

        {/* 开始按钮 */}
        {file && isIdle && !processingRef.current && !isDone && (
          <div className="text-center">
            <button
              onClick={handleStart}
              className="px-8 py-3 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white rounded-xl
                text-base font-medium transition-all duration-200 shadow-lg shadow-blue-600/25
                hover:shadow-blue-500/30"
            >
              开始处理
            </button>
          </div>
        )}

        {/* 进度条 */}
        {!isIdle && (
          <ProgressBar progress={progress} />
        )}

        {/* 预览对比 */}
        {file && (previewOriginal || previewProcessed) && (
          <PreviewCompare
            originalFrame={previewOriginal}
            processedFrame={previewProcessed}
          />
        )}

        {/* 结果下载 */}
        {(isDone && lastResult) && (
          <ResultDownload result={lastResult} onReset={handleReset} />
        )}
      </div>
    </div>
  );
}
