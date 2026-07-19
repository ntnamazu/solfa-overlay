/** パース対象の OMR 成果物の種別 */
export type ScoreParseSource = 'musicxml' | 'sheet' | 'book';

/**
 * OMR 成果物（MusicXML / sheet XML / book.xml）のパース失敗
 *
 * 予期されるエラー: 機能設計書「エラーハンドリング」の「OMRの実行失敗」系として
 * 編成レイヤーが捕捉し、UI エラーに変換する（クラッシュさせない）
 */
export class ScoreParseError extends Error {
  constructor(
    message: string,
    public readonly source: ScoreParseSource,
  ) {
    super(message);
    this.name = 'ScoreParseError';
  }
}
