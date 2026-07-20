import { PDFDocument } from 'pdf-lib';
import type { BookPageRef, PageGeometry } from '../score/OmrSheetParser';
import type { PageInfoIssue } from '../../shared/types/Issues';
import type { PageInfo } from '../../shared/types/Project';

/**
 * Audiveris のページと元PDF のページを対応づけ、座標変換に必要な寸法を確定させる
 *
 * **Audiveris のページ添字は元PDF のページ番号ではない。** Audiveris は 1 枚の sheet
 * （＝元PDFの1ページ）の中で movement 境界を検出すると page を分割するため、
 * Victoria フィクスチャは 3 ページの PDF に対し 4 つの Audiveris ページを持つ。
 * これを取り違えると 2 ページ目以降の注釈が丸ごと別のページへ描かれる。
 *
 * ファイルは読まない（domain の純粋性維持）。バイト列は編成レイヤーが渡す。
 */

/**
 * ページ寸法を確定できなかったページの報告（例外にせず部分結果と共に返す）
 *
 * 型の実体は `shared/types/Issues.ts`（Editor へ IPC 越しに送る表示用データのため）
 */
export type { PageInfoIssue };

export interface PageInfoResult {
  /** 対応が取れたページのみ。`pageIndex` 昇順 */
  pages: PageInfo[];
  issues: PageInfoIssue[];
}

/** PDF のページ回転を考慮した表示上の寸法 */
function displaySize(width: number, height: number, rotationDegrees: number): [number, number] {
  // /Rotate は 90 の倍数。90・270 では表示上の縦横が入れ替わる。
  // getSize() は回転前の MediaBox を返すため、そのまま使うと横向きスキャンで
  // 縦横が逆のスケールを掛けてしまう
  const normalized = ((rotationDegrees % 360) + 360) % 360;
  return normalized === 90 || normalized === 270 ? [height, width] : [width, height];
}

/**
 * `PageInfo` を組み立てる
 *
 * @param sourcePdf - 元PDF のバイト列
 * @param geometry - `.omr` 由来のページ幾何（`bookPages` と同じページ順・同じ長さ）
 * @param bookPages - book.xml のページ参照（元PDFページ番号を持つ）
 */
export async function buildPageInfos(
  sourcePdf: Uint8Array,
  geometry: readonly PageGeometry[],
  bookPages: readonly BookPageRef[],
): Promise<PageInfoResult> {
  const pages: PageInfo[] = [];
  const issues: PageInfoIssue[] = [];

  let pdfPages: ReturnType<PDFDocument['getPages']>;
  try {
    pdfPages = (await PDFDocument.load(sourcePdf)).getPages();
  } catch (cause) {
    // 読めなくても**プロジェクトを開けなくはしない**。確認画面で積み上げた判断は
    // プロジェクトファイルに残っており、それを見られなくする理由がない。
    // PDF 出力の時点で失敗させれば、ユーザーには十分早く伝わる
    return {
      pages: [],
      issues: [
        { kind: 'sourcePdfUnreadable', message: cause instanceof Error ? cause.message : '不明' },
      ],
    };
  }

  // 幾何と book.xml の両方が揃ったページだけ対応づけられる。どちらかにしか存在しない
  // 末尾ページも取りこぼさず報告できるよう、長い方（和集合）まで走査し、片方が欠けた
  // ページは「寸法を確定できなかったページ」として issue にする
  const count = Math.max(geometry.length, bookPages.length);
  for (let pageIndex = 0; pageIndex < count; pageIndex += 1) {
    const bookPage = bookPages[pageIndex];
    const image = geometry[pageIndex]?.image ?? null;
    if (bookPage === undefined || image === null) {
      issues.push({ kind: 'sheetGeometryMissing', pageIndex });
      continue;
    }
    const sourcePageIndex = bookPage.sourcePageNumber - 1;
    const pdfPage = pdfPages[sourcePageIndex];
    if (pdfPage === undefined) {
      issues.push({
        kind: 'sourcePageMissing',
        pageIndex,
        sourcePageNumber: bookPage.sourcePageNumber,
      });
      continue;
    }
    const [widthPt, heightPt] = displaySize(
      pdfPage.getWidth(),
      pdfPage.getHeight(),
      pdfPage.getRotation().angle,
    );
    if (image.widthPx <= 0 || image.heightPx <= 0 || widthPt <= 0 || heightPt <= 0) {
      // ここを通すと縮尺が 0 除算になる。`coordinateTransform.isTransformable` と同じ判定
      issues.push({ kind: 'sheetGeometryMissing', pageIndex });
      continue;
    }
    pages.push({
      pageIndex,
      sourcePageIndex,
      widthPt,
      heightPt,
      omrImageWidthPx: image.widthPx,
      omrImageHeightPx: image.heightPx,
      interlinePx: image.interlinePx,
    });
  }

  return { pages, issues };
}

/** `pageIndex` で引ける形に直す（描画・配置の両方が使う） */
export function pageInfoByIndex(pages: readonly PageInfo[]): Map<number, PageInfo> {
  return new Map(pages.map((page) => [page.pageIndex, page]));
}
