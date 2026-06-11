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
EXE_NAME = 'Video2WebP'  # ASCII 文件名，避免 Windows 编码问题

SYSTEM = platform.system()


def download(url, dest):
    """下载文件"""
    print(f'  下载: {url}')
    urllib.request.urlretrieve(url, dest)


def setup_macos():
    """准备 macOS 二进制和模型"""
    bin_dir = HERE / 'bin' / 'mac'
    bin_dir.mkdir(parents=True, exist_ok=True)

    # 下载 ffmpeg/ffprobe 静态构建
    if not (bin_dir / 'ffmpeg').exists():
        print('下载 ffmpeg (macOS 静态构建)...')
        ffmpeg_url = 'https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip'
        download(ffmpeg_url, '/tmp/ffmpeg_mac.zip')
        with zipfile.ZipFile('/tmp/ffmpeg_mac.zip') as z:
            z.extract('ffmpeg', bin_dir)

    if not (bin_dir / 'ffprobe').exists():
        print('下载 ffprobe (macOS 静态构建)...')
        ffprobe_url = 'https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip'
        download(ffprobe_url, '/tmp/ffprobe_mac.zip')
        with zipfile.ZipFile('/tmp/ffprobe_mac.zip') as z:
            z.extract('ffprobe', bin_dir)

    for b in [bin_dir / 'ffmpeg', bin_dir / 'ffprobe']:
        b.chmod(0o755)


def setup_windows():
    """准备 Windows 二进制和模型"""
    bin_dir = HERE / 'bin' / 'win'
    bin_dir.mkdir(parents=True, exist_ok=True)

    if not (bin_dir / 'ffmpeg.exe').exists():
        print('下载 ffmpeg (Windows)...')
        ffmpeg_url = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
        download(ffmpeg_url, '/tmp/ffmpeg_win.zip')
        with zipfile.ZipFile('/tmp/ffmpeg_win.zip') as z:
            for name in z.namelist():
                if name.endswith('/ffmpeg.exe') or name.endswith('/ffprobe.exe'):
                    z.extract(name, '/tmp/ffmpeg_win_extract')
        # 复制 exe 到 bin/win/
        for root, _, files in os.walk('/tmp/ffmpeg_win_extract'):
            for f in files:
                if f in ('ffmpeg.exe', 'ffprobe.exe'):
                    shutil.copy(os.path.join(root, f), bin_dir / f)


def setup_model():
    """下载 U2-Net 模型"""
    model_path = HERE / 'u2net.pth'
    if not model_path.exists():
        print('下载 U2-Net 模型 (168MB)...')
        # 使用 backgroundremover 自带的模型
        subprocess.run([sys.executable, '-c',
            'from backgroundremover.bg import u2net; '
            'print("模型已通过 backgroundremover 下载")'
        ], check=True, timeout=120)
        # 模型会下载到 ~/.u2net/
        home_model = Path.home() / '.u2net' / 'u2net.pth'
        if home_model.exists():
            shutil.copy(home_model, model_path)


def run_build():
    """运行 PyInstaller 构建"""
    print(f'\n=== 构建 {APP_DISPLAY} ({SYSTEM}) ===\n')

    # 创建数据文件列表
    datas = [('gui.html', '.')]
    model = HERE / 'u2net.pth'
    if model.exists():
        datas.append((str(model), '.u2net'))
    scripts_dir = HERE / 'scripts'
    for s in scripts_dir.glob('*.py'):
        datas.append((str(s), 'scripts'))

    bin_platform = 'mac' if SYSTEM == 'Darwin' else 'win'
    bin_dir = HERE / 'bin' / bin_platform
    if bin_dir.exists():
        for b in bin_dir.iterdir():
            datas.append((str(b), f'bin/{bin_platform}'))

    # 生成 spec 内容
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
    spec_path = HERE / '_build.spec'
    spec_path.write_text(spec)

    # 运行 PyInstaller
    subprocess.run([
        sys.executable, '-m', 'PyInstaller',
        str(spec_path), '--noconfirm',
        '--distpath', str(DIST),
        '--workpath', str(HERE / 'build'),
    ], check=True)

    print(f'\n=== 构建完成 ===')
    if SYSTEM == 'Darwin':
        app_path = DIST / f'{APP_DISPLAY}.app'
        exe_path = DIST / EXE_NAME
        print(f'  .app: {app_path}')
        print(f'  可执行文件: {exe_path}')
    else:
        exe_path = DIST / f'{EXE_NAME}.exe'
        print(f'  .exe: {exe_path}')


if __name__ == '__main__':
    if SYSTEM == 'Darwin':
        setup_macos()
    elif SYSTEM == 'Windows':
        setup_windows()
    setup_model()
    run_build()
