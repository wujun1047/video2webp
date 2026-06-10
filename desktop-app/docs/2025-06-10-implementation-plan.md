# Desktop App 实施计划

> **For agentic workers:** 按任务顺序执行，每步 checkbox 完成后打勾。使用 `superpowers:executing-plans` 或逐个实现。

**目标:** 构建跨平台桌面应用，用户双击即可将绿幕/蓝幕/黑幕视频转为透明 WebP 动图

**架构:** Flask 本地服务 + 浏览器单页 UI，通过 subprocess 调用现有 ffmpeg + backgroundremover + Python 后处理管线

**技术栈:** Python 3.12, Flask, HTML + JS (Fetch API), PyInstaller

**代码位置:** `desktop-app/`

---

### Task 1: 项目骨架

**Files:**
- Create: `desktop-app/main.py`
- Create: `desktop-app/pipeline.py`
- Create: `desktop-app/templates/index.html`
- Create: `desktop-app/requirements.txt`

- [ ] **Step 1: 创建目录结构**

```bash
mkdir -p desktop-app/templates desktop-app/outputs
```

- [ ] **Step 2: 写 requirements.txt**

```
flask>=3.0
backgroundremover>=0.4.1
Pillow>=10.0
```

- [ ] **Step 3: 写 Flask 入口骨架 main.py**

```python
"""视频转透明 WebP 桌面应用 — Flask 入口"""
import os
import sys
import json
import uuid
import shutil
import threading
import subprocess
import webbrowser
from pathlib import Path
from flask import Flask, request, jsonify, send_file, render_template

app = Flask(__name__)
SCRIPT_DIR = Path(__file__).parent
OUTPUTS_DIR = SCRIPT_DIR / 'outputs'

# 全局共享状态：{file_id: {stage, current, total, message, error, output_file}}
_jobs: dict[str, dict] = {}

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/upload', methods=['POST'])
def upload():
    ...

@app.route('/api/process', methods=['POST'])
def process():
    ...

@app.route('/api/progress/<job_id>', methods=['GET'])
def progress(job_id):
    ...

@app.route('/api/download/<job_id>', methods=['GET'])
def download(job_id):
    ...

def find_free_port(start=5566):
    """查找可用端口"""
    import socket
    for port in range(start, start + 100):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('127.0.0.1', port)) != 0:
                return port
    return start

if __name__ == '__main__':
    port = find_free_port()
    url = f'http://127.0.0.1:{port}'
    print(f'启动服务: {url}')
    threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    app.run(host='127.0.0.1', port=port, debug=False)
```

- [ ] **Step 4: 验证骨架可启动**

```bash
cd desktop-app && python main.py
# 应输出 "启动服务: http://127.0.0.1:5566" 并自动打开浏览器
# 访问 / 返回空白页（模板尚未实现）
```

- [ ] **Step 5: 提交**

```bash
git add desktop-app/main.py desktop-app/pipeline.py desktop-app/templates/ desktop-app/requirements.txt desktop-app/outputs/.gitkeep
git commit -m "feat: 桌面应用项目骨架 - Flask 入口 + 自动打开浏览器"
```

---

### Task 2: 处理管线 pipeline.py

**Files:**
- Create: `desktop-app/pipeline.py`

功能：通过 subprocess 调用现有脚本，实时更新进度到共享状态。直接复用项目根目录的 `video2webp.sh`、Python 后处理脚本。

- [ ] **Step 1: 写 pipeline.py 主流程**

```python
"""处理流水线 — 调用现有 ffmpeg + backgroundremover + 后处理"""
import os
import sys
import json
import shutil
import subprocess
from pathlib import Path
from threading import Lock

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent  # 项目根目录，那里有 .venv 和脚本

# 脚本路径
VIDEO2WEBP_SH = PROJECT_ROOT / 'video2webp.sh'
SCRIPTS = {
    'cleanup_black': PROJECT_ROOT / 'cleanup_black.py',
    'cleanup_blue': PROJECT_ROOT / 'cleanup_blue.py',
    'despill': PROJECT_ROOT / 'despill.py',
    'despill_blue': PROJECT_ROOT / 'despill_blue.py',
    'restore_alpha': PROJECT_ROOT / 'restore_alpha.py',
}

def run_cmd(cmd: list[str], cwd: str = None, env: dict = None) -> subprocess.CompletedProcess:
    """运行命令，返回 CompletedProcess"""
    merged_env = {**os.environ, **(env or {})}
    return subprocess.run(cmd, cwd=cwd or str(SCRIPT_DIR),
                          env=merged_env, capture_output=True, text=True)

def countdown_total(frames_dir: Path) -> int:
    """统计已有帧数（用于进度）"""
    return len(list(frames_dir.glob('frame_*.png'))) if frames_dir.exists() else 0

def run_pipeline(job: dict, job_id: str, bg_type: str, quality: int,
                 outputs_dir: Path, project_root: Path):
    """在后台线程中运行完整处理管线，更新 job 状态"""
    try:
        input_path = Path(job['input_file'])
        base_name = input_path.stem
        frames_dir = outputs_dir / f'{base_name}_frames'
        nobg_dir = outputs_dir / f'{base_name}_nobg'
        output_file = outputs_dir / f'{base_name}.webp'

        # ---- 阶段1: 提取帧 ----
        job.update(stage='extracting', current=0, total=0,
                   message='正在提取视频帧...')

        fps_str = subprocess.run(
            ['ffprobe', '-v', 'quiet', '-select_streams', 'v:0',
             '-show_entries', 'stream=r_frame_rate',
             '-of', 'default=noprint_wrappers=1:nokey=1', str(input_path)],
            capture_output=True, text=True
        ).stdout.strip()

        fps = int(eval(fps_str)) if '/' not in fps_str else int(fps_str.split('/')[0]) // int(fps_str.split('/')[1])

        frames_dir.mkdir(parents=True, exist_ok=True)
        subprocess.run([
            'ffmpeg', '-i', str(input_path),
            '-vf', f'fps={fps}',
            str(frames_dir / 'frame_%04d.png'),
            '-y', '-loglevel', 'error'
        ], check=True)

        total_frames = countdown_total(frames_dir)
        job.update(stage='extracting', current=total_frames, total=total_frames,
                   message=f'提取完成，共 {total_frames} 帧')

        # ---- 阶段2: 去背景 ----
        job.update(stage='removing-bg', current=0, total=total_frames,
                   message='正在 AI 去背景...')
        nobg_dir.mkdir(parents=True, exist_ok=True)

        frames = sorted(frames_dir.glob('frame_*.png'))
        batch_size = 4  # 4 并发
        for i in range(0, len(frames), batch_size):
            batch = frames[i:i + batch_size]
            procs = []
            for f in batch:
                out = nobg_dir / f.name
                p = subprocess.Popen(
                    ['backgroundremover', '-i', str(f), '-o', str(out)],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
                )
                procs.append(p)
            for p in procs:
                p.wait()
            done = min(i + batch_size, total_frames)
            job.update(stage='removing-bg', current=done, total=total_frames,
                       message=f'去背景 {done}/{total_frames}')

        # ---- 阶段3: 后处理 ----
        job.update(stage='postprocess', current=0, total=total_frames,
                   message='正在后处理...')

        venv_python = str(PROJECT_ROOT / '.venv' / 'bin' / 'python3')
        py = [venv_python] if Path(venv_python).exists() else [sys.executable]

        if bg_type == 'blue':
            # restore_alpha → cleanup_blue → despill_blue
            subprocess.run(py + [str(SCRIPTS['restore_alpha']),
                                 str(frames_dir), str(nobg_dir)], check=True)
            subprocess.run(py + [str(SCRIPTS['cleanup_blue']),
                                 str(frames_dir), str(nobg_dir)], check=True)
            subprocess.run(py + [str(SCRIPTS['despill_blue']),
                                 str(nobg_dir)], check=True)
        elif bg_type == 'green' or bg_type == 'auto':
            subprocess.run(py + [str(SCRIPTS['cleanup_black']),
                                 str(frames_dir), str(nobg_dir)], check=True)
            subprocess.run(py + [str(SCRIPTS['despill']),
                                 str(nobg_dir)], check=True)
        elif bg_type == 'black':
            subprocess.run(py + [str(SCRIPTS['cleanup_black']),
                                 str(frames_dir), str(nobg_dir)], check=True)

        job.update(stage='postprocess', current=total_frames, total=total_frames,
                   message='后处理完成')

        # ---- 阶段4: 合成 WebP ----
        job.update(stage='encoding', current=0, total=total_frames,
                   message='正在合成 WebP...')

        duration_ms = int(1000 / fps)
        img2webp_cmd = ['img2webp', '-d', str(duration_ms),
                        '-lossy', '-q', str(quality)]
        for f in sorted(nobg_dir.glob('frame_*.png')):
            img2webp_cmd.append(str(f))
        img2webp_cmd.extend(['-o', str(output_file)])

        subprocess.run(img2webp_cmd, check=True)

        # ---- 完成 ----
        job.update(stage='done', current=total_frames, total=total_frames,
                   message='处理完成', output_file=str(output_file))

    except subprocess.CalledProcessError as e:
        job.update(stage='error', message=f'命令执行失败: {e}')
    except Exception as e:
        job.update(stage='error', message=f'处理出错: {e}')
```

- [ ] **Step 2: 提交**

```bash
git add desktop-app/pipeline.py
git commit -m "feat: 处理流水线 - subprocess 调用现有脚本"
```

---

### Task 3: Flask API 端点

**Files:**
- Modify: `desktop-app/main.py`

补充 4 个 API 端点的完整实现。

- [ ] **Step 1: 更新 main.py — 添加 API 实现**

找到 `upload()` 函数，替换占位：

```python
@app.route('/api/upload', methods=['POST'])
def upload():
    file = request.files.get('video')
    if not file:
        return jsonify({'error': '请选择视频文件'}), 400

    ext = Path(file.filename).suffix.lower()
    if ext not in ('.mov', '.mp4'):
        return jsonify({'error': '仅支持 MOV / MP4 格式'}), 400

    job_id = uuid.uuid4().hex[:12]
    out_dir = OUTPUTS_DIR / job_id
    out_dir.mkdir(parents=True, exist_ok=True)

    filepath = out_dir / file.filename
    file.save(str(filepath))

    _jobs[job_id] = {
        'id': job_id,
        'input_file': str(filepath),
        'stage': 'idle',
        'current': 0,
        'total': 0,
        'message': '文件已上传',
        'output_file': None,
    }

    # 读取首帧信息
    info = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'v:0',
         '-show_entries', 'stream=width,height,r_frame_rate',
         '-of', 'json', str(filepath)],
        capture_output=True, text=True
    )
    try:
        stream = json.loads(info.stdout)['streams'][0]
        fps_str = stream.get('r_frame_rate', '30/1')
        w, h = stream['width'], stream['height']
        fps = int(eval(fps_str)) if '/' not in fps_str else int(fps_str.split('/')[0]) // int(fps_str.split('/')[1])
    except Exception:
        w, h, fps = 0, 0, 30

    return jsonify({
        'job_id': job_id,
        'filename': file.filename,
        'width': w,
        'height': h,
        'fps': fps,
        'size': filepath.stat().st_size,
    })
```

找到 `process()` 函数，替换占位：

```python
@app.route('/api/process', methods=['POST'])
def process():
    data = request.get_json()
    job_id = data.get('job_id')
    bg_type = data.get('bg_type', 'auto')
    quality = data.get('quality', 85)

    job = _jobs.get(job_id)
    if not job:
        return jsonify({'error': '任务不存在'}), 404

    job['stage'] = 'queued'
    thread = threading.Thread(
        target=run_pipeline,
        args=(job, job_id, bg_type, quality, OUTPUTS_DIR / job_id, SCRIPT_DIR.parent),
        daemon=True
    )
    thread.start()

    return jsonify({'status': 'started', 'job_id': job_id})
```

找到 `progress()` 和 `download()`，替换占位：

```python
@app.route('/api/progress/<job_id>', methods=['GET'])
def progress(job_id):
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
    job = _jobs.get(job_id)
    if not job or not job.get('output_file'):
        return jsonify({'error': '文件不存在'}), 404
    path = Path(job['output_file'])
    return send_file(str(path), as_attachment=True,
                     download_name=path.name, mimetype='image/webp')
```

- [ ] **Step 2: 提交**

```bash
git add desktop-app/main.py
git commit -m "feat: Flask 4 个 API 端点完整实现"
```

---

### Task 4: 前端 UI 页面

**Files:**
- Create: `desktop-app/templates/index.html`

单页应用，内嵌 CSS 和 JS，使用 CDN Tailwind。核心功能：拖拽上传、参数设置、进度显示、预览对比、下载。

- [ ] **Step 1: 写完整 HTML 页面**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>视频转透明 WebP</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  .drag-over { border-color: #3b82f6 !important; background: rgba(59,130,246,0.1); }
  .checkerboard {
    background-image: linear-gradient(45deg, #ccc 25%, transparent 25%),
                      linear-gradient(-45deg, #ccc 25%, transparent 25%),
                      linear-gradient(45deg, transparent 75%, #ccc 75%),
                      linear-gradient(-45deg, transparent 75%, #ccc 75%);
    background-size: 20px 20px;
    background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
  }
</style>
</head>
<body class="bg-slate-900 min-h-screen text-slate-200 flex justify-center py-8 px-4">
<div id="app" class="w-full max-w-2xl space-y-6">

  <!-- 标题 -->
  <div class="text-center">
    <h1 class="text-2xl font-semibold text-white">视频转透明 WebP</h1>
    <p class="text-sm text-slate-400 mt-1">纯本地处理，不上传网络</p>
  </div>

  <!-- 上传区 -->
  <div id="dropzone" class="border-2 border-dashed border-slate-600 rounded-xl p-10 text-center cursor-pointer
    hover:border-slate-400 transition-all">
    <input type="file" id="fileInput" accept=".mov,.mp4" class="hidden">
    <div class="flex flex-col items-center gap-3">
      <svg class="w-12 h-12 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
          d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/>
      </svg>
      <p class="text-lg text-slate-300">拖拽或<span class="text-blue-400">点击</span>上传视频</p>
      <p class="text-sm text-slate-500">支持 MOV / MP4</p>
    </div>
  </div>

  <!-- 文件信息 -->
  <div id="fileInfo" class="hidden text-sm text-center text-slate-400"></div>

  <!-- 设置面板 -->
  <div id="settings" class="hidden grid grid-cols-2 sm:grid-cols-4 gap-4">
    <div><label class="text-xs text-slate-400">背景</label>
      <select id="bgType" class="w-full mt-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm">
        <option value="auto">自动检测</option><option value="green">绿色</option>
        <option value="blue">蓝色</option><option value="black">黑色</option>
      </select></div>
    <div><label class="text-xs text-slate-400">帧率</label>
      <select id="fps" class="w-full mt-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm">
        <option value="0">原帧率</option><option value="15">15 fps</option><option value="30">30 fps</option>
      </select></div>
    <div><label class="text-xs text-slate-400">最大尺寸</label>
      <select id="maxSize" class="w-full mt-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm">
        <option value="0">原尺寸</option><option value="512">512px</option><option value="768">768px</option>
      </select></div>
    <div><label class="text-xs text-slate-400">质量: <span id="qualityVal">85</span></label>
      <input type="range" id="quality" min="10" max="100" value="85" class="w-full mt-1"></div>
  </div>

  <!-- 开始按钮 -->
  <div id="startBtn" class="hidden text-center">
    <button onclick="startProcess()" class="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium">
      开始处理
    </button>
  </div>

  <!-- 进度条 -->
  <div id="progress" class="hidden space-y-2">
    <div class="flex justify-between text-sm">
      <span id="progressStage" class="text-blue-400"></span>
      <span id="progressMsg" class="text-slate-400"></span>
    </div>
    <div class="w-full bg-slate-700 rounded-full h-2">
      <div id="progressBar" class="bg-blue-500 h-2 rounded-full" style="width:0%"></div>
    </div>
  </div>

  <!-- 预览对比 -->
  <div id="preview" class="hidden grid grid-cols-2 gap-4">
    <div><p class="text-xs text-slate-400 mb-1 text-center">原始帧</p>
      <canvas id="origCanvas" class="w-full rounded-lg border border-slate-600"></canvas></div>
    <div><p class="text-xs text-slate-400 mb-1 text-center">去背景后</p>
      <canvas id="procCanvas" class="w-full rounded-lg border border-slate-600 checkerboard"></canvas></div>
  </div>

  <!-- 下载 -->
  <div id="download" class="hidden text-center space-x-3">
    <a id="downloadBtn" class="inline-block px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm">
      下载 WebP
    </a>
    <button onclick="resetAll()" class="px-6 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-sm">
      重新处理
    </button>
  </div>

</div>

<script>
// ---- 状态 ----
let state = { jobId: null, file: null };

// ---- DOM 引用 ----
const $ = id => document.getElementById(id);
const show = id => $(id).classList.remove('hidden');
const hide = id => $(id).classList.add('hidden');

// ---- 拖拽上传 ----
const dz = $('dropzone');
const fi = $('fileInput');

dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
dz.addEventListener('drop', e => {
  e.preventDefault(); dz.classList.remove('drag-over');
  handleFile(e.dataTransfer.files[0]);
});
dz.addEventListener('click', () => fi.click());
fi.addEventListener('change', e => handleFile(e.target.files[0]));

async function handleFile(f) {
  if (!f) return;
  if (!f.name.match(/\.(mov|mp4)$/i)) { alert('仅支持 MOV / MP4'); return; }

  const fd = new FormData();
  fd.append('video', f);
  const res = await fetch('/api/upload', { method: 'POST', body: fd });
  const data = await res.json();
  if (data.error) { alert(data.error); return; }

  state.jobId = data.job_id;
  state.file = f;

  $('fileInfo').textContent = `已选择: ${data.filename} (${(data.size/1024/1024).toFixed(1)}MB, ${data.width}x${data.height}, ${data.fps}fps)`;
  show('fileInfo'); show('settings'); show('startBtn');
  hide('progress'); hide('preview'); hide('download');

  // 提取首帧预览
  const video = document.createElement('video');
  video.preload = 'auto'; video.muted = true;
  video.src = URL.createObjectURL(f);
  await new Promise(r => { video.onloadedmetadata = r; });
  video.currentTime = 0;
  await new Promise(r => { video.onseeked = r; });
  const c = $('origCanvas'), ctx = c.getContext('2d');
  c.width = video.videoWidth; c.height = video.videoHeight;
  ctx.drawImage(video, 0, 0);
  show('preview');
  URL.revokeObjectURL(video.src);
}

// ---- 设置 ----
$('quality').addEventListener('input', e => {
  $('qualityVal').textContent = e.target.value;
});

// ---- 处理 ----
async function startProcess() {
  hide('startBtn');
  show('progress');

  const res = await fetch('/api/process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      job_id: state.jobId,
      bg_type: $('bgType').value,
      fps: parseInt($('fps').value),
      quality: parseInt($('quality').value),
    })
  });
  const data = await res.json();
  if (data.error) { alert(data.error); show('startBtn'); return; }

  // 轮询进度
  const poll = setInterval(async () => {
    const r = await fetch(`/api/progress/${state.jobId}`);
    const p = await r.json();
    $('progressStage').textContent = stageLabel(p.stage);
    $('progressMsg').textContent = p.message;
    const pct = p.total > 0 ? Math.round(p.current / p.total * 100) : 0;
    $('progressBar').style.width = pct + '%';

    if (p.stage === 'done') {
      clearInterval(poll);
      hide('progress');
      show('download');
      $('downloadBtn').href = `/api/download/${state.jobId}`;
      $('downloadBtn').download = 'output.webp';
    } else if (p.stage === 'error') {
      clearInterval(poll);
      alert('处理失败: ' + p.message);
      show('startBtn');
    }
  }, 500);
}

function stageLabel(s) {
  return { extracting:'提取帧', 'removing-bg':'AI 去背景', postprocess:'后处理', encoding:'合成 WebP', done:'完成', error:'出错' }[s] || s;
}

function resetAll() {
  state = { jobId: null, file: null };
  hide('fileInfo'); hide('settings'); hide('startBtn'); hide('progress'); hide('preview'); hide('download');
}
</script>
</body>
</html>
```

- [ ] **Step 2: 验证 UI 可访问**

```bash
cd desktop-app && python main.py
# 浏览器中应显示完整页面
```

- [ ] **Step 3: 提交**

```bash
git add desktop-app/templates/index.html
git commit -m "feat: 单页 UI — 拖拽上传、设置、进度、预览、下载"
```

---

### Task 5: 集成测试

**Files:** 无新文件，验证现有代码

- [ ] **Step 1: 启动应用，用实际视频测试**

```bash
cd desktop-app && python main.py
# 1. 上传 Assets/南博-莫卧儿艺术展-712x960.mov
# 2. 背景选「自动检测」
# 3. 点击「开始处理」
# 4. 观察进度和最终输出
```

- [ ] **Step 2: 对比 CLI vs GUI 输出**

```bash
# CLI 输出
ls -lh outputs/南博-莫卧儿艺术展-712x960.webp

# GUI 输出
ls -lh desktop-app/outputs/<job_id>/南博-莫卧儿艺术展-712x960.webp

# 两者文件大小应相近
```

- [ ] **Step 3: 提交最终调整**

---

### Task 6: PyInstaller 打包配置

**Files:**
- Create: `desktop-app/build_config.py` (PyInstaller spec 辅助)
- Create: `.github/workflows/build.yml` (CI/CD 构建)

- [ ] **Step 1: 写 PyInstaller 打包脚本 build.sh**

```bash
#!/bin/bash
# 跨平台打包脚本
# Mac: ./build.sh mac
# Win: ./build.sh win (需在 Windows 环境下运行)

PLATFORM="${1:-mac}"
APP_NAME="视频转透明WebP"
BIN_DIR="bin/mac"
if [ "$PLATFORM" = "win" ]; then BIN_DIR="bin/win"; fi

# 确保二进制文件存在
mkdir -p "bin/$PLATFORM"
if [ ! -f "$BIN_DIR/ffmpeg" ]; then
    echo "请将 ffmpeg/ffprobe/img2webp 放入 $BIN_DIR/"
    exit 1
fi

# PyInstaller 打包
pip install pyinstaller
python -m PyInstaller \
    --name="$APP_NAME" \
    --windowed \
    --add-data="templates:templates" \
    --add-data="$BIN_DIR:bin" \
    --add-data="../cleanup_black.py:." \
    --add-data="../cleanup_blue.py:." \
    --add-data="../despill.py:." \
    --add-data="../despill_blue.py:." \
    --add-data="../restore_alpha.py:." \
    --hidden-import=flask \
    --hidden-import=torch \
    --hidden-import=torchvision \
    --hidden-import=onnxruntime \
    --hidden-import=PIL \
    main.py

echo "打包完成: dist/$APP_NAME/"
```

- [ ] **Step 2: 写 GitHub Actions 工作流**

```yaml
# .github/workflows/build.yml
name: Build Desktop App

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  build-mac:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }

      - name: Install dependencies
        run: |
          brew install ffmpeg webp
          pip install flask backgroundremover Pillow pyinstaller

      - name: Ensure U2-Net model
        run: |
          mkdir -p ~/.u2net
          if [ ! -f ~/.u2net/u2net.pth ]; then
            curl -L https://github.com/nadermx/backgroundremover/raw/main/models/u2net.pth -o ~/.u2net/u2net.pth
          fi

      - name: Copy binaries
        run: |
          mkdir -p desktop-app/bin/mac
          cp $(which ffmpeg) $(which ffprobe) $(which img2webp) desktop-app/bin/mac/

      - name: Build
        run: cd desktop-app && bash build.sh mac

      - name: Package DMG
        run: |
          hdiutil create -volname "视频转透明WebP" -srcfolder desktop-app/dist/视频转透明WebP.app -ov -format UDZO "视频转透明WebP-mac.dmg"

      - uses: actions/upload-artifact@v4
        with: { name: mac-app, path: '*.dmg' }

  build-win:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }

      - name: Install dependencies
        run: |
          pip install flask backgroundremover Pillow pyinstaller

      - name: Download ffmpeg
        run: |
          Invoke-WebRequest -Uri "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile ffmpeg.zip
          Expand-Archive ffmpeg.zip -DestinationPath ffmpeg
          # Download libwebp tools
          Invoke-WebRequest -Uri "https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-1.3.2-windows-x64.zip" -OutFile webp.zip
          Expand-Archive webp.zip -DestinationPath webp

      - name: Copy binaries
        run: |
          mkdir desktop-app\bin\win
          copy ffmpeg\*\bin\ffmpeg.exe desktop-app\bin\win\
          copy ffmpeg\*\bin\ffprobe.exe desktop-app\bin\win\
          copy webp\*\bin\img2webp.exe desktop-app\bin\win\

      - name: Build
        run: cd desktop-app && bash build.sh win

      - uses: actions/upload-artifact@v4
        with: { name: win-app, path: 'desktop-app/dist/视频转透明WebP/' }
```

- [ ] **Step 3: 提交**

```bash
git add desktop-app/build.sh .github/workflows/build.yml
git commit -m "feat: PyInstaller 打包脚本 + GitHub Actions CI/CD 构建"
```

---

### 验证清单

- [ ] `python main.py` 启动无报错
- [ ] 浏览器自动打开 http://127.0.0.1:5566
- [ ] 上传 MOV/MP4 正确返回文件信息
- [ ] 上传非视频文件返回错误提示
- [ ] 选择不同背景类型、帧率可正常处理
- [ ] 进度条实时更新
- [ ] 处理完成后可下载 WebP
- [ ] WebP 文件可用浏览器/Safari 正常打开，透明区域正确
- [ ] 与 CLI 输出对比，文件大小和透明度一致
