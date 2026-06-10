import type { ProcessResult } from '../hooks/useVideoProcessor';

interface Props {
  result: ProcessResult;
  onReset: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function ResultDownload({ result, onReset }: Props) {
  const url = URL.createObjectURL(result.webpBlob);

  return (
    <div className="flex flex-col items-center gap-4 p-6 bg-slate-800/50 rounded-xl border border-slate-700">
      {/* 信息 */}
      <div className="flex gap-6 text-sm text-slate-400">
        <span>{result.width}×{result.height}</span>
        <span>{result.fps} fps · {result.totalFrames} 帧</span>
        <span>{formatSize(result.fileSize)}</span>
      </div>

      {/* 按钮组 */}
      <div className="flex gap-3">
        <a
          href={url}
          download="output.webp"
          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium
            transition-colors inline-flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          下载 WebP
        </a>
        <button
          onClick={onReset}
          className="px-6 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-sm font-medium transition-colors"
        >
          重新处理
        </button>
      </div>
    </div>
  );
}
