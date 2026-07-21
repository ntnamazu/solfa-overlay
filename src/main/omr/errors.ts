/**
 * OmrRunner 系の予期されるエラー
 *
 * 機能設計書「エラーハンドリング」の方針: OMR 実行や成果物展開の失敗は例外で全体を
 * 落とさず、上位（IPC ハンドラ, 別フェーズ）が捕捉して UI エラーへ変換できる型にする。
 */

/** Audiveris の起動・実行・出力収集の失敗 */
export class OmrRunError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'OmrRunError';
  }
}

/**
 * Audiveris 実行ファイルが見つからない（spawn の ENOENT）
 *
 * 「エンジン未搭載」は他の実行時失敗と原因も対処も異なる（インストール／パス設定で直る）ため、
 * 汎用の実行エラーと区別して行動可能なメッセージを載せる。`OmrRunError` を継承するので、
 * IPC 変換（`toIpcError` の `instanceof OmrRunError`）は変更不要で `kind:'omr'` に乗る。
 */
export class AudiverisNotFoundError extends OmrRunError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AudiverisNotFoundError';
  }
}

/** `.omr` / `.mxl`（zip）の展開失敗・パストラバーサル・必須エントリ欠落 */
export class OmrArchiveError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'OmrArchiveError';
  }
}
