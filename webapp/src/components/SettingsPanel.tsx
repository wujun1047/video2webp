import type { BgType } from '../utils/bgDetector';

interface Props {
  bgType: BgType;
  onBgTypeChange: (t: BgType) => void;
  targetFps: number;
  onTargetFpsChange: (f: number) => void;
  quality: number;
  onQualityChange: (q: number) => void;
  maxSize: number;
  onMaxSizeChange: (s: number) => void;
  disabled?: boolean;
}

const bgOptions: { value: BgType; label: string }[] = [
  { value: 'auto', label: '自动检测' },
  { value: 'green', label: '绿色背景' },
  { value: 'blue', label: '蓝色背景' },
  { value: 'black', label: '黑色背景' },
];

const fpsOptions = [
  { value: 0, label: '原帧率' },
  { value: 10, label: '10 fps' },
  { value: 15, label: '15 fps' },
  { value: 30, label: '30 fps' },
];

const sizeOptions = [
  { value: 0, label: '原尺寸' },
  { value: 512, label: '512px' },
  { value: 768, label: '768px' },
  { value: 1024, label: '1024px' },
];

export function SettingsPanel({
  bgType, onBgTypeChange,
  targetFps, onTargetFpsChange,
  quality, onQualityChange,
  maxSize, onMaxSizeChange,
  disabled,
}: Props) {
  return (
    <div className={`grid grid-cols-2 sm:grid-cols-4 gap-4 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {/* 背景类型 */}
      <div>
        <label className="block text-xs text-slate-400 mb-1.5">背景颜色</label>
        <select
          value={bgType}
          onChange={(e) => onBgTypeChange(e.target.value as BgType)}
          className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200
            focus:outline-none focus:border-blue-500 cursor-pointer"
        >
          {bgOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* 帧率 */}
      <div>
        <label className="block text-xs text-slate-400 mb-1.5">帧率</label>
        <select
          value={targetFps}
          onChange={(e) => onTargetFpsChange(Number(e.target.value))}
          className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200
            focus:outline-none focus:border-blue-500 cursor-pointer"
        >
          {fpsOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* 最大尺寸 */}
      <div>
        <label className="block text-xs text-slate-400 mb-1.5">最大尺寸</label>
        <select
          value={maxSize}
          onChange={(e) => onMaxSizeChange(Number(e.target.value))}
          className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200
            focus:outline-none focus:border-blue-500 cursor-pointer"
        >
          {sizeOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* 质量 */}
      <div>
        <label className="block text-xs text-slate-400 mb-1.5">
          质量: <span className="text-blue-400">{quality}</span>
        </label>
        <input
          type="range"
          min={10}
          max={100}
          value={quality}
          onChange={(e) => onQualityChange(Number(e.target.value))}
          className="w-full accent-blue-500"
        />
      </div>
    </div>
  );
}
