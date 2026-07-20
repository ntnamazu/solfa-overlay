import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectSession } from '../../../src/main/ProjectSession';
import type { OmrRunnerLike } from '../../../src/main/ProjectSession';
import { assembleArtifacts } from '../../../src/main/omr/omrArchive';
import type { OmrProgress } from '../../../src/shared/types/OmrProgress';
import type { OmrRawArtifacts } from '../../../src/shared/types/OmrRawArtifacts';
import { makeSourcePdf } from '../pipeline/realFixtureHelpers';

/**
 * 「取り込み → 保存 → 開き直し → PDF 出力」の通し回帰（Phase 5 のゲート）
 *
 * ロードマップの「リリース」の定義は *PDF を入力し、階名付きPDF を得られる状態*。
 * ここでは編成レイヤー（`ProjectSession`）を実データで通し、**OMR を再実行せずに**
 * 保存済みプロジェクトから PDF まで到達できることを確認する。
 */

const readFixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../../fixtures/victoria/${name}`, import.meta.url)));

const RAW: OmrRawArtifacts = {
  omr: readFixture('IMSLP19716.omr'),
  movements: [readFixture('IMSLP19716.mvt1.mxl'), readFixture('IMSLP19716.mvt2.mxl')],
};

/** 実フィクスチャを返す擬似 OMR 実行器（Audiveris はテスト環境で動かせない） */
class CountingRunner implements OmrRunnerLike {
  calls = 0;

  run(_pdfPath: string, onProgress: (progress: OmrProgress) => void) {
    this.calls += 1;
    onProgress({ phase: 'completed', sheet: null, totalSheets: null, message: '' });
    return Promise.resolve({ artifacts: assembleArtifacts(RAW), raw: RAW });
  }

  cancel(): void {}
}

let directory: string;
let pdfPath: string;
let projectPath: string;
let exportPath: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'solfa-reopen-'));
  pdfPath = join(directory, 'score.pdf');
  projectPath = join(directory, 'score.solfaproj');
  exportPath = join(directory, 'score-solfa.pdf');
  await writeFile(pdfPath, await makeSourcePdf(3, [2480, 3507]));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('取り込みから注釈付きPDF出力まで', () => {
  it('OMR を再実行せずに保存済みプロジェクトから PDF を出力できる', async () => {
    // 1 回目: 取り込み → 承認 → 保存
    const first = new ProjectSession({ runner: new CountingRunner() });
    await first.importPdf(pdfPath, () => {});
    first.completeConfirmation();
    await first.save(projectPath);

    // 2 回目: 別セッションで開く（OMR 実行器は呼ばれないはず）
    const reopenRunner = new CountingRunner();
    const second = new ProjectSession({ runner: reopenRunner });
    const snapshot = await second.open(projectPath);

    expect(reopenRunner.calls).toBe(0);
    expect(snapshot.project.confirmation.completedAt).not.toBeNull();
    expect(snapshot.project.annotations).toHaveLength(808);

    const result = await second.exportPdf(exportPath);

    expect(result.drawnCount).toBe(808);
    const written = await PDFDocument.load(new Uint8Array(readFileSync(exportPath)));
    expect(written.getPageCount()).toBe(3);
  }, 120_000);

  it('確認画面での訂正が出力まで効く', async () => {
    const session = new ProjectSession({ runner: new CountingRunner() });
    const initial = await session.importPdf(pdfPath, () => {});

    // ALTO と誤検出されたグループを TREBLE へ訂正する（Phase 4 の効果を出力まで通す）
    const altoItems = initial.project.confirmation.items.filter((item) => item.detected === 'ALTO');
    const corrected = session.setClefCorrections(
      new Map(altoItems.map((item) => [item.id, 'TREBLE'])),
    );

    // 訂正で承認が外れるため、出力前に承認し直す必要がある
    expect(corrected.project.confirmation.completedAt).toBeNull();
    session.completeConfirmation();

    const result = await session.exportPdf(exportPath);
    expect(result.drawnCount).toBeGreaterThan(0);
  }, 120_000);

  it('ページ寸法が保存・読込を往復しても同じ値になる', async () => {
    const first = new ProjectSession({ runner: new CountingRunner() });
    const before = await first.importPdf(pdfPath, () => {});
    first.completeConfirmation();
    await first.save(projectPath);

    const second = new ProjectSession({ runner: new CountingRunner() });
    const after = await second.open(projectPath);

    expect(after.project.pages).toEqual(before.project.pages);
    expect(after.project.pages.map((page) => page.sourcePageIndex)).toEqual([0, 0, 1, 2]);
  }, 120_000);
});
