"""视频转透明 WebP 桌面应用 — Flask 入口"""
import json
import uuid
import socket
import threading
import subprocess
from pathlib import Path
from flask import Flask, request, jsonify, send_file, render_template

# ---------- 配置 ----------
SCRIPT_DIR = Path(__file__).parent
OUTPUTS_DIR = SCRIPT_DIR / 'outputs'

app = Flask(__name__)

# 全局任务状态
_jobs: dict[str, dict] = {}

# 导入处理流水线
from pipeline import run_pipeline


# ---------- API 端点 ----------

@app.route('/')
def index():
    """首页"""
    return render_template('index.html')


@app.route('/api/upload', methods=['POST'])
def upload():
    """上传视频文件，返回 job_id 和文件信息"""
    file = request.files.get('video')
    if not file or not file.filename:
        return jsonify({'error': '请选择视频文件'}), 400

    ext = Path(file.filename).suffix.lower()
    if ext not in ('.mov', '.mp4'):
        return jsonify({'error': '仅支持 MOV / MP4 格式'}), 400

    job_id = uuid.uuid4().hex[:12]
    out_dir = OUTPUTS_DIR / job_id
    out_dir.mkdir(parents=True, exist_ok=True)

    filepath = out_dir / file.filename
    file.save(str(filepath))

    # 获取视频信息
    width, height, fps = 0, 0, 30
    try:
        info = subprocess.run(
            ['ffprobe', '-v', 'error', '-select_streams', 'v:0',
             '-show_entries', 'stream=width,height,r_frame_rate',
             '-of', 'json', str(filepath)],
            capture_output=True, text=True, timeout=10
        )
        streams = json.loads(info.stdout).get('streams', [])
        if streams:
            s = streams[0]
            width, height = s.get('width', 0), s.get('height', 0)
            fps_str = s.get('r_frame_rate', '30/1')
            if '/' in fps_str:
                parts = fps_str.split('/')
                fps = int(int(parts[0]) / int(parts[1]))
            else:
                fps = int(float(fps_str))
    except Exception:
        pass

    _jobs[job_id] = {
        'id': job_id,
        'input_file': str(filepath),
        'outputs_dir': str(out_dir),
        'stage': 'idle',
        'current': 0,
        'total': 0,
        'message': '文件已上传',
        'output_file': None,
    }

    return jsonify({
        'job_id': job_id,
        'filename': file.filename,
        'width': width,
        'height': height,
        'fps': fps,
        'size': filepath.stat().st_size,
    })


@app.route('/api/process', methods=['POST'])
def process():
    """启动后台处理"""
    data = request.get_json()
    job_id = data.get('job_id')
    bg_type = data.get('bg_type', 'auto')
    quality = int(data.get('quality', 85))

    job = _jobs.get(job_id)
    if not job:
        return jsonify({'error': '任务不存在'}), 404

    if job['stage'] not in ('idle', 'done', 'error'):
        return jsonify({'error': '任务已在处理中'}), 409

    job['stage'] = 'queued'
    job['message'] = '正在启动...'

    thread = threading.Thread(
        target=run_pipeline,
        args=(job, job_id, bg_type, quality),
        daemon=True
    )
    thread.start()

    return jsonify({'status': 'started', 'job_id': job_id})


@app.route('/api/progress/<job_id>', methods=['GET'])
def progress(job_id):
    """查询处理进度"""
    job = _jobs.get(job_id)
    if not job:
        return jsonify({'error': '任务不存在'}), 404
    return jsonify({
        'stage': job['stage'],
        'current': job['current'],
        'total': job['total'],
        'message': job['message'],
    })


@app.route('/api/download/<job_id>', methods=['GET'])
def download(job_id):
    """下载结果 WebP"""
    job = _jobs.get(job_id)
    if not job or not job.get('output_file'):
        return jsonify({'error': '文件不存在'}), 404
    path = Path(job['output_file'])
    if not path.exists():
        return jsonify({'error': '文件已被清理'}), 404
    return send_file(
        str(path),
        as_attachment=True,
        download_name=path.name,
        mimetype='image/webp'
    )


# ---------- 启动 ----------

def find_free_port(start=5566):
    """查找可用端口"""
    for port in range(start, start + 100):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                if s.connect_ex(('127.0.0.1', port)) != 0:
                    return port
        except Exception:
            continue
    return start


if __name__ == '__main__':
    port = find_free_port()
    url = f'http://127.0.0.1:{port}'
    print(f'\n  🎬 视频转透明 WebP 桌面应用')
    print(f'  📍 服务地址: {url}')
    print(f'  📂 输出目录: {OUTPUTS_DIR}')
    print(f'  🛑 按 Ctrl+C 退出\n')

    # 自动打开浏览器
    threading.Timer(1.0, lambda: (
        __import__('webbrowser').open(url),
        print(f'  🌐 浏览器已打开: {url}')
    )).start()

    app.run(host='127.0.0.1', port=port, debug=False)
