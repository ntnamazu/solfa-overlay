import type { PageInfo } from '../../shared/types/Project';
import type { PageAnchor } from '../../shared/types/ScoreModel';

/**
 * `.omr` の画像ピクセル座標と PDF ポイント座標の相互変換（機能設計書「座標系は2本立て」）
 *
 * 2 つの座標系は原点も向きも違う:
 *
 * - `.omr`: 左上原点・y 下向き・300dpi 画像ピクセル
 * - PDF: **左下原点**・y 上向き・ポイント（1/72 インチ）
 *
 * この差の吸収を 1 か所に閉じ込め、呼び出し側が毎回 y を反転し忘れる事故を防ぐ。
 */

/** PDF 上の描画位置（左下原点・ポイント） */
export interface PdfPoint {
  /** 元PDF のページ添字（0始まり）。`PageAnchor.pageIndex` とは別物 */
  sourcePageIndex: number;
  x: number;
  y: number;
}

/**
 * 変換が成立するページか
 *
 * 画像寸法が 0 以下だとスケールが定義できず、素通しすると `Infinity` / `NaN` の座標を
 * 描画に渡してしまう。**呼び出し側が「幾何情報なし」として報告できるよう false を返す**
 * （`buildPageInfos` も同じ条件で issue にしており、2 経路で反応を揃えてある）
 */
export function isTransformable(page: PageInfo): boolean {
  return (
    page.omrImageWidthPx > 0 &&
    page.omrImageHeightPx > 0 &&
    page.widthPt > 0 &&
    page.heightPt > 0 &&
    Number.isFinite(page.omrImageWidthPx) &&
    Number.isFinite(page.omrImageHeightPx) &&
    Number.isFinite(page.widthPt) &&
    Number.isFinite(page.heightPt)
  );
}

/**
 * 1 ポイントあたりの画像ピクセル数（**横方向**の縮尺）
 *
 * フォントサイズ（pt）を配置計算のための px へ直すのに使う。縦横で縮尺が違い得るが、
 * 文字の大きさは 1 つの値でしか指定できないため、文字幅と同じ横方向に合わせる
 *
 * @returns 変換できないページでは null
 */
export function pxPerPt(page: PageInfo): number | null {
  return isTransformable(page) ? page.omrImageWidthPx / page.widthPt : null;
}

/** 表示座標を MediaBox 座標へ直した結果と、テキストへ掛ける回転角（CCW 度） */
export interface MediaBoxPoint {
  x: number;
  y: number;
  /** pdf-lib の `degrees()` へ渡す反時計回りの角度。0/90/180/270 */
  rotateDegrees: number;
}

/**
 * 表示（回転適用後）座標を MediaBox（未回転）座標へ変換する
 *
 * pdf-lib の `drawText` は `/Rotate` を無視して未回転の MediaBox 座標空間へ描くため、
 * 回転ページでは表示上の座標で描くと版面からずれ、字も傾く。ビューアが CW に `/Rotate`
 * 度回すことを見越し、描画位置を MediaBox 座標へ移し、テキストを同角だけ CCW に回して
 * 表示上は正立させる。回転 0 のページ（実フィクスチャ・通常ケース）では素通しになる。
 *
 * @param mediaWidthPt - MediaBox の幅（`PDFPage.getWidth()`。未回転）
 * @param mediaHeightPt - MediaBox の高さ（`PDFPage.getHeight()`。未回転）
 * @param rotationDegrees - ページの `/Rotate`（時計回り）
 * @param x - 表示座標の x（左下原点・ポイント）
 * @param y - 表示座標の y（左下原点・ポイント）
 */
export function toMediaBoxPoint(
  mediaWidthPt: number,
  mediaHeightPt: number,
  rotationDegrees: number,
  x: number,
  y: number,
): MediaBoxPoint {
  const normalized = ((rotationDegrees % 360) + 360) % 360;
  switch (normalized) {
    case 90:
      return { x: mediaWidthPt - y, y: x, rotateDegrees: 90 };
    case 180:
      return { x: mediaWidthPt - x, y: mediaHeightPt - y, rotateDegrees: 180 };
    case 270:
      return { x: y, y: mediaHeightPt - x, rotateDegrees: 270 };
    default:
      return { x, y, rotateDegrees: 0 };
  }
}

/**
 * `.omr` の画像座標を PDF の描画座標へ変換する
 *
 * 縦横のスケールは**別々に**求める。元PDF のページと Audiveris がラスタライズした画像の
 * アスペクト比が一致する保証がないため（実測でも divisi のページは A4 ではない）
 *
 * @returns 変換できないページでは null
 */
export function toPdfPoint(page: PageInfo, anchor: PageAnchor): PdfPoint | null {
  if (!isTransformable(page)) {
    return null;
  }
  const scaleX = page.widthPt / page.omrImageWidthPx;
  const scaleY = page.heightPt / page.omrImageHeightPx;
  return {
    sourcePageIndex: page.sourcePageIndex,
    x: anchor.x * scaleX,
    // 画像の上端（y=0）が PDF のページ上端（y=heightPt）にあたる
    y: page.heightPt - anchor.y * scaleY,
  };
}
