import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AnnotationRun } from './realFixtureHelpers';
import { makeSourcePdf, runAnnotations, runFixture, runSolfa } from './realFixtureHelpers';

/**
 * 実データでの注釈生成と配置の回帰（Phase 5）
 *
 * 着手前に `tmp/probe` で計測した値をそのまま期待値にしている。特に
 * 「符幹・加線を障害物にしない」判断は配置品質を大きく変えるため、
 * **基本位置の採用率**を固定して、将来の変更で静かに劣化しないようにする。
 */

const read = (path: string): Uint8Array => new Uint8Array(readFileSync(path));

/** 元PDF の代わり（`.omr` の画像寸法を 300dpi として逆算した空PDF） */
const VICTORIA_IMAGE: [number, number] = [2480, 3507];
const DIVISI_IMAGE: [number, number] = [2408, 3150];

interface Case {
  run: AnnotationRun;
  noteCount: number;
}

let victoria: Case;
let divisi: Case;

beforeAll(async () => {
  const victoriaOmr = read('tests/fixtures/victoria/IMSLP19716.omr');
  const victoriaSolfa = runSolfa(
    runFixture(victoriaOmr, [
      read('tests/fixtures/victoria/IMSLP19716.mvt1.mxl'),
      read('tests/fixtures/victoria/IMSLP19716.mvt2.mxl'),
    ]),
  );
  victoria = {
    // Victoria は 3 sheet に 4 Audiveris ページ（元PDF は 3 ページ）
    run: await runAnnotations(victoriaOmr, victoriaSolfa, await makeSourcePdf(3, VICTORIA_IMAGE)),
    noteCount: victoriaSolfa.degreeCount,
  };

  const divisiOmr = read('tests/fixtures/divisi/IMSLP175782.omr');
  const divisiSolfa = runSolfa(
    runFixture(divisiOmr, [read('tests/fixtures/divisi/IMSLP175782.mxl')]),
  );
  divisi = {
    run: await runAnnotations(divisiOmr, divisiSolfa, await makeSourcePdf(20, DIVISI_IMAGE)),
    noteCount: divisiSolfa.degreeCount,
  };
}, 120_000);

/** 注釈の描画矩形どうしが重なっていないか（同一ページ内） */
function overlappingPairs(run: AnnotationRun): number {
  const byPage = new Map<number, { x: number; y: number }[]>();
  for (const annotation of run.annotations) {
    const bucket = byPage.get(annotation.anchor.pageIndex) ?? [];
    bucket.push({ x: annotation.anchor.x, y: annotation.anchor.y });
    byPage.set(annotation.anchor.pageIndex, bucket);
  }
  let pairs = 0;
  for (const points of byPage.values()) {
    // 同じ座標に 2 つ以上の注釈が乗っていれば、確実に重なっている
    const seen = new Set<string>();
    for (const point of points) {
      const key = `${point.x.toFixed(3)},${point.y.toFixed(3)}`;
      if (seen.has(key)) {
        pairs += 1;
      }
      seen.add(key);
    }
  }
  return pairs;
}

describe('注釈生成（Victoria）', () => {
  it('階名を得た音符すべてに注釈が付く', () => {
    expect(victoria.noteCount).toBe(808);
    expect(victoria.run.annotations).toHaveLength(808);
  });

  it('全ての注釈が配置を解決できる', () => {
    expect(victoria.run.unresolved).toBe(0);
  });

  it('ページ寸法が 4 ページぶん確定し、問題が出ない', () => {
    expect(victoria.run.pages).toHaveLength(4);
    expect(victoria.run.pageIssues).toEqual([]);
  });

  it('注釈どうしが同じ位置に重ならない', () => {
    expect(overlappingPairs(victoria.run)).toBe(0);
  });
});

describe('注釈生成（divisi）', () => {
  it('階名を得た音符すべてに注釈が付く', () => {
    expect(divisi.noteCount).toBe(3500);
    expect(divisi.run.annotations).toHaveLength(3500);
  });

  it('配置を解決できない注釈は 29 件（3500 中 0.8%）', () => {
    // 着手前計測では、符幹・加線を障害物に**含めた**場合 123 件、外した場合 25 件だった。
    // 実装では符頭との間に余白を入れたぶん 29 件になる。
    // 厳密値で固定しているのは、細線の除外をやめる等の変更が入れば 100 件超へ跳ね上がり、
    // 「なんとなく動いている」状態で劣化が見逃されるのを防ぐため
    expect(divisi.run.unresolved).toBe(29);
  });

  it('ページ寸法が 20 ページぶん確定する', () => {
    expect(divisi.run.pages).toHaveLength(20);
    expect(divisi.run.pageIssues).toEqual([]);
  });

  it('注釈どうしが同じ位置に重ならない', () => {
    expect(overlappingPairs(divisi.run)).toBe(0);
  });
});

describe('Audiveris ページと元PDFページの対応（発見1 の回帰）', () => {
  it('Victoria は sheet#1 の 2 ページが同じ元PDFページを指す', () => {
    expect(victoria.run.pages.map((page) => page.sourcePageIndex)).toEqual([0, 0, 1, 2]);
  });

  it('divisi は 20 ページが 1:1 で対応する', () => {
    expect(divisi.run.pages.map((page) => page.sourcePageIndex)).toEqual(
      Array.from({ length: 20 }, (_, index) => index),
    );
  });

  it('注釈の参照先ページが元PDFのページ数を超えない', () => {
    const victoriaMax = Math.max(...victoria.run.pages.map((page) => page.sourcePageIndex));
    expect(victoriaMax).toBe(2); // 元PDF は 3 ページ
  });
});

describe('ページ寸法の取り込み', () => {
  it('.omr の画像寸法と譜線間隔がそのまま入る', () => {
    expect(victoria.run.pages[0]).toMatchObject({
      omrImageWidthPx: 2480,
      omrImageHeightPx: 3507,
      interlinePx: 17,
    });
    expect(divisi.run.pages[0]).toMatchObject({
      omrImageWidthPx: 2408,
      omrImageHeightPx: 3150,
      interlinePx: 16,
    });
  });
});
