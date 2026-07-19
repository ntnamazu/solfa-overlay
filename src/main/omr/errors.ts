/**
 * OmrRunner 系の予期されるエラー
 *
 * 機能設計書「エラーハンドリング」の方針: OMR 実行や成果物展開の失敗は例外で全体を
 * 落とさず、上位（IPC ハンドラ, 別フェーズ）が捕捉して UI エラーへ変換できる型にする。
 */

/** Audiveris の起動・実行・出力収集の失敗 */
export class OmrRunError extends Error {
  constructor(
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'OmrRunError';
  }
}

/** `.omr` / `.mxl`（zip）の展開失敗・パストラバーサル・必須エントリ欠落 */
export class OmrArchiveError extends Error {
  constructor(
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'OmrArchiveError';
  }
}
