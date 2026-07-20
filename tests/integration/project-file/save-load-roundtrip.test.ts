import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildConfirmationItems } from '../../../src/domain/score/confirmationItems';
import { ScoreModelBuilder } from '../../../src/domain/score/ScoreModelBuilder';
import { KeyRegionBuilder } from '../../../src/domain/solfa/KeyRegionBuilder';
import { applyDegrees, SolfaEngine } from '../../../src/domain/solfa/SolfaEngine';
import { assembleArtifacts } from '../../../src/main/omr/omrArchive';
import type { Project } from '../../../src/shared/types/Project';
import { ProjectStore } from '../../../src/storage/ProjectStore';
import { makeSourcePdf, runFixture } from '../pipeline/realFixtureHelpers';

/**
 * 実フィクスチャを使った `.solfaproj` の保存・読込の往復
 *
 * 永続化の目的は「OMR をやり直さずに作業を再開できる」こと（信頼性要件）。
 * 単体テストは合成データで各部品を検証しているが、**実際の .omr / .mxl を同梱した
 * ファイルが往復し、読込側だけで階名まで到達できる**ことはここでしか確認できない
 */

const readFixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../../fixtures/victoria/${name}`, import.meta.url)));

const OMR_BYTES = readFixture('IMSLP19716.omr');
const MOVEMENT_BYTES = [readFixture('IMSLP19716.mvt1.mxl'), readFixture('IMSLP19716.mvt2.mxl')];

/**
 * 元PDF の代わり（実物は数十MBのためリポジトリに置いていない）
 *
 * Victoria の実際の元PDF と同じ **3 ページ・A4**。Audiveris は 4 ページを検出するため、
 * ページ対応の解決がこの往復でも実際に効く
 */
let SOURCE_PDF: Uint8Array;

let directory: string;
let projectPath: string;
let store: ProjectStore;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'solfa-roundtrip-'));
  projectPath = join(directory, 'victoria.solfaproj');
  store = new ProjectStore();
  SOURCE_PDF = await makeSourcePdf(3, [2480, 3507]);
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** 解析済みの Project を組み立てる（編成レイヤーが行う手順を統合テスト内で再現する） */
function analyzedProject(): Project {
  const run = runFixture(OMR_BYTES, MOVEMENT_BYTES);
  const items = buildConfirmationItems(run.artifacts, run.result.issues);
  const confirmation = {
    items: items.map((item) =>
      item.detected === 'ALTO' ? { ...item, corrected: 'TREBLE' } : item,
    ),
    completedAt: '2026-07-19T00:00:00Z',
  };
  const corrected = new ScoreModelBuilder().build(run.artifacts, run.structure, confirmation);
  const keyRegionDecisions = [{ measureIndex: 0, mode: 'minor' as const }];
  const { keyRegions } = new KeyRegionBuilder().build(
    run.artifacts,
    run.structure,
    keyRegionDecisions,
  );
  const degrees = new SolfaEngine().computeDegrees(corrected.score, keyRegions, 'la');

  return {
    ...store.create(),
    score: applyDegrees(corrected.score, degrees),
    confirmation,
    keyRegionDecisions,
    keyRegions,
  };
}

describe('.solfaproj の保存・読込（実 Audiveris 出力を同梱）', () => {
  it('解析済みプロジェクトが内容を保ったまま往復する', async () => {
    const project = analyzedProject();
    const saved = await store.save(projectPath, project, SOURCE_PDF, {
      omr: OMR_BYTES,
      movements: MOVEMENT_BYTES,
    });
    const loaded = await store.load(projectPath);

    expect(loaded.project).toEqual(saved);
    // 階名まで含めて復元される（音符 1 つ 1 つの solfa が保持されている）
    const notes = loaded.project.score?.measures.flatMap((measure) => measure.notes) ?? [];
    const withSolfa = notes.filter((note) => note.solfa !== null).length;
    expect(withSolfa).toBeGreaterThan(0);
    expect(withSolfa).toBe(
      project.score?.measures.flatMap((m) => m.notes).filter((n) => n.solfa !== null).length,
    );
  });

  it('中間データが同梱され、OMR を再実行せずに解析へ戻れる', async () => {
    await store.save(projectPath, analyzedProject(), SOURCE_PDF, {
      omr: OMR_BYTES,
      movements: MOVEMENT_BYTES,
    });
    const loaded = await store.load(projectPath);

    // 読み込んだバイト列だけで OmrArtifacts を組み直せる＝Audiveris の再実行が不要
    const artifacts = assembleArtifacts(loaded.omr);
    expect(artifacts.movements).toHaveLength(2);
    expect(artifacts.pages.flatMap((page) => page.systems).length).toBeGreaterThan(0);
  });

  it('確認状態と decisions が復元され、訂正後の照合結果を再現できる', async () => {
    const project = analyzedProject();
    await store.save(projectPath, project, SOURCE_PDF, {
      omr: OMR_BYTES,
      movements: MOVEMENT_BYTES,
    });
    const loaded = await store.load(projectPath);

    expect(loaded.project.confirmation).toEqual(project.confirmation);
    expect(loaded.project.keyRegionDecisions).toEqual([{ measureIndex: 0, mode: 'minor' }]);

    // 復元した確認状態で解析し直すと、保存時と同じ照合結果になる
    const run = runFixture(OMR_BYTES, MOVEMENT_BYTES);
    const rebuilt = new ScoreModelBuilder().build(
      run.artifacts,
      run.structure,
      loaded.project.confirmation,
    );
    expect(rebuilt.score).toEqual(
      new ScoreModelBuilder().build(run.artifacts, run.structure, project.confirmation).score,
    );
  });

  it('ユーザーが指定した旋法が復元される（自動生成では得られない情報）', async () => {
    await store.save(projectPath, analyzedProject(), SOURCE_PDF, {
      omr: OMR_BYTES,
      movements: MOVEMENT_BYTES,
    });
    const loaded = await store.load(projectPath);

    const decided = loaded.project.keyRegions.filter((region) => region.source === 'user');
    expect(decided.length).toBeGreaterThan(0);
    expect(decided.every((region) => region.mode === 'minor')).toBe(true);
  });

  it('保存し直しても内容が壊れず、直前版がバックアップに残る', async () => {
    const first = analyzedProject();
    await store.save(projectPath, first, SOURCE_PDF, { omr: OMR_BYTES, movements: MOVEMENT_BYTES });

    const second = { ...first, keyRegionDecisions: [{ measureIndex: 0, mode: 'major' as const }] };
    await store.save(projectPath, second, SOURCE_PDF, {
      omr: OMR_BYTES,
      movements: MOVEMENT_BYTES,
    });

    expect((await store.load(projectPath)).project.keyRegionDecisions).toEqual(
      second.keyRegionDecisions,
    );
    expect((await store.load(`${projectPath}.bak1`)).project.keyRegionDecisions).toEqual(
      first.keyRegionDecisions,
    );
  });
});
