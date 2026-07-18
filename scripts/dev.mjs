// 開発起動ラッパー: Linux コンテナ（devcontainer 等）では Docker の既定 seccomp により
// Chromium のサンドボックス（SUID / user namespace）を構成できず、Electron が起動時に
// FATAL で落ちるため、コンテナ内でのみ --noSandbox を付与して electron-vite dev を起動する。
//
// この方式にした理由（検証済み）:
// - 環境変数 ELECTRON_DISABLE_SANDBOX は devcontainer.json（containerEnv/remoteEnv）でも
//   Dockerfile の ENV でも、VS Code のターミナルへ伝播しなかった
// - app.commandLine.appendSwitch('no-sandbox') は Main の JS 実行より前に走る
//   サンドボックス検査に間に合わない
// - 起動コマンドラインで渡す本方式のみが確実に機能した
//
// アプリ本体の webPreferences.sandbox: true（Renderer の隔離）とは別物であり、
// 配布ビルドには影響しない。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const args = ['dev', ...process.argv.slice(2)];

const isLinuxContainer = process.platform === 'linux' && existsSync('/.dockerenv');
if (isLinuxContainer) {
  args.push('--noSandbox');

  // WSLg + devcontainer では X11 転送（XWayland）経由だと Chromium の起動が
  // デッドロックする（whenReady が永遠に解決しない）ため、Wayland ソケットが
  // 転送されていれば Wayland を明示する。appendSwitch ではプラットフォーム
  // 初期化に間に合わないため、コマンドライン（`--` 以降は ELECTRON_CLI_ARGS
  // として Electron に渡る）で指定する必要がある。
  if (process.env.WAYLAND_DISPLAY !== undefined) {
    args.push('--', '--ozone-platform=wayland');
  } else {
    console.warn(
      '[dev] WAYLAND_DISPLAY が見つかりません。コンテナ内の X11 経由の起動には ' +
        'ウィンドウが表示されないままハングする既知の問題があるため、起動しない場合は ' +
        'Wayland ソケットの転送（WSLg 等）を確認してください。',
    );
  }
}

// npm scripts 経由の実行では node_modules/.bin が PATH に載っている
const child = spawn('electron-vite', args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
