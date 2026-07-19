import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runFixture } from './realFixtureHelpers';

/**
 * SSAATTBB divisi 曲《The Message of the Angels》(Reed, 1919・パブリックドメイン) の
 * 実 Audiveris 出力に対する **Phase 2 前ベースライン** 回帰。
 *
 * この曲は声部の段階的入り（1 ページ目で part8→7,8→4-8 と登場パートが変化）を含み、
 * ScoreModelBuilder が前提とする「全パートが全システムに存在する」構造から外れる。
 * BookStructureResolver（別フェーズ）で確定構造を復元するまでは通し小節番号がずれ、
 * 多数の小節が skipped になる。ここでは列対付けの正しさを主張するのではなく:
 *   1. 大きな実ファイル（20 ページ・8 パート）を assembleArtifacts が破綻なく処理できること
 *   2. 和音・divisi の列（複数音が同一符頭中心 x を共有）が実際に対付けを稼働させていること
 *   3. Phase 2 で改善すべき現状値（skipped/mismatch）のスナップショット
 * を固定する。Phase 2 実装後、これらの期待値は改善方向に更新される想定。
 *
 * 実測値の根拠・既知の限界は tests/fixtures/divisi/README.md 参照。
 */
const read = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../../fixtures/divisi/${name}`, import.meta.url)));

describe('divisi (The Message of the Angels) Phase2 前ベースライン', () => {
  const run = runFixture(read('IMSLP175782.omr'), [read('IMSLP175782.mxl')]);

  it('20 ページ・8 パート（SSAATTBB＋2段検出パート）を破綻なく組み立てる', () => {
    expect(run.summary.movements).toBe(1);
    expect(run.summary.pages).toBe(20);
    expect(run.summary.parts).toEqual([
      'P1(Voice)',
      'P2(Voice)',
      'P3(Voice)',
      'P4(Voice)',
      'P5(Voice)',
      'P6(Voice)',
      'P7(Voice)',
      'P8(Piano)',
    ]);
  });

  it('和音・divisi の列対付けが実際に稼働している（複数音が同一列に乗る小節が存在）', () => {
    expect(run.summary.multiNoteColumnMeasures).toBeGreaterThan(0);
    expect(run.summary.multiNoteColumnMeasures).toBe(84);
  });

  it('Phase2 前ベースライン: 現状の matched/skipped/notes/issue 件数を固定する', () => {
    // ↓ BookStructureResolver 未実装ゆえの構造ずれを含むスナップショット。Phase 2 後に更新する。
    expect(run.summary.matchedMeasures).toBe(604);
    expect(run.summary.skippedMeasures).toBe(561);
    expect(run.summary.notes).toBe(1433);
    expect(run.summary.issueCounts).toEqual({
      pitchCrossCheckMismatch: 395,
      measureCountMismatch: 561,
      measureOutOfRange: 13,
    });
  });
});
