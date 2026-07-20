import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, app, dialog, ipcMain } from 'electron';
import { IPC_CHANNELS, IPC_EVENTS } from '../shared/ipc/channels';
import type { IpcContract } from '../shared/ipc/contract';
import type { OmrProgress } from '../shared/types/OmrProgress';
import { ProjectSession } from './ProjectSession';
import { createProjectHandlers } from './ipc/projectHandlers';

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
  const loading =
    rendererUrl !== undefined
      ? window.loadURL(rendererUrl)
      : window.loadFile(path.join(__dirname, '../renderer/index.html'));
  loading.catch((error: unknown) => {
    // 失敗を握りつぶすと無言の空ウィンドウだけが残るため必ずログに出す
    console.error('Renderer の読み込みに失敗しました:', error);
  });
}

/** IpcContract に無いチャネル名・合わない引数/戻り値の登録をコンパイルエラーにする */
function handleIpc<C extends keyof IpcContract>(
  channel: C,
  handler: (...args: Parameters<IpcContract[C]>) => ReturnType<IpcContract[C]>,
): void {
  ipcMain.handle(channel, (_event, ...args) => handler(...(args as Parameters<IpcContract[C]>)));
}

/** 進捗を全ウィンドウへ送る（ウィンドウは 1 枚想定だが、閉じられた後の送信で落ちないようにする） */
function broadcastProgress(progress: OmrProgress): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_EVENTS.omrProgress, progress);
    }
  }
}

/**
 * セッションはアプリで 1 つ（同時に開けるプロジェクトは 1 つという前提）
 *
 * モジュールスコープに置くのは、終了時に保留中の自動保存を書き切る必要があるため。
 * ハンドラ登録関数のローカルに閉じ込めると、`before-quit` から到達できない
 */
const session = new ProjectSession();

function registerIpcHandlers(): void {
  handleIpc(IPC_CHANNELS.appGetVersion, () => app.getVersion());

  const handlers = createProjectHandlers(session, broadcastProgress);

  handleIpc(IPC_CHANNELS.dialogOpenPdf, () => pickOpenPath({ name: 'PDF', extensions: ['pdf'] }));
  handleIpc(IPC_CHANNELS.dialogOpenProject, () =>
    pickOpenPath({ name: 'Solfa プロジェクト', extensions: ['solfaproj'] }),
  );
  handleIpc(IPC_CHANNELS.dialogSaveProject, async () => {
    const result = await dialog.showSaveDialog({
      filters: [{ name: 'Solfa プロジェクト', extensions: ['solfaproj'] }],
    });
    return result.canceled ? null : (result.filePath ?? null);
  });

  handleIpc(IPC_CHANNELS.projectImportPdf, (pdfPath) => handlers.importPdf(pdfPath));
  handleIpc(IPC_CHANNELS.projectOpen, (path) => handlers.open(path));
  handleIpc(IPC_CHANNELS.projectSave, (path) => handlers.save(path));
  handleIpc(IPC_CHANNELS.projectCancelOmr, () => handlers.cancelOmr());
  handleIpc(IPC_CHANNELS.projectSetStructureDecisions, (decisions) =>
    handlers.setStructureDecisions(decisions),
  );
  handleIpc(IPC_CHANNELS.projectSetClefCorrections, (corrections) =>
    handlers.setClefCorrections(corrections),
  );
  handleIpc(IPC_CHANNELS.projectSetKeyRegionDecisions, (decisions) =>
    handlers.setKeyRegionDecisions(decisions),
  );
  handleIpc(IPC_CHANNELS.projectSetSettings, (settings) => handlers.setSettings(settings));
  handleIpc(IPC_CHANNELS.projectCompleteConfirmation, () => handlers.completeConfirmation());
}

/** ファイル選択ダイアログを開き、選ばれたパスを返す（キャンセルなら null） */
async function pickOpenPath(filter: {
  name: string;
  extensions: string[];
}): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [filter],
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
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

/**
 * 終了前に保留中の自動保存を書き切る
 *
 * 自動保存は 300ms のデバウンスで予約され、タイマーは `unref` されている
 * （保存待ちで終了を引き延ばさないため）。この結線がないと、最後の訂正から
 * 300ms 以内にアプリを閉じただけで**その訂正が無言で消える**。
 * 永続化そのものが目的の機能なので、ここは終了を遅らせてでも書き切る
 */
let quitting = false;
app.on('before-quit', (event) => {
  if (quitting || !session.hasPendingSave) {
    return;
  }
  event.preventDefault();
  quitting = true;
  session
    .flushPendingSave()
    .catch((error: unknown) => {
      // 書けなくても終了は妨げない（ここで止めるとアプリが閉じられなくなる）
      console.error('終了前の保存に失敗しました:', error);
    })
    .finally(() => {
      app.quit();
    });
});

app.on('window-all-closed', () => {
  // macOS 以外はウィンドウを閉じたらアプリを終了する（OS標準の挙動に合わせる）
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
