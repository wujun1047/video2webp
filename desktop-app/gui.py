"""视频转透明 WebP 桌面应用 — pywebview 原生窗口"""
import os
import sys
import json
import shutil
import threading
from pathlib import Path

import webview

SCRIPT_DIR = Path(__file__).parent
OUTPUTS_DIR = SCRIPT_DIR / 'outputs'
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

# U2-Net 模型路径（兼容开发与打包模式）
if getattr(sys, 'frozen', False):
    # PyInstaller 打包后，资源在 sys._MEIPASS
    U2NET_DIR = Path(getattr(sys, '_MEIPASS', '.')) / '.u2net'  # type: ignore[attr-defined]
else:
    U2NET_DIR = Path.home() / '.u2net'
if U2NET_DIR.exists():
    os.environ['U2NET_HOME'] = str(U2NET_DIR)

# 使用项目根目录的 .venv（仅开发模式）
PROJECT_ROOT = SCRIPT_DIR.parent
VENV_PYTHON = PROJECT_ROOT / '.venv' / 'bin' / 'python3'


class AppAPI:
    """暴露给前端 JS 的 Python API"""

    def __init__(self):
        self._job = None
        self._thread = None

    def select_file(self):
        """打开文件选择对话框，返回视频信息"""
        path = self._native_open_dialog()
        if not path:
            return None
        path = path.strip()

        # 获取视频信息
        import subprocess
        info = subprocess.run(
            ['ffprobe', '-v', 'error', '-select_streams', 'v:0',
             '-show_entries', 'stream=width,height,r_frame_rate',
             '-of', 'json', path],
            capture_output=True, text=True, timeout=10
        )
        streams = json.loads(info.stdout).get('streams', [])
        width, height, fps = 0, 0, 30
        if streams:
            s = streams[0]
            width, height = s.get('width', 0), s.get('height', 0)
            fps_str = s.get('r_frame_rate', '30/1')
            if '/' in fps_str:
                parts = fps_str.split('/')
                fps = int(int(parts[0]) / int(parts[1]))
            else:
                fps = int(float(fps_str))

        filename = os.path.basename(path)
        size = os.path.getsize(path)

        return json.dumps({
            'path': path,
            'filename': filename,
            'width': width,
            'height': height,
            'fps': fps,
            'size_mb': round(size / 1024 / 1024, 1),
        })

    def start_process(self, params_json):
        """启动后台处理"""
        if self._thread and self._thread.is_alive():
            return json.dumps({'error': '已在处理中'})

        params = json.loads(params_json)
        path = params['path']
        bg_type = params.get('bg_type', 'auto')
        quality = int(params.get('quality', 85))

        job = {
            'input_file': path,
            'stage': 'queued',
            'current': 0, 'total': 0,
            'message': '等待开始',
            'output_file': None,
        }
        self._job = job

        def _run():
            self._run_pipeline(job, bg_type, quality)

        self._thread = threading.Thread(target=_run, daemon=True)
        self._thread.start()
        return json.dumps({'status': 'started'})

    def get_progress(self):
        """获取当前进度"""
        if not self._job:
            return json.dumps({'stage': 'idle'})
        return json.dumps({
            'stage': self._job.get('stage', 'idle'),
            'current': self._job.get('current', 0),
            'total': self._job.get('total', 0),
            'message': self._job.get('message', ''),
            'output_file': self._job.get('output_file'),
        })

    def save_file(self):
        """保存文件对话框"""
        if not self._job or not self._job.get('output_file'):
            return json.dumps({'error': '没有生成的文件'})

        src = self._job['output_file']
        dst = self._native_save_dialog(os.path.basename(src))
        if dst:
            dst = dst.strip()
            shutil.copy2(src, dst)
            return json.dumps({'status': 'saved', 'path': dst})
        return json.dumps({'status': 'cancelled'})

    @staticmethod
    def _native_open_dialog():
        """使用系统原生文件对话框"""
        import subprocess
        import platform
        system = platform.system()
        try:
            if system == 'Darwin':
                script = 'POSIX path of (choose file of type {"mov","mp4"} with prompt "选择视频文件")'
                result = subprocess.run(
                    ['osascript', '-e', script],
                    capture_output=True, text=True, timeout=120
                )
                return result.stdout.strip() or None
            elif system == 'Windows':
                import ctypes
                from ctypes import wintypes
                # Windows 文件对话框
                # 使用 PowerShell 作为简化方案
                result = subprocess.run(
                    ['powershell', '-Command',
                     'Add-Type -AssemblyName System.Windows.Forms; '
                     '$f = New-Object System.Windows.Forms.OpenFileDialog; '
                     '$f.Filter = "视频文件 (*.mov;*.mp4)|*.mov;*.mp4"; '
                     '$f.Title = "选择视频文件"; '
                     'if ($f.ShowDialog() -eq "OK") { $f.FileName }'],
                    capture_output=True, text=True, timeout=120
                )
                return result.stdout.strip() or None
            else:
                # Linux 回退
                result = subprocess.run(
                    ['zenity', '--file-selection', '--file-filter=*.mov *.mp4', '--title=选择视频文件'],
                    capture_output=True, text=True, timeout=120
                )
                return result.stdout.strip() or None
        except Exception:
            return None

    @staticmethod
    def _native_save_dialog(default_name='output.webp'):
        """使用系统原生保存对话框"""
        import subprocess
        import platform
        system = platform.system()
        try:
            if system == 'Darwin':
                script = f'POSIX path of (choose file name with prompt "保存 WebP 动图" default name "{default_name}")'
                result = subprocess.run(
                    ['osascript', '-e', script],
                    capture_output=True, text=True, timeout=120
                )
                return result.stdout.strip() or None
            elif system == 'Windows':
                result = subprocess.run(
                    ['powershell', '-Command',
                     'Add-Type -AssemblyName System.Windows.Forms; '
                     f'$f = New-Object System.Windows.Forms.SaveFileDialog; '
                     '$f.Filter = "WebP 动图 (*.webp)|*.webp"; '
                     '$f.Title = "保存 WebP 动图"; '
                     f'$f.FileName = "{default_name}"; '
                     'if ($f.ShowDialog() -eq "OK") { $f.FileName }'],
                    capture_output=True, text=True, timeout=120
                )
                return result.stdout.strip() or None
            else:
                result = subprocess.run(
                    ['zenity', '--file-selection', '--save', f'--filename={default_name}',
                     '--file-filter=*.webp', '--title=保存 WebP 动图'],
                    capture_output=True, text=True, timeout=120
                )
                return result.stdout.strip() or None
        except Exception:
            return None

    # ---- 内部：处理管线 ----

    def _run_pipeline(self, job, bg_type, quality):
        """和 pipeline.py 相同的逻辑，但直接调 Python 函数而非 subprocess"""
        try:
            import subprocess
            from PIL import Image

            input_path = Path(job['input_file'])
            base_name = input_path.stem
            out_dir = OUTPUTS_DIR / base_name
            out_dir.mkdir(parents=True, exist_ok=True)
            frames_dir = out_dir / 'frames'
            nobg_dir = out_dir / 'nobg'
            output_file = out_dir / f'{base_name}.webp'

            # 二进制路径
            bin_dir = SCRIPT_DIR / 'bin' / 'mac'
            ffmpeg = str(bin_dir / 'ffmpeg') if (bin_dir / 'ffmpeg').exists() else 'ffmpeg'
            ffprobe = str(bin_dir / 'ffprobe') if (bin_dir / 'ffprobe').exists() else 'ffprobe'

            # --- 获取帧率 ---
            proc = subprocess.run(
                [ffprobe, '-v', 'quiet', '-select_streams', 'v:0',
                 '-show_entries', 'stream=r_frame_rate',
                 '-of', 'default=noprint_wrappers=1:nokey=1', str(input_path)],
                capture_output=True, text=True, timeout=30
            )
            fps_str = proc.stdout.strip()
            fps = int(float(fps_str)) if '/' not in fps_str else int(int(fps_str.split('/')[0]) / int(fps_str.split('/')[1]))

            # --- 提取帧 ---
            job['stage'] = 'extracting'
            job['message'] = '正在提取视频帧...'
            frames_dir.mkdir(parents=True, exist_ok=True)
            subprocess.run([
                ffmpeg, '-i', str(input_path),
                '-vf', f'fps={fps}',
                str(frames_dir / 'frame_%04d.png'),
                '-y', '-loglevel', 'error'
            ], check=True, timeout=300)

            total_frames = len(list(frames_dir.glob('frame_*.png')))
            job['current'] = total_frames
            job['total'] = total_frames
            job['message'] = f'提取完成，共 {total_frames} 帧'

            # --- AI 去背景 ---
            job['stage'] = 'removing-bg'
            job['current'] = 0
            job['total'] = total_frames
            nobg_dir.mkdir(parents=True, exist_ok=True)
            frames = sorted(frames_dir.glob('frame_*.png'))

            for i in range(0, len(frames), 4):
                batch = frames[i:i + 4]
                procs = []
                for f in batch:
                    procs.append(subprocess.Popen(
                        ['backgroundremover', '-i', str(f), '-o', str(nobg_dir / f.name)],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
                    ))
                for p in procs:
                    p.wait()
                done = min(i + 4, total_frames)
                job['current'] = done
                job['message'] = f'去背景 {done}/{total_frames}'

            # --- 后处理 ---
            job['stage'] = 'postprocess'
            job['current'] = 0
            job['message'] = '正在后处理...'

            py = [str(VENV_PYTHON)] if VENV_PYTHON.exists() else [sys.executable]
            fs = str(frames_dir)
            ns = str(nobg_dir)
            scripts = SCRIPT_DIR / 'scripts'

            def _run_script(name, *args):
                job['message'] = f'后处理: {name}...'
                subprocess.run(py + [str(scripts / name), *args], check=True, timeout=600)

            if bg_type == 'blue':
                _run_script('restore_alpha.py', fs, ns)
                _run_script('cleanup_blue.py', fs, ns)
                _run_script('despill_blue.py', ns)
            elif bg_type in ('green', 'auto'):
                _run_script('cleanup_black.py', fs, ns)
                _run_script('despill.py', ns)
            elif bg_type == 'black':
                _run_script('cleanup_black.py', fs, ns)

            job['current'] = total_frames
            job['message'] = '后处理完成'

            # --- 合成 WebP ---
            job['stage'] = 'encoding'
            job['message'] = '正在合成 WebP...'

            png_files = sorted(nobg_dir.glob('frame_*.png'))
            duration_ms = int(1000 / fps)
            pil_frames = [Image.open(f) for f in png_files]
            pil_frames[0].save(
                str(output_file), save_all=True,
                append_images=pil_frames[1:], duration=duration_ms,
                loop=0, lossless=False, quality=quality, method=6,
            )
            for f in pil_frames:
                f.close()

            job['stage'] = 'done'
            job['current'] = total_frames
            job['total'] = total_frames
            job['message'] = '处理完成'
            job['output_file'] = str(output_file)

            # 清理中间文件
            shutil.rmtree(frames_dir, ignore_errors=True)
            shutil.rmtree(nobg_dir, ignore_errors=True)

        except Exception as e:
            job['stage'] = 'error'
            job['message'] = str(e)[:200]


def main():
    api = AppAPI()
    html_path = SCRIPT_DIR / 'gui.html'
    window = webview.create_window(
        '视频转透明 WebP',
        str(html_path),
        js_api=api,
        width=720,
        height=820,
        min_size=(520, 600),
    )
    webview.start(debug=False)


if __name__ == '__main__':
    main()
