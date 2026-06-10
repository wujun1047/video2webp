/**
 * Electron 主进程
 * 加载 Vite 构建的 Web 应用，提供桌面窗口体验
 */

const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');

// 判断是否为开发模式
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 800,
    minWidth: 600,
    minHeight: 500,
    title: '视频转透明 WebP',
    backgroundColor: '#0f172a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (isDev) {
    // 开发模式：加载 Vite dev server
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // 生产模式：加载构建后的文件
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // 关闭窗口前确认（防止误关导致处理中断）
  mainWindow.on('close', async (e) => {
    // 检查是否有正在进行的处理
    const hasUnsavedWork = await mainWindow.webContents.executeJavaScript(
      'window.__isProcessing || false',
    ).catch(() => false);

    if (hasUnsavedWork) {
      e.preventDefault();
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: '处理尚未完成',
        message: '视频转码正在进行中，关闭窗口将丢失进度。确定要退出吗？',
        buttons: ['继续等待', '强制退出'],
        defaultId: 0,
        cancelId: 0,
      });

      if (response === 1) {
        mainWindow.destroy();
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 设置 COOP/COEP 头（ffmpeg.wasm 需要 SharedArrayBuffer）
if (!isDev) {
  app.whenReady().then(() => {
    const { session } = require('electron');

    // 使用自定义协议处理器添加 Cross-Origin 头
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Cross-Origin-Opener-Policy': ['same-origin'],
          'Cross-Origin-Embedder-Policy': ['require-corp'],
        },
      });
    });
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
