import type { PageAnchor } from './ScoreModel';

/**
 * 注釈（出力PDFに描画される単位。機能設計書「データモデル定義」）
 *
 * 生成・編集は AnnotationManager（Phase 5）の担当だが、**注釈レイヤーは楽譜認識結果から
 * 分離して永続化する**という設計原則のため、プロジェクトファイルのスキーマには
 * 先行して含めておく（後から足すとスキーマ版数の増分が必要になる）
 */
export interface Annotation {
  id: string;
  /** 'chordRole' は v2（和音役割レイヤー）で使う */
  layer: 'solfa' | 'chordRole';
  /**
   * 描画位置（衝突回避で調整後の位置）
   *
   * 座標は `.omr` の 300dpi 画像ピクセルで、**文字列の左端＋ベースライン**を指す
   * （pdf-lib の `drawText` が取る基準に合わせてある。中心や左上にすると、
   * 描画時に毎回オフセットを足し引きすることになり食い違いの温床になる）。
   * `pageIndex` は Audiveris のページ添字であり元PDFのページ番号ではない（`PageInfo` を参照）
   */
  anchor: PageAnchor;
  /** 自動生成注釈は元音符を参照する。手動追加は null */
  noteId: string | null;
  /** 手動上書き文字列。null なら音符の solfa から導出する */
  text: string | null;
  origin: 'auto' | 'manual';
  /** 自動生成注釈の非表示化（再生成しても復活させない） */
  deleted: boolean;
}
