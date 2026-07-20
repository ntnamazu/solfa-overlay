import { PDFDocument, degrees } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { buildPageInfos, pageInfoByIndex } from '../../../../src/domain/render/pageInfo';
import type { BookPageRef, PageGeometry } from '../../../../src/domain/score/OmrSheetParser';

/** 指定寸法・回転のページを持つ PDF を作る（実フィクスチャに元PDFが無いため合成する） */
async function makePdf(
  pages: { width: number; height: number; rotation?: number }[],
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (const page of pages) {
    const added = document.addPage([page.width, page.height]);
    if (page.rotation !== undefined) {
      added.setRotation(degrees(page.rotation));
    }
  }
  return document.save();
}

const geometryPage = (widthPx: number, heightPx: number, interlinePx = 17): PageGeometry => ({
  image: { widthPx, heightPx, interlinePx },
  symbols: [],
});

const bookPage = (sheetNumber: number, sourcePageNumber: number): BookPageRef => ({
  sheetNumber,
  pageIndexInSheet: 0,
  movementStart: false,
  sourcePageNumber,
});

describe('buildPageInfos', () => {
  it('Audiveris ページごとに元PDFページと画像寸法を対応づける', async () => {
    const pdf = await makePdf([{ width: 595.28, height: 841.89 }]);
    const result = await buildPageInfos(pdf, [geometryPage(2480, 3507)], [bookPage(1, 1)]);

    expect(result.issues).toEqual([]);
    expect(result.pages).toEqual([
      {
        pageIndex: 0,
        sourcePageIndex: 0,
        widthPt: 595.28,
        heightPt: 841.89,
        omrImageWidthPx: 2480,
        omrImageHeightPx: 3507,
        interlinePx: 17,
      },
    ]);
  });

  it('1 sheet が 2 ページに分かれても同じ元PDFページを指す（Victoria の実データ）', async () => {
    const pdf = await makePdf([
      { width: 595.28, height: 841.89 },
      { width: 595.28, height: 841.89 },
    ]);
    // sheet#1 が page 0・1 を含み、sheet#2 が page 2 になる
    const result = await buildPageInfos(
      pdf,
      [geometryPage(2480, 3507), geometryPage(2480, 3507), geometryPage(2480, 3507)],
      [
        { sheetNumber: 1, pageIndexInSheet: 0, movementStart: false, sourcePageNumber: 1 },
        { sheetNumber: 1, pageIndexInSheet: 1, movementStart: true, sourcePageNumber: 1 },
        bookPage(2, 2),
      ],
    );

    expect(result.pages.map((page) => page.sourcePageIndex)).toEqual([0, 0, 1]);
    expect(result.issues).toEqual([]);
  });

  it('回転 90 度のページは表示上の幅高さを入れ替える', async () => {
    const pdf = await makePdf([{ width: 595.28, height: 841.89, rotation: 90 }]);
    const result = await buildPageInfos(pdf, [geometryPage(3507, 2480)], [bookPage(1, 1)]);

    expect(result.pages[0]?.widthPt).toBeCloseTo(841.89, 6);
    expect(result.pages[0]?.heightPt).toBeCloseTo(595.28, 6);
  });

  it('回転 180 度では入れ替えない', async () => {
    const pdf = await makePdf([{ width: 595.28, height: 841.89, rotation: 180 }]);
    const result = await buildPageInfos(pdf, [geometryPage(2480, 3507)], [bookPage(1, 1)]);

    expect(result.pages[0]?.widthPt).toBeCloseTo(595.28, 6);
  });

  it('元PDFに参照先ページが無ければ issue にして該当ページを飛ばす（例外にしない）', async () => {
    const pdf = await makePdf([{ width: 595.28, height: 841.89 }]);
    const result = await buildPageInfos(
      pdf,
      [geometryPage(2480, 3507), geometryPage(2480, 3507)],
      [bookPage(1, 1), bookPage(2, 2)],
    );

    expect(result.pages.map((page) => page.pageIndex)).toEqual([0]);
    expect(result.issues).toEqual([
      { kind: 'sourcePageMissing', pageIndex: 1, sourcePageNumber: 2 },
    ]);
  });

  it('.omr に画像情報が無いページは sheetGeometryMissing にする', async () => {
    const pdf = await makePdf([{ width: 595.28, height: 841.89 }]);
    const result = await buildPageInfos(pdf, [{ image: null, symbols: [] }], [bookPage(1, 1)]);

    expect(result.pages).toEqual([]);
    expect(result.issues).toEqual([{ kind: 'sheetGeometryMissing', pageIndex: 0 }]);
  });

  it('画像寸法が 0 のページも sheetGeometryMissing にする（0 除算を下流へ渡さない）', async () => {
    const pdf = await makePdf([{ width: 595.28, height: 841.89 }]);
    const result = await buildPageInfos(pdf, [geometryPage(0, 3507)], [bookPage(1, 1)]);

    expect(result.pages).toEqual([]);
    expect(result.issues).toEqual([{ kind: 'sheetGeometryMissing', pageIndex: 0 }]);
  });

  it('book.xml のページ数が幾何より少なければ不足分を報告する', async () => {
    const pdf = await makePdf([{ width: 595.28, height: 841.89 }]);
    const result = await buildPageInfos(
      pdf,
      [geometryPage(2480, 3507), geometryPage(2480, 3507)],
      [bookPage(1, 1)],
    );

    expect(result.pages).toHaveLength(1);
    expect(result.issues).toEqual([{ kind: 'sheetGeometryMissing', pageIndex: 1 }]);
  });

  it('PDF として読めないバイト列でも例外にせず報告する（プロジェクトは開けるべき）', async () => {
    const result = await buildPageInfos(
      new Uint8Array([1, 2, 3]),
      [geometryPage(2480, 3507)],
      [bookPage(1, 1)],
    );

    expect(result.pages).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.kind).toBe('sourcePdfUnreadable');
  });
});

describe('pageInfoByIndex', () => {
  it('pageIndex で引ける表にする', async () => {
    const pdf = await makePdf([{ width: 100, height: 200 }]);
    const result = await buildPageInfos(pdf, [geometryPage(50, 100)], [bookPage(1, 1)]);
    const table = pageInfoByIndex(result.pages);

    expect(table.get(0)?.widthPt).toBe(100);
    expect(table.get(9)).toBeUndefined();
  });
});
