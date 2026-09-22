import { createReadStream, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
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

/**
 * PDF.js が実行時に読む資産（公開パス → pdfjs-dist 内のディレクトリ）
 *
 * - `wasm/`: スキャン楽譜に多い JBIG2 / JPEG2000 のデコーダ（wasm と、失敗時に使う JS 版）。
 *   pdfjs v6 はこれを `wasmUrl` から読むため、無いとスキャンPDFの画像が描けない
 * - `standard_fonts/`: PDF に埋め込まれていない標準フォントの代替字形
 */
const PDFJS_ASSET_DIRS = { wasm: 'wasm', standard_fonts: 'standard_fonts' } as const;

/**
 * 配らないファイル
 *
 * - `quickjs-eval.*`: PDF に埋め込まれた JavaScript を実行するためのもの。楽譜の表示に不要で、
 *   実行経路を増やさない（開発ガイドライン「セキュリティ規約」）
 * - `LiberationSans-*`: GPLv2（フォント例外付き）で、配布には対応ソースの提供条件が付く。
 *   埋め込みのない Helvetica / Arial の代替字形にしか使われないため同梱せず、
 *   OS のフォントで代替する（`pdfDocument.ts` の `useSystemFonts`）
 */
const PDFJS_EXCLUDED = /^(quickjs-eval\.|LiberationSans-|LICENSE_LIBERATION$)/;

const PDFJS_CONTENT_TYPES: Record<string, string> = {
  '.wasm': 'application/wasm',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
};

/** `pdfjs/<dir>/<file>` の一覧（公開パスと実体のパス） */
function listPdfjsAssets(): { publicPath: string; filePath: string }[] {
  const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  return Object.entries(PDFJS_ASSET_DIRS).flatMap(([publicDir, sourceDir]) =>
    readdirSync(join(root, sourceDir))
      .filter((name) => !PDFJS_EXCLUDED.test(name))
      .map((name) => ({
        publicPath: `pdfjs/${publicDir}/${name}`,
        filePath: join(root, sourceDir, name),
      })),
  );
}

/**
 * PDF.js の実行時資産を Renderer と同じオリジンから配る
 *
 * CSP が `default-src 'self'` のため、資産は同一オリジンに置くしかない。
 * **リポジトリへは複製しない**（upstream のライセンス表記付きのファイルをそのまま配り、
 * pdfjs-dist の更新への追従漏れを防ぐ）。build では出力へ書き出し、dev サーバでは同じパスで返す
 */
function servePdfjsAssets(): Plugin {
  return {
    name: 'serve-pdfjs-assets',
    configureServer(server) {
      const assets = new Map(listPdfjsAssets().map((asset) => [`/${asset.publicPath}`, asset]));
      server.middlewares.use((request, response, next) => {
        const asset = assets.get((request.url ?? '').split('?')[0] ?? '');
        if (asset === undefined) {
          next();
          return;
        }
        response.setHeader(
          'Content-Type',
          PDFJS_CONTENT_TYPES[extname(asset.filePath)] ?? 'application/octet-stream',
        );
        createReadStream(asset.filePath).pipe(response);
      });
    },
    generateBundle() {
      for (const asset of listPdfjsAssets()) {
        this.emitFile({
          type: 'asset',
          fileName: asset.publicPath,
          source: readFileSync(asset.filePath),
        });
      }
    },
  };
}

export default defineConfig({
  main: {},
  // sandbox: true の preload は ESM を読み込めないため CJS 出力（既定）を維持する
  preload: {},
  renderer: {
    plugins: [react(), relaxCspForDev(), servePdfjsAssets()],
  },
});
