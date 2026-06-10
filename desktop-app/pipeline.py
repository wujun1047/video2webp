"""处理流水线 — 调用现有 ffmpeg + backgroundremover + 后处理脚本"""
import sys
import subprocess
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent  # 项目根目录，有 .venv 和脚本

# 项目根目录下的后处理脚本
SCRIPTS = {
    'cleanup_black': PROJECT_ROOT / 'cleanup_black.py',
    'cleanup_blue': PROJECT_ROOT / 'cleanup_blue.py',
    'despill': PROJECT_ROOT / 'despill.py',
    'despill_blue': PROJECT_ROOT / 'despill_blue.py',
    'restore_alpha': PROJECT_ROOT / 'restore_alpha.py',
}

def get_fps(input_path):
    """获取视频帧率"""
    try:
        result = subprocess.run(
            ['ffprobe', '-v', 'quiet', '-select_streams', 'v:0',
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
        return 30  # 默认 30fps

def count_frames(dir_path: Path):
    """统计目录中 frame_*.png 数量"""
    return len(list(dir_path.glob('frame_*.png'))) if dir_path.exists() else 0

def run_pipeline(job: dict, job_id: str, bg_type: str, quality: int):
    """后台运行完整处理管线，实时更新 job 状态"""
    try:
        input_path = Path(job['input_file'])
        base_name = input_path.stem
        outputs_dir = Path(job.get('outputs_dir', SCRIPT_DIR / 'outputs' / job_id))
        frames_dir = outputs_dir / f'{base_name}_frames'
        nobg_dir = outputs_dir / f'{base_name}_nobg'
        output_file = outputs_dir / f'{base_name}.webp'

        fps = get_fps(input_path)

        # ---- 阶段1: 提取帧 ----
        job['stage'] = 'extracting'
        job['message'] = '正在提取视频帧...'
        job['current'] = 0
        job['total'] = 0

        frames_dir.mkdir(parents=True, exist_ok=True)
        subprocess.run([
            'ffmpeg', '-i', str(input_path),
            '-vf', f'fps={fps}',
            str(frames_dir / 'frame_%04d.png'),
            '-y', '-loglevel', 'error'
        ], check=True, timeout=300)

        total_frames = count_frames(frames_dir)
        job['current'] = total_frames
        job['total'] = total_frames
        job['message'] = f'提取完成，共 {total_frames} 帧'

        # ---- 阶段2: AI 去背景 ----
        job['stage'] = 'removing-bg'
        job['current'] = 0
        job['total'] = total_frames
        job['message'] = '正在 AI 去背景...'

        nobg_dir.mkdir(parents=True, exist_ok=True)
        frames = sorted(frames_dir.glob('frame_*.png'))

        for i in range(0, len(frames), 4):
            batch = frames[i:i + 4]
            procs = []
            for f in batch:
                out = nobg_dir / f.name
                p = subprocess.Popen(
                    ['backgroundremover', '-i', str(f), '-o', str(out)],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
                procs.append(p)
            for p in procs:
                p.wait()
            done = min(i + 4, total_frames)
            job['current'] = done
            job['message'] = f'去背景 {done}/{total_frames}'

        # ---- 阶段3: 后处理 ----
        job['stage'] = 'postprocess'
        job['current'] = 0
        job['total'] = total_frames
        job['message'] = '正在后处理...'

        # 尝试用 .venv 中的 python，否则用系统 python
        venv_python = PROJECT_ROOT / '.venv' / 'bin' / 'python3'
        py = [str(venv_python)] if venv_python.exists() else [sys.executable]
        frames_dir_s = str(frames_dir)
        nobg_dir_s = str(nobg_dir)

        if bg_type == 'blue':
            job['message'] = '后处理: restore_alpha...'
            subprocess.run(py + [str(SCRIPTS['restore_alpha']), frames_dir_s, nobg_dir_s], check=True, timeout=600)
            job['message'] = '后处理: cleanup_blue...'
            subprocess.run(py + [str(SCRIPTS['cleanup_blue']), frames_dir_s, nobg_dir_s], check=True, timeout=600)
            job['message'] = '后处理: despill_blue...'
            subprocess.run(py + [str(SCRIPTS['despill_blue']), nobg_dir_s], check=True, timeout=600)
        elif bg_type in ('green', 'auto'):
            job['message'] = '后处理: cleanup_black...'
            subprocess.run(py + [str(SCRIPTS['cleanup_black']), frames_dir_s, nobg_dir_s], check=True, timeout=600)
            job['message'] = '后处理: despill...'
            subprocess.run(py + [str(SCRIPTS['despill']), nobg_dir_s], check=True, timeout=600)
        elif bg_type == 'black':
            job['message'] = '后处理: cleanup_black...'
            subprocess.run(py + [str(SCRIPTS['cleanup_black']), frames_dir_s, nobg_dir_s], check=True, timeout=600)

        job['current'] = total_frames
        job['message'] = '后处理完成'

        # ---- 阶段4: 合成 WebP ----
        job['stage'] = 'encoding'
        job['current'] = 0
        job['message'] = '正在合成 WebP...'

        duration_ms = int(1000 / fps)
        img2webp_cmd = ['img2webp', '-d', str(duration_ms),
                        '-lossy', '-q', str(quality)]
        for f in sorted(nobg_dir.glob('frame_*.png')):
            img2webp_cmd.append(str(f))
        img2webp_cmd.extend(['-o', str(output_file)])
        subprocess.run(img2webp_cmd, check=True, timeout=300)

        # ---- 完成 ----
        job['stage'] = 'done'
        job['current'] = total_frames
        job['total'] = total_frames
        job['message'] = '处理完成'
        job['output_file'] = str(output_file)
        job['output_size'] = output_file.stat().st_size

        # 清理中间文件
        import shutil
        shutil.rmtree(frames_dir, ignore_errors=True)
        shutil.rmtree(nobg_dir, ignore_errors=True)

    except subprocess.TimeoutExpired:
        job['stage'] = 'error'
        job['message'] = '处理超时，请检查视频文件'
    except subprocess.CalledProcessError as e:
        job['stage'] = 'error'
        job['message'] = f'命令执行失败: {e.stderr[:200] if e.stderr else str(e)}'
    except Exception as e:
        job['stage'] = 'error'
        job['message'] = f'处理出错: {e}'
