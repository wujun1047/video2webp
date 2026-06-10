import type { Stage, Progress } from '../hooks/useVideoProcessor';

interface Props {
  progress: Progress;
}

const stageLabels: Record<Stage, string> = {
  idle: '',
  decoding: '解码视频',
  'removing-bg': 'AI 去背景',
  postprocess: '后处理优化',
  encoding: '合成 WebP',
  done: '完成',
  error: '出错',
};

export function ProgressBar({ progress }: Props) {
  const { stage, current, total, message } = progress;

  if (stage === 'idle') return null;

  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  const isError = stage === 'error';
  const isDone = stage === 'done';

  return (
    <div className="w-full space-y-2">
      {/* 阶段标签 */}
      <div className="flex justify-between text-sm">
        <span className={isError ? 'text-red-400' : isDone ? 'text-green-400' : 'text-blue-400'}>
          {stageLabels[stage]}
        </span>
        <span className="text-slate-400">{message}</span>
      </div>

      {/* 进度条 */}
      {total > 0 && !isDone && (
        <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              isError ? 'bg-red-500' : 'bg-blue-500'
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}

      {/* 完成状态 */}
      {isDone && (
        <div className="flex items-center gap-2 text-green-400 text-sm">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          处理完成
        </div>
      )}

      {/* 错误状态 */}
      {isError && (
        <div className="flex items-center gap-2 text-red-400 text-sm">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          {message}
        </div>
      )}
    </div>
  );
}
