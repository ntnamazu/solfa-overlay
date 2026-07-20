import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderOverlay } from '../../../src/domain/render/OverlayRenderer';
import { DEFAULT_SETTINGS } from '../../../src/shared/constants/DEFAULT_SETTINGS';
import type { Project } from '../../../src/shared/types/Project';
import { writeExportPdf } from '../../../src/storage/writeExportPdf';
import type { AnnotationRun } from '../pipeline/realFixtureHelpers';
import {
  makeSourcePdf,
  runAnnotations,
  runFixture,
  runSolfa,
} from '../pipeline/realFixtureHelpers';

/**
 * 実データでの「注釈 → PDF 合成 → 書き出し」通し回帰（Phase 5・F-4）
 *
 * 元PDF は合成した空PDF を使う（PD楽譜の PDF 本体は数十MBあるためリポジトリに置いていない）。
 * ここで確かめたいのは**ページ対応・座標変換・文字の置換・版面の保持**であり、
 * 元PDF の中身には依存しない。
 */

const read = (path: string): Uint8Array => new Uint8Array(readFileSync(path));

interface Case {
  project: Project;
  sourcePdf: Uint8Array;
  run: AnnotationRun;
}

let victoria: Case;
let divisi: Case;
let directory: string;

/** 解析結果から出力用の `Project` を組み立てる（確認は承認済みとする） */
function toProject(run: AnnotationRun, score: Project['score']): Project {
  return {
    schemaVersion: 1,
    id: 'fixture',
    sourcePdf: 'source.pdf',
    pages: run.pages,
    score,
    confirmation: { items: [], completedAt: '2026-07-20T00:00:00.000Z' },
    structureDecisions: [],
    keyRegionDecisions: [],
    keyRegions: [],
    annotations: run.annotations,
    settings: { ...DEFAULT_SETTINGS },
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
  };
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'solfa-export-integration-'));

  const victoriaOmr = read('tests/fixtures/victoria/IMSLP19716.omr');
  const victoriaSolfa = runSolfa(
    runFixture(victoriaOmr, [
      read('tests/fixtures/victoria/IMSLP19716.mvt1.mxl'),
      read('tests/fixtures/victoria/IMSLP19716.mvt2.mxl'),
    ]),
  );
  const victoriaPdf = await makeSourcePdf(3, [2480, 3507]);
  const victoriaRun = await runAnnotations(victoriaOmr, victoriaSolfa, victoriaPdf);
  victoria = {
    sourcePdf: victoriaPdf,
    run: victoriaRun,
    project: toProject(victoriaRun, victoriaSolfa.score),
  };

  const divisiOmr = read('tests/fixtures/divisi/IMSLP175782.omr');
  const divisiSolfa = runSolfa(
    runFixture(divisiOmr, [read('tests/fixtures/divisi/IMSLP175782.mxl')]),
  );
  const divisiPdf = await makeSourcePdf(20, [2408, 3150]);
  const divisiRun = await runAnnotations(divisiOmr, divisiSolfa, divisiPdf);
  divisi = {
    sourcePdf: divisiPdf,
    run: divisiRun,
    project: toProject(divisiRun, divisiSolfa.score),
  };
}, 180_000);

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('Victoria の PDF 出力', () => {
  it('全ての注釈を描き、問題を報告しない', async () => {
    const result = await renderOverlay({
      sourcePdf: victoria.sourcePdf,
      project: victoria.project,
    });

    expect(result.drawnCount).toBe(808);
    expect(result.issues).toEqual([]);
  });

  it('元PDFのページ数と寸法を変えない（版面を保つ）', async () => {
    const result = await renderOverlay({
      sourcePdf: victoria.sourcePdf,
      project: victoria.project,
    });
    const before = await PDFDocument.load(victoria.sourcePdf);
    const after = await PDFDocument.load(result.bytes);

    expect(after.getPageCount()).toBe(before.getPageCount());
    expect(after.getPageCount()).toBe(3);
    for (const [index, page] of after.getPages().entries()) {
      expect(page.getWidth()).toBeCloseTo(before.getPages()[index]?.getWidth() ?? 0, 6);
      expect(page.getHeight()).toBeCloseTo(before.getPages()[index]?.getHeight() ?? 0, 6);
    }
  });

  it('Audiveris の page 0・1 の注釈が元PDF の 1 ページ目へ行く（発見1 の回帰）', () => {
    // 注釈は Audiveris ページ 0〜3 に散っているが、行き先は 3 ページしかない
    const targets = new Set(
      victoria.project.annotations.map(
        (annotation) =>
          victoria.run.pages.find((page) => page.pageIndex === annotation.anchor.pageIndex)
            ?.sourcePageIndex,
      ),
    );

    expect([...targets].sort()).toEqual([0, 1, 2]);
    // page 0 と page 1 の注釈はどちらも元PDF 1 ページ目（index 0）へ
    const pageZero = victoria.run.pages.find((page) => page.pageIndex === 0);
    const pageOne = victoria.run.pages.find((page) => page.pageIndex === 1);
    expect(pageZero?.sourcePageIndex).toBe(0);
    expect(pageOne?.sourcePageIndex).toBe(0);
  });

  it('注釈が PDF ページの範囲内に収まる', async () => {
    const { toPdfPoint } = await import('../../../src/domain/render/coordinateTransform');
    const byIndex = new Map(victoria.run.pages.map((page) => [page.pageIndex, page]));
    let outside = 0;
    for (const annotation of victoria.project.annotations) {
      const page = byIndex.get(annotation.anchor.pageIndex);
      const point = page === undefined ? null : toPdfPoint(page, annotation.anchor);
      if (page === undefined || point === null) {
        outside += 1;
        continue;
      }
      if (point.x < 0 || point.x > page.widthPt || point.y < 0 || point.y > page.heightPt) {
        outside += 1;
      }
    }

    expect(outside).toBe(0);
  });
});

describe('divisi の PDF 出力', () => {
  it('3500 件の注釈を描く', async () => {
    const result = await renderOverlay({ sourcePdf: divisi.sourcePdf, project: divisi.project });
    expect(result.drawnCount).toBe(3500);
  });

  it('標準フォントで描けない音節があっても例外にならず、置換を報告する（発見4 の回帰）', async () => {
    // divisi には do♭ ×3 / ti♯ ×1 が出る。置換経路が無いと**出力が丸ごと失敗する**
    const result = await renderOverlay({ sourcePdf: divisi.sourcePdf, project: divisi.project });
    const substitutions = result.issues.filter((issue) => issue.kind === 'characterSubstituted');

    expect(substitutions).toEqual(
      expect.arrayContaining([
        { kind: 'characterSubstituted', from: '♭', to: 'b', count: 3 },
        { kind: 'characterSubstituted', from: '♯', to: '#', count: 1 },
      ]),
    );
  });

  it('20 ページが 1:1 で対応し、描画先を失う注釈がない', async () => {
    const result = await renderOverlay({ sourcePdf: divisi.sourcePdf, project: divisi.project });
    expect(result.issues.filter((issue) => issue.kind === 'pageInfoMissing')).toEqual([]);
  });

  it('出力が 30 秒以内に終わる（アーキテクチャ設計書の性能要件）', async () => {
    const started = Date.now();
    const result = await renderOverlay({ sourcePdf: divisi.sourcePdf, project: divisi.project });
    await writeExportPdf(join(directory, 'divisi.pdf'), result.bytes);

    expect(Date.now() - started).toBeLessThan(30_000);
  }, 60_000);
});

describe('書き出し', () => {
  it('生成したバイト列がそのままファイルになる', async () => {
    const result = await renderOverlay({
      sourcePdf: victoria.sourcePdf,
      project: victoria.project,
    });
    const outPath = join(directory, 'victoria.pdf');
    await writeExportPdf(outPath, result.bytes);

    const written = new Uint8Array(await readFile(outPath));
    expect(written).toEqual(result.bytes);
    // 書き出したファイルが PDF として開ける（壊れたバイト列を書いていない）
    expect((await PDFDocument.load(written)).getPageCount()).toBe(3);
  });
});
