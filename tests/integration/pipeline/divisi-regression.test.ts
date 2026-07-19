import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runFixture } from './realFixtureHelpers';

/**
 * SSAATTBB divisi 曲《The Message of the Angels》(Reed, 1919・パブリックドメイン) の
 * 実 Audiveris 出力に対する **構造解決後（BookStructureResolver 導入後）** の回帰。
 *
 * 20 ページ中 2 段（page5・page10 の第2段）で .omr の stack 数が MusicXML の小節数より 1 つ多く、
 * 従来は ScoreModelBuilder が stack 数を累積していたためこのズレが以降の全ページへ波及していた
 * （skipped 561）。BookStructureResolver が段ごとの小節番号を MusicXML の段レイアウトへ
 * アンカーすることでズレが当該段に閉じ、skipped 135・照合音符 3500 まで改善した。
 *
 * 実測値の根拠・残る限界は tests/fixtures/divisi/README.md 参照。
 */
const read = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../../fixtures/divisi/${name}`, import.meta.url)));

describe('divisi (The Message of the Angels) 構造解決後の回帰', () => {
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

  it('BookStructureResolver が段あたり小節数のズレ 2 件と譜表数の不揃い 4 ページを検出する', () => {
    expect(run.summary.structureIssueCounts).toEqual({
      systemMeasureCountMismatch: 2,
      inconsistentSystemStaffCount: 4,
    });
    // ズレは page5 / page10 の第2段。いずれも .omr が MusicXML より stack 1 つ多い
    expect(
      run.structureIssues
        .filter((issue) => issue.kind === 'systemMeasureCountMismatch')
        .map((issue) => issue),
    ).toEqual([
      {
        kind: 'systemMeasureCountMismatch',
        movementIndex: 0,
        pageIndex: 5,
        systemIndex: 1,
        omrStackCount: 8,
        xmlMeasureCount: 7,
      },
      {
        kind: 'systemMeasureCountMismatch',
        movementIndex: 0,
        pageIndex: 10,
        systemIndex: 1,
        omrStackCount: 8,
        xmlMeasureCount: 7,
      },
    ]);
  });

  it('和音・divisi の列対付けが実際に稼働している（複数音が同一列に乗る小節が存在）', () => {
    expect(run.summary.multiNoteColumnMeasures).toBe(222);
  });

  it('構造解決後の matched/skipped/notes/issue 件数を固定する', () => {
    expect(run.summary.matchedMeasures).toBe(1029);
    expect(run.summary.skippedMeasures).toBe(135);
    expect(run.summary.notes).toBe(3500);
    expect(run.summary.issueCounts).toEqual({
      // 構造ズレ由来ではなく、Audiveris が段ごとにパート id を付け替えることによる残存分。
      // MusicXML 側も同じ割当で出力されるため本フェーズでは解消できない（README の「残る限界」）
      pitchCrossCheckMismatch: 569,
      measureCountMismatch: 135,
      // アンカーが定めた小節数を超える stack（段内に隔離され、後続段へ波及しない）
      measureOutOfRange: 14,
    });
  });

  it('Phase 2 前ベースライン（skipped 561 / notes 1433）から明確に改善している', () => {
    expect(run.summary.skippedMeasures).toBeLessThan(200);
    expect(run.summary.notes).toBeGreaterThanOrEqual(3000);
  });
});
