import { useEffect, useRef } from 'react';

interface Props {
  originalFrame: ImageBitmap | null;
  processedFrame: ImageData | null;
}

export function PreviewCompare({ originalFrame, processedFrame }: Props) {
  const origCanvasRef = useRef<HTMLCanvasElement>(null);
  const procCanvasRef = useRef<HTMLCanvasElement>(null);

  // 渲染原始帧
  useEffect(() => {
    if (!originalFrame || !origCanvasRef.current) return;
    const canvas = origCanvasRef.current;
    canvas.width = originalFrame.width;
    canvas.height = originalFrame.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(originalFrame, 0, 0);
  }, [originalFrame]);

  // 渲染处理后帧（带棋盘格背景显示透明）
  useEffect(() => {
    if (!processedFrame || !procCanvasRef.current) return;
    const canvas = procCanvasRef.current;
    canvas.width = processedFrame.width;
    canvas.height = processedFrame.height;
    const ctx = canvas.getContext('2d')!;

    // 先画棋盘格
    drawCheckerboard(ctx, processedFrame.width, processedFrame.height);
    // 再画透明图
    ctx.putImageData(processedFrame, 0, 0);
  }, [processedFrame]);

  const hasContent = originalFrame || processedFrame;

  if (!hasContent) return null;

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* 原始 */}
      <div>
        <p className="text-xs text-slate-400 mb-1.5 text-center">原始帧</p>
        <div className="rounded-lg overflow-hidden border border-slate-600 bg-slate-900">
          <canvas ref={origCanvasRef} className="w-full h-auto" />
        </div>
      </div>
      {/* 去背景后 */}
      <div>
        <p className="text-xs text-slate-400 mb-1.5 text-center">去背景后</p>
        <div className="rounded-lg overflow-hidden border border-slate-600 bg-slate-900">
          <canvas ref={procCanvasRef} className="w-full h-auto" />
        </div>
      </div>
    </div>
  );
}

/** 在 Canvas 上绘制棋盘格背景（显示透明区域） */
function drawCheckerboard(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const size = 12;
  for (let y = 0; y < h; y += size) {
    for (let x = 0; x < w; x += size) {
      ctx.fillStyle = ((x / size + y / size) % 2 === 0) ? '#e5e5e5' : '#ffffff';
      ctx.fillRect(x, y, size, size);
    }
  }
}
