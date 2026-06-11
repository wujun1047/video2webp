"""处理流水线 — 调用 ffmpeg + backgroundremover + 后处理脚本"""
import os
import sys
import shutil
import subprocess
from pathlib import Path
from PIL import Image


# ---- 路径解析（兼容开发模式与 PyInstaller 打包模式） ----

def _get_base():
    """获取应用根目录（开发: desktop-app/，打包: sys._MEIPASS）"""
    if getattr(sys, 'frozen', False):
        return Path(getattr(sys, '_MEIPASS', '.'))  # type: ignore[attr-defined]
    return Path(__file__).parent

BASE = _get_base()

# 查找 ffmpeg/ffprobe
def _find_bin(name):
    """先在 bin/mac/ 找，找不到回退到 PATH"""
    bundled = BASE / 'bin' / 'mac' / name
    return str(bundled) if bundled.exists() else name

FFMPEG = _find_bin('ffmpeg')
FFPROBE = _find_bin('ffprobe')

# 设置 U2-Net 模型路径（backgroundremover 需要）
# 打包后在 BASE/.u2net/，开发时在 ~/.u2net/
_U2NET_HOME = BASE / '.u2net' / 'u2net.pth'
if not _U2NET_HOME.exists():
    _U2NET_HOME = Path.home() / '.u2net' / 'u2net.pth'
U2NET_ENV = {'U2NET_HOME': str(_U2NET_HOME.parent)} if _U2NET_HOME.exists() else {}


def _find_script(filename):
    """查找后处理脚本，依次搜索多个目录"""
    candidates = [
        BASE / filename,
        BASE.parent / filename,          # 开发模式：项目根目录
        BASE.parent.parent / filename,   # 打包模式备用
    ]
    for p in candidates:
        if p.exists():
            return str(p)
    return filename  # 最后回退到 PATH 查找


def get_fps(input_path):
    """获取视频帧率"""
    try:
        result = subprocess.run(
            [FFPROBE, '-v', 'quiet', '-select_streams', 'v:0',
             '-show_entries', 'stream=r_frame_rate',
             '-of', 'default=noprint_wrappers=1:nokey=1', str(input_path)],
            capture_output=True, text=True, timeout=30
        )
        fps_str = result.stdout.strip()
        if '/' in fps_str:
            parts = fps_str.split('/')
            return int(int(parts[0]) / int(parts[1]))
        return int(float(fps_str))
    except Exception:
        return 30


def count_frames(dir_path):
    return len(list(dir_path.glob('frame_*.png'))) if dir_path.exists() else 0


def run_pipeline(job: dict, job_id: str, bg_type: str, quality: int):
    try:
        input_path = Path(job['input_file'])
        base_name = input_path.stem
        outputs_dir = Path(job.get('outputs_dir', BASE / 'outputs' / job_id))
        frames_dir = outputs_dir / f'{base_name}_frames'
        nobg_dir = outputs_dir / f'{base_name}_nobg'
        output_file = outputs_dir / f'{base_name}.webp'
        fps = get_fps(input_path)

        # ---- 阶段1: 提取帧 ----
        job.update(stage='extracting', current=0, total=0, message='正在提取视频帧...')
        frames_dir.mkdir(parents=True, exist_ok=True)
        subprocess.run([
            FFMPEG, '-i', str(input_path),
            '-vf', f'fps={fps}',
            str(frames_dir / 'frame_%04d.png'),
            '-y', '-loglevel', 'error'
        ], check=True, timeout=300)
        total_frames = count_frames(frames_dir)
        job.update(stage='extracting', current=total_frames, total=total_frames,
                   message=f'提取完成，共 {total_frames} 帧')

        # ---- 阶段2: AI 去背景 ----
        job.update(stage='removing-bg', current=0, total=total_frames,
                   message='正在 AI 去背景...')
        nobg_dir.mkdir(parents=True, exist_ok=True)
        frames = sorted(frames_dir.glob('frame_*.png'))

        for i in range(0, len(frames), 4):
            batch = frames[i:i + 4]
            procs = []
            for f in batch:
                out = nobg_dir / f.name
                procs.append(subprocess.Popen(
                    ['backgroundremover', '-i', str(f), '-o', str(out)],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    env={**os.environ, **U2NET_ENV}
                ))
            for p in procs:
                p.wait()
            done = min(i + 4, total_frames)
            job.update(stage='removing-bg', current=done, total=total_frames,
                       message=f'去背景 {done}/{total_frames}')

        # ---- 阶段3: 后处理 ----
        job.update(stage='postprocess', current=0, total=total_frames,
                   message='正在后处理...')

        # 使用 .venv 中的 python（开发模式），否则用当前 python
        venv_py = BASE.parent / '.venv' / 'bin' / 'python3'
        py = [str(venv_py)] if venv_py.exists() else [sys.executable]
        fs = str(frames_dir)
        ns = str(nobg_dir)

        if bg_type == 'blue':
            job['message'] = '后处理: restore_alpha...'
            subprocess.run(py + [_find_script('restore_alpha.py'), fs, ns], check=True, timeout=600)
            job['message'] = '后处理: cleanup_blue...'
            subprocess.run(py + [_find_script('cleanup_blue.py'), fs, ns], check=True, timeout=600)
            job['message'] = '后处理: despill_blue...'
            subprocess.run(py + [_find_script('despill_blue.py'), ns], check=True, timeout=600)
        elif bg_type in ('green', 'auto'):
            job['message'] = '后处理: cleanup_black...'
            subprocess.run(py + [_find_script('cleanup_black.py'), fs, ns], check=True, timeout=600)
            job['message'] = '后处理: despill...'
            subprocess.run(py + [_find_script('despill.py'), ns], check=True, timeout=600)
        elif bg_type == 'black':
            job['message'] = '后处理: cleanup_black...'
            subprocess.run(py + [_find_script('cleanup_black.py'), fs, ns], check=True, timeout=600)

        job.update(stage='postprocess', current=total_frames, total=total_frames,
                   message='后处理完成')

        # ---- 阶段4: 合成 WebP（Python Pillow） ----
        job.update(stage='encoding', current=0, total=total_frames,
                   message='正在合成 WebP...')

        png_files = sorted(nobg_dir.glob('frame_*.png'))
        duration_ms = int(1000 / fps)
        frames_pil = [Image.open(f) for f in png_files]
        frames_pil[0].save(
            str(output_file), save_all=True,
            append_images=frames_pil[1:], duration=duration_ms,
            loop=0, lossless=False, quality=quality, method=6,
        )
        for f in frames_pil:
            f.close()

        job.update(stage='done', current=total_frames, total=total_frames,
                   message='处理完成',
                   output_file=str(output_file),
                   output_size=output_file.stat().st_size)

        # 清理中间文件
        shutil.rmtree(frames_dir, ignore_errors=True)
        shutil.rmtree(nobg_dir, ignore_errors=True)

    except subprocess.TimeoutExpired:
        job.update(stage='error', message='处理超时，请检查视频文件')
    except subprocess.CalledProcessError as e:
        msg = e.stderr[:200] if e.stderr else str(e)
        job.update(stage='error', message=f'命令执行失败: {msg}')
    except Exception as e:
        job.update(stage='error', message=f'处理出错: {e}')
