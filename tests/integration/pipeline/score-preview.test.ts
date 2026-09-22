import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { renderOverlay } from '../../../src/domain/render/OverlayRenderer';
import { buildScorePreview } from '../../../src/domain/render/scorePreview';
import type { ScorePreviewInput } from '../../../src/domain/render/scorePreview';
import { DEFAULT_SETTINGS } from '../../../src/shared/constants/DEFAULT_SETTINGS';
import type { Project } from '../../../src/shared/types/Project';
import type { ScorePreview } from '../../../src/shared/types/ScorePreview';
import type { AnnotationRun, FixtureRun, SolfaRun } from './realFixtureHelpers';
import { makeSourcePdf, runAnnotations, runFixture, runSolfa } from './realFixtureHelpers';

/**
 * 実データでの楽譜プレビュー（Phase 6・#4）
 *
 * 画面に重ねる内容が**出力PDFと一致する**ことを固定する。プレビューの価値は
 * 「出力しなくても出力結果が分かる」ことにあり、件数やページがずれた時点で意味を失う。
 * 元PDF は `.omr` の画像寸法を 300dpi として逆算した空PDF（他の統合テストと同じ）
 */

const read = (path: string): Uint8Array => new Uint8Array(readFileSync(path));

interface Case {
  input: ScorePreviewInput;
  preview: ScorePreview;
  sourcePdf: Uint8Array;
  sourcePageCount: number;
  skippedCount: number;
}

let victoria: Case;
let divisi: Case;

async function prepare(
  fixture: FixtureRun,
  solfa: SolfaRun,
  omr: Uint8Array,
  sourcePageCount: number,
  imagePx: [number, number],
): Promise<Case> {
  const sourcePdf = await makeSourcePdf(sourcePageCount, imagePx);
  const run: AnnotationRun = await runAnnotations(omr, solfa, sourcePdf);
  const input: ScorePreviewInput = {
    score: solfa.score,
    omrPages: fixture.artifacts.pages,
    pages: run.pages,
    annotations: run.annotations,
    annotationIssues: run.issues,
    settings: { ...DEFAULT_SETTINGS },
  };
  return {
    input,
    preview: buildScorePreview(input),
    sourcePdf,
    sourcePageCount,
    skippedCount: fixture.summary.skippedMeasures,
  };
}

beforeAll(async () => {
  const victoriaOmr = read('tests/fixtures/victoria/IMSLP19716.omr');
  const victoriaFixture = runFixture(victoriaOmr, [
    read('tests/fixtures/victoria/IMSLP19716.mvt1.mxl'),
    read('tests/fixtures/victoria/IMSLP19716.mvt2.mxl'),
  ]);
  victoria = await prepare(
    victoriaFixture,
    runSolfa(victoriaFixture),
    victoriaOmr,
    3,
    [2480, 3507],
  );

  const divisiOmr = read('tests/fixtures/divisi/IMSLP175782.omr');
  const divisiFixture = runFixture(divisiOmr, [read('tests/fixtures/divisi/IMSLP175782.mxl')]);
  divisi = await prepare(divisiFixture, runSolfa(divisiFixture), divisiOmr, 20, [2408, 3150]);
}, 120_000);

/** 出力PDFの描画件数（同じ注釈列を OverlayRenderer に通す） */
async function drawnCount(target: Case): Promise<number> {
  const project: Project = {
    schemaVersion: 1,
    id: 'fixture',
    sourcePdf: 'source.pdf',
    pages: [...target.input.pages],
    score: target.input.score,
    confirmation: { items: [], completedAt: '2026-09-22T00:00:00.000Z' },
    structureDecisions: [],
    keyRegionDecisions: [],
    keyRegions: [],
    annotations: [...target.input.annotations],
    settings: target.input.settings,
    createdAt: '2026-09-22T00:00:00.000Z',
    updatedAt: '2026-09-22T00:00:00.000Z',
  };
  return (await renderOverlay({ sourcePdf: target.sourcePdf, project })).drawnCount;
}

const count = (
  preview: ScorePreview,
  key: 'annotations' | 'skippedMeasures' | 'placementWarnings',
) => preview.pages.reduce((sum, page) => sum + page[key].length, 0);

describe.each([
  ['Victoria', () => victoria],
  ['divisi', () => divisi],
])('楽譜プレビュー（%s）', (_name, get) => {
  it('画面に重ねる注釈の件数が出力PDFの描画件数と一致する', async () => {
    const target = get();
    expect(count(target.preview, 'annotations')).toBe(await drawnCount(target));
  });

  it('元PDFのページを重複させず、ページ数を超えない', () => {
    const indices = get().preview.pages.map((page) => page.sourcePageIndex);
    expect(new Set(indices).size).toBe(indices.length);
    expect(indices.every((index) => index >= 0 && index < get().sourcePageCount)).toBe(true);
  });

  it('スキップ小節すべてに楽譜上の位置が付く', () => {
    expect(count(get().preview, 'skippedMeasures')).toBe(get().skippedCount);
  });

  it('スキップ小節の枠はページの内側に収まり、面積を持つ', () => {
    for (const page of get().preview.pages) {
      for (const region of page.skippedMeasures) {
        expect(region.width).toBeGreaterThan(0);
        expect(region.height).toBeGreaterThan(0);
        expect(region.x).toBeGreaterThanOrEqual(0);
        expect(region.y).toBeGreaterThanOrEqual(0);
        expect(region.x + region.width).toBeLessThanOrEqual(page.widthPt);
        expect(region.y + region.height).toBeLessThanOrEqual(page.heightPt);
      }
    }
  });

  it('配置警告の印は配置を解決できなかった注釈と 1:1', () => {
    const unresolved = get().input.annotationIssues.filter(
      (issue) => issue.kind === 'placementUnresolved',
    ).length;
    expect(count(get().preview, 'placementWarnings')).toBe(unresolved);
  });
});

describe('実測値の固定', () => {
  it('Victoria: 注釈 808・3 ページ・スキップ小節 1・配置警告 0', () => {
    expect(count(victoria.preview, 'annotations')).toBe(808);
    expect(victoria.preview.pages).toHaveLength(3);
    expect(count(victoria.preview, 'skippedMeasures')).toBe(1);
    expect(count(victoria.preview, 'placementWarnings')).toBe(0);
  });

  it('divisi: 注釈 3500・20 ページ・スキップ小節 135・配置警告 29', () => {
    expect(count(divisi.preview, 'annotations')).toBe(3500);
    expect(divisi.preview.pages).toHaveLength(20);
    expect(count(divisi.preview, 'skippedMeasures')).toBe(135);
    expect(count(divisi.preview, 'placementWarnings')).toBe(29);
  });
});

describe('性能（PRD 非機能要件「確認・修正UIの操作 1 秒以内」）', () => {
  it('divisi（3,500 注釈・20 ページ）のプレビュー構築が 1 秒未満で終わる', () => {
    const started = performance.now();
    buildScorePreview(divisi.input);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
