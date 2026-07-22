import { join } from 'node:path';

/**
 * 同梱 Audiveris 実行ファイルの絶対パスを解決する（副作用なしの純粋関数）
 *
 * 配布版（`app.isPackaged`）では electron-builder の `extraResources` が
 * `resources/audiveris/win/` を `process.resourcesPath/audiveris/win/` へ配置する。
 * そのランチャ（`Audiveris.exe`）の絶対パスを返し、`OmrRunner` の `audiverisPath` に渡す。
 *
 * 開発時（非パッケージ）は `undefined` を返し、`OmrRunner` の既定の解決チェーン
 * （環境変数 `SOLFA_AUDIVERIS_PATH` → PATH の `audiveris`）に委ねる。ここで固定パスを
 * 返すと devcontainer 同梱（PATH 解決）や自前調達（環境変数）の開発ルートを塞いでしまう。
 *
 * Electron を import しない（`node:path` のみ）ため、Electron を起動せずに単体テストできる。
 *
 * @param opts.isPackaged - `app.isPackaged`（配布パッケージとして実行中か）
 * @param opts.resourcesPath - `process.resourcesPath`（同梱リソースの配置先）
 * @param opts.platform - `process.platform`（配布ターゲットの判定に使う）
 * @returns 同梱ランチャの絶対パス。開発時・配布対象外 OS では `undefined`
 */
export function resolveBundledAudiverisPath(opts: {
  isPackaged: boolean;
  resourcesPath: string;
  platform: NodeJS.Platform;
}): string | undefined {
  if (!opts.isPackaged) {
    return undefined;
  }
  // 本フェーズの配布対象は Windows のみ（mac/linux の配布ビルドはスコープ外）。
  // 将来 OS を増やすときは、ここに platform 分岐と対応する resources 配置を追加する。
  if (opts.platform === 'win32') {
    return join(opts.resourcesPath, 'audiveris', 'win', 'Audiveris.exe');
  }
  return undefined;
}
