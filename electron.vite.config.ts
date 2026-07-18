import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

/**
 * 開発サーバ実行時のみ CSP を緩和する
 *
 * default-src 'self' のままだと、@vitejs/plugin-react が HMR 用に注入する
 * インラインスクリプトと Vite の HMR WebSocket がブロックされ、白画面になる。
 * apply: 'serve' により本番ビルド（electron-vite build）には適用されず、
 * index.html の default-src 'self' がそのまま残る（開発ガイドラインの CSP 要件を維持）
 */
function relaxCspForDev(): Plugin {
  const devCsp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self' ws://localhost:*",
  ].join('; ');
  return {
    name: 'relax-csp-for-dev',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(`content="default-src 'self'"`, `content="${devCsp}"`);
    },
  };
}

export default defineConfig({
  main: {},
  // sandbox: true の preload は ESM を読み込めないため CJS 出力（既定）を維持する
  preload: {},
  renderer: {
    plugins: [react(), relaxCspForDev()],
  },
});
