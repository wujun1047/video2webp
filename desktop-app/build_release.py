"""CI 构建脚本 — 下载二进制依赖并运行 PyInstaller 打包"""
import os
import sys
import platform
import subprocess
import urllib.request
import zipfile
import shutil
from pathlib import Path

HERE = Path(__file__).parent
DIST = HERE / 'dist'
APP_DISPLAY = '视频转透明WebP'
EXE_NAME = 'Video2WebP'

SYSTEM = platform.system()

# Windows 上 /tmp 不存在，用 TEMP 环境变量
if SYSTEM == 'Windows':
    TEMP = Path(os.environ.get('TEMP', os.environ.get('TMP', '.')))
else:
    TEMP = Path('/tmp')


def download(url, dest):
    print(f'  下载: {url}')
    urllib.request.urlretrieve(url, dest)


def setup_macos():
    bin_dir = HERE / 'bin' / 'mac'
    bin_dir.mkdir(parents=True, exist_ok=True)

    if not (bin_dir / 'ffmpeg').exists():
        print('下载 ffmpeg (macOS)...')
        path = str(TEMP / 'ffmpeg_mac.zip')
        download('https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip', path)
        with zipfile.ZipFile(path) as z:
            z.extract('ffmpeg', bin_dir)
        (bin_dir / 'ffmpeg').chmod(0o755)

    if not (bin_dir / 'ffprobe').exists():
        print('下载 ffprobe (macOS)...')
        path = str(TEMP / 'ffprobe_mac.zip')
        download('https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip', path)
        with zipfile.ZipFile(path) as z:
            z.extract('ffprobe', bin_dir)
        (bin_dir / 'ffprobe').chmod(0o755)


def setup_windows():
    bin_dir = HERE / 'bin' / 'win'
    bin_dir.mkdir(parents=True, exist_ok=True)

    if not (bin_dir / 'ffmpeg.exe').exists():
        print('下载 ffmpeg (Windows)...')
        path = str(TEMP / 'ffmpeg_win.zip')
        extract_dir = str(TEMP / 'ffmpeg_win_extract')
        download('https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip', path)
        with zipfile.ZipFile(path) as z:
            z.extractall(extract_dir)
        # 找到 bin 目录中的 exe
        for root, _, files in os.walk(extract_dir):
            for f in files:
                if f in ('ffmpeg.exe', 'ffprobe.exe'):
                    shutil.copy(os.path.join(root, f), bin_dir / f)


def setup_model():
    model_path = HERE / 'u2net.pth'
    if not model_path.exists():
        print('下载 U2-Net 模型 (168MB)...')
        subprocess.run([sys.executable, '-c',
            'from backgroundremover.bg import u2net; '
            'print("模型已下载")'
        ], check=True, timeout=120)
        home_model = Path.home() / '.u2net' / 'u2net.pth'
        if home_model.exists():
            shutil.copy(home_model, model_path)


def run_build():
    print(f'\n=== 构建 {APP_DISPLAY} ({SYSTEM}) ===\n')

    datas = [('gui.html', '.')]
    model = HERE / 'u2net.pth'
    if model.exists():
        datas.append((str(model), '.u2net'))
    for s in (HERE / 'scripts').glob('*.py'):
        datas.append((str(s), 'scripts'))
    bin_platform = 'mac' if SYSTEM == 'Darwin' else 'win'
    bin_dir = HERE / 'bin' / bin_platform
    if bin_dir.exists():
        for b in bin_dir.iterdir():
            datas.append((str(b), f'bin/{bin_platform}'))

    spec = f'''# -*- mode: python -*-
import sys
a = Analysis(['gui.py'], pathex=['{HERE}'], binaries=[], datas={datas},
    hiddenimports=['torch','torchvision','onnxruntime','onnxruntime.capi',
        'PIL','PIL.Image','PIL.WebPImagePlugin','numpy','cv2','scipy',
        'skimage','skimage.transform','pymatting',
        'webview','webview.platforms.cocoa','webview.platforms.winforms',
        'clr'],
    excludes=['tkinter','matplotlib','pandas','tensorflow','jupyter','IPython'])
pyz = PYZ(a.pure, a.zipped_data)
exe = EXE(pyz, a.scripts, a.binaries, a.zipfiles, a.datas, [],
    name='{EXE_NAME}', debug=False, strip=False, upx=True, console=False)
if sys.platform == 'darwin':
    app = BUNDLE(exe, name='{APP_DISPLAY}.app',
        bundle_identifier='com.video2webp.app',
        info_plist={{'CFBundleName':'{APP_DISPLAY}','CFBundleDisplayName':'{APP_DISPLAY}',
            'CFBundleShortVersionString':'1.0.0','CFBundleVersion':'1.0.0',
            'NSHighResolutionCapable':True}})
'''
    (HERE / '_build.spec').write_text(spec)

    subprocess.run([
        sys.executable, '-m', 'PyInstaller',
        '--noconfirm', '--distpath', str(DIST),
        '--workpath', str(HERE / 'build'),
        str(HERE / '_build.spec'),
    ], check=True)

    print(f'\n=== 构建完成 ===')
    if SYSTEM == 'Darwin':
        print(f'  .app: {DIST / f"{APP_DISPLAY}.app"}')
    else:
        print(f'  .exe: {DIST / f"{EXE_NAME}.exe"}')


if __name__ == '__main__':
    if SYSTEM == 'Darwin':
        setup_macos()
    elif SYSTEM == 'Windows':
        setup_windows()
    setup_model()
    run_build()
