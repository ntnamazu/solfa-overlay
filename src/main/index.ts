import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, app, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc/channels';

// Linux コンテナ（devcontainer 等）では GPU が使えず、ウィンドウが白画面になる
// ことがあるため、開発実行時のみソフトウェアレンダリングに切り替える
// （app の ready 前に呼ぶ必要がある。--no-sandbox の付与は scripts/dev.mjs 側）
if (!app.isPackaged && process.platform === 'linux' && fs.existsSync('/.dockerenv')) {
  app.disableHardwareAcceleration();
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      // セキュリティ規約（開発ガイドライン）: この3点のハードニング設定は変更しない
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, '../preload/index.js'),
    },
  });

  // electron-vite が dev 時のみ Renderer の dev サーバURLを設定する
  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (rendererUrl !== undefined) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.appGetVersion, () => app.getVersion());
}

void app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    // macOS: Dockアイコンクリックでウィンドウがなければ再生成する（OS標準の挙動に合わせる）
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // macOS 以外はウィンドウを閉じたらアプリを終了する（OS標準の挙動に合わせる）
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
