/**
 * 视频处理主 Hook
 * 协调整条流水线：视频解码 → 去背景 → 后处理 → WebP 编码
 */

import { useState, useCallback, useRef } from 'react';
import type { BgType } from '../utils/bgDetector';
import { detectBgType } from '../utils/bgDetector';
import { extractFrames } from '../engine/ffmpeg';
import { removeBgBatch } from '../engine/bgremover';
import { postProcessFrame } from '../engine/postprocess';
import { encodeAnimation } from '../engine/webpEncoder';

/** 处理阶段 */
export type Stage =
  | 'idle'
  | 'decoding'    // 正在解码视频
  | 'removing-bg' // 正在去背景
  | 'postprocess' // 正在后处理
  | 'encoding'    // 正在合成 WebP
  | 'done'        // 完成
  | 'error';      // 出错

/** 处理进度 */
export interface Progress {
  stage: Stage;
  current: number;
  total: number;
  message: string;
}

/** 处理结果 */
export interface ProcessResult {
  webpBlob: Blob;
  previewFrame: ImageData | null;
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  fileSize: number;
}

interface UseVideoProcessorReturn {
  progress: Progress;
  result: ProcessResult | null;
  error: string | null;
  process: (
    file: File,
    options: ProcessOptions,
  ) => Promise<ProcessResult>;
  reset: () => void;
}

export interface ProcessOptions {
  bgType: BgType;
  targetFps: number;   // 0 = 保持原帧率
  quality: number;      // 1-100
  maxSize: number;      // 0 = 不缩放
}

export function useVideoProcessor(): UseVideoProcessorReturn {
  const [progress, setProgress] = useState<Progress>({
    stage: 'idle',
    current: 0,
    total: 0,
    message: '',
  });
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef(false);

  const updateProgress = useCallback((update: Partial<Progress>) => {
    setProgress((prev) => ({ ...prev, ...update }));
  }, []);

  const process = useCallback(
    async (file: File, options: ProcessOptions): Promise<ProcessResult> => {
      abortRef.current = false;
      setError(null);
      setResult(null);

      const { bgType: initialBgType, targetFps, maxSize } = options;

      try {
        // ---- 第 1 步：解码视频 ----
        updateProgress({
          stage: 'decoding',
          current: 0,
          total: 0,
          message: '正在解码视频...',
        });

        const extractResult = await extractFrames(file, {
          targetFps,
          maxSize,
          onProgress: (current, total) => {
            if (abortRef.current) return;
            updateProgress({
              stage: 'decoding',
              current,
              total,
              message: `提取帧 ${current}/${total}`,
            });
          },
        });

        if (abortRef.current) throw new Error('已取消');

        const { frames, width, height, fps, totalFrames } = extractResult;

        // 自动检测背景类型
        let bgType = initialBgType;
        if (bgType === 'auto' && frames.length > 0) {
          // 从第一帧检测
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(frames[0], 0, 0);
          const imgData = ctx.getImageData(0, 0, width, height);
          bgType = detectBgType(imgData);
        }

        // ---- 第 2 步：去背景 ----
        updateProgress({
          stage: 'removing-bg',
          current: 0,
          total: totalFrames,
          message: '正在去除背景...',
        });

        const framePairs = await removeBgBatch(frames, {
          model: 'medium',
          onProgress: (current, total) => {
            if (abortRef.current) return;
            updateProgress({
              stage: 'removing-bg',
              current,
              total,
              message: `去背景 ${current}/${total}`,
            });
          },
        });

        if (abortRef.current) throw new Error('已取消');

        // 释放原始 ImageBitmap 内存
        for (const f of frames) f.close();

        // ---- 第 3 步：后处理 ----
        updateProgress({
          stage: 'postprocess',
          current: 0,
          total: totalFrames,
          message: '正在后处理...',
        });

        const processedFrames: ImageData[] = [];
        for (let i = 0; i < framePairs.length; i++) {
          if (abortRef.current) throw new Error('已取消');

          const { original, nobg } = framePairs[i];
          const processed = postProcessFrame(original, nobg, bgType);
          processedFrames.push(processed);

          updateProgress({
            stage: 'postprocess',
            current: i + 1,
            total: totalFrames,
            message: `后处理 ${i + 1}/${totalFrames}`,
          });
        }

        // 释放原始帧和去背景帧引用（减轻内存压力）
        framePairs.length = 0;

        // ---- 第 4 步：编码为动画 WebP ----
        updateProgress({
          stage: 'encoding',
          current: 0,
          total: totalFrames,
          message: '正在合成 WebP 动画...',
        });

        const webpBlob = await encodeAnimation(
          processedFrames,
          fps,
          (current, total) => {
            if (abortRef.current) return;
            updateProgress({
              stage: 'encoding',
              current,
              total,
              message: `合成中 ${current}/${total}`,
            });
          },
        );

        if (abortRef.current) throw new Error('已取消');

        // 获取去背景后的预览帧
        const previewFrame = processedFrames[0] || null;

        const finalResult: ProcessResult = {
          webpBlob,
          previewFrame,
          width,
          height,
          fps,
          totalFrames,
          fileSize: webpBlob.size,
        };

        setResult(finalResult);
        updateProgress({
          stage: 'done',
          current: totalFrames,
          total: totalFrames,
          message: '处理完成！',
        });

        return finalResult;
      } catch (err) {
        const msg = err instanceof Error ? err.message : '处理出错';
        setError(msg);
        updateProgress({ stage: 'error', message: msg });
        throw err;
      }
    },
    [updateProgress],
  );

  const reset = useCallback(() => {
    abortRef.current = true;
    setProgress({ stage: 'idle', current: 0, total: 0, message: '' });
    setResult(null);
    setError(null);
  }, []);

  return { progress, result, error, process, reset };
}
