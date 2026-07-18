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
      const prodCsp = `content="default-src 'self'"`;
      // 置換が無言で失敗すると dev でも厳格 CSP のままになり原因不明の白画面に
      // なるため、CSP meta タグの変更・整形で一致しなくなったら明示的に落とす
      if (!html.includes(prodCsp)) {
        throw new Error(
          `relaxCspForDev: index.html に ${prodCsp} が見つかりません。` +
            'CSP meta タグの変更に合わせてこのプラグインも更新してください',
        );
      }
      return html.replace(prodCsp, `content="${devCsp}"`);
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
