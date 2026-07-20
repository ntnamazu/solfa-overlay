import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildConfirmationItems } from '../../../src/domain/score/confirmationItems';
import { ScoreModelBuilder } from '../../../src/domain/score/ScoreModelBuilder';
import { KeyRegionBuilder } from '../../../src/domain/solfa/KeyRegionBuilder';
import { applyDegrees, SolfaEngine } from '../../../src/domain/solfa/SolfaEngine';
import { DEFAULT_SETTINGS } from '../../../src/shared/constants/DEFAULT_SETTINGS';
import type { ConfirmationItem, ConfirmationState } from '../../../src/shared/types/Confirmation';
import { runFixture } from './realFixtureHelpers';

/**
 * 確認フロー（ClefKeyConfirm）が実データで何を解決するかを固定する統合テスト
 *
 * Audiveris は声部譜の音部記号をしばしば取り違える。訂正を入れないと照合の
 * `pitchCrossCheckMismatch` が大量に残り、階名も誤る。この画面の存在意義は
 * **その削減量**にあるため、実測値をここで回帰として固定する。
 *
 * 併せて、確認項目を**譜表ごとではなく (パート, 音部記号) でまとめる**という設計判断
 * （実装前の実測で divisi は譜表 288 段 → グループ 17 行）も件数で固定する。
 * 1 曲 5 分以内という受入基準は、この集約なしには満たせない
 */

const readFixture = (dir: string, name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../../fixtures/${dir}/${name}`, import.meta.url)));

/** 検出された音部記号を一括で訂正した確認状態を作る */
function correctTo(
  items: ConfirmationItem[],
  detected: string,
  corrected: string,
): ConfirmationState {
  return {
    items: items.map((item) => (item.detected === detected ? { ...item, corrected } : item)),
    completedAt: '2026-07-19T00:00:00Z',
  };
}

/** issue 種別ごとの件数 */
const countByKind = (issues: readonly { kind: string }[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const issue of issues) {
    counts[issue.kind] = (counts[issue.kind] ?? 0) + 1;
  }
  return counts;
};

/** パートごとの pitchCrossCheckMismatch 件数 */
function mismatchByPart(issues: readonly unknown[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const issue of issues as { kind: string; staffRef?: { partId: string | null } }[]) {
    if (issue.kind !== 'pitchCrossCheckMismatch') {
      continue;
    }
    const partId = issue.staffRef?.partId ?? 'unknown';
    counts[partId] = (counts[partId] ?? 0) + 1;
  }
  return counts;
}

describe('確認フローの効果（divisi: SSAATTBB）', () => {
  const run = runFixture(readFixture('divisi', 'IMSLP175782.omr'), [
    readFixture('divisi', 'IMSLP175782.mxl'),
  ]);
  const items = buildConfirmationItems(run.artifacts, run.result.issues);

  it('288 段の譜表を 17 行へ集約する（確認画面が現実的な作業量に収まる）', () => {
    const staffCount = run.artifacts.pages
      .flatMap((page) => page.systems)
      .flatMap((system) => system.staves).length;

    expect(staffCount).toBe(288);
    expect(items).toHaveLength(17);
  });

  it('確認項目は (パート, 検出音部記号) で一意になる', () => {
    const keys = items.map((item) => `${item.partId}/${item.detected}`);
    expect(new Set(keys).size).toBe(items.length);
  });

  it('影響の大きい項目から並ぶ（ユーザーが上から直せば効果が最大化する）', () => {
    const counts = items.map((item) => item.mismatchCount);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  it('ALTO 誤検出は 41 段あり、1 項目の訂正がその全段へ及ぶ', () => {
    const altoItems = items.filter((item) => item.detected === 'ALTO');
    const staffRefs = altoItems.flatMap((item) => item.staffRefs);
    expect(staffRefs).toHaveLength(41);

    const p6 = items.find((item) => item.partId === 'P6' && item.detected === 'ALTO');
    // P6 は 35 段が ALTO と誤検出されている。1 行の訂正で 35 段が直ることが集約の要点
    expect(p6?.staffRefs).toHaveLength(35);
  });

  it('ALTO→TREBLE の訂正で音高照合の不一致が 569 → 111 へ減る', () => {
    const before = countByKind(run.result.issues);
    expect(before.pitchCrossCheckMismatch).toBe(569);

    const corrected = new ScoreModelBuilder().build(
      run.artifacts,
      run.structure,
      correctTo(items, 'ALTO', 'TREBLE'),
    );
    expect(countByKind(corrected.issues).pitchCrossCheckMismatch).toBe(111);
  });

  it('誤検出パート P6・P4 の不一致は 0 になる（残る 111 は別要因）', () => {
    const before = mismatchByPart(run.result.issues);
    expect(before).toMatchObject({ P6: 402, P4: 38, P7: 119, P8: 10 });

    const corrected = new ScoreModelBuilder().build(
      run.artifacts,
      run.structure,
      correctTo(items, 'ALTO', 'TREBLE'),
    );
    const after = mismatchByPart(corrected.issues);
    expect(after.P6 ?? 0).toBe(0);
    expect(after.P4 ?? 0).toBe(0);
    // P7 / P8 は音部記号の誤検出ではないため残る（この画面では解決しない）
    expect(after).toMatchObject({ P7: 101, P8: 10 });
  });

  it('訂正しなければ照合結果は変わらない（確認項目の生成自体は副作用を持たない）', () => {
    const untouched = new ScoreModelBuilder().build(run.artifacts, run.structure, {
      items,
      completedAt: '2026-07-19T00:00:00Z',
    });
    expect(countByKind(untouched.issues)).toEqual(countByKind(run.result.issues));
  });
});

describe('確認フローの効果（Victoria: 2 movement）', () => {
  const run = runFixture(readFixture('victoria', 'IMSLP19716.omr'), [
    readFixture('victoria', 'IMSLP19716.mvt1.mxl'),
    readFixture('victoria', 'IMSLP19716.mvt2.mxl'),
  ]);
  const items = buildConfirmationItems(run.artifacts, run.result.issues);

  it('36 段の譜表を 5 行へ集約する', () => {
    const staffCount = run.artifacts.pages
      .flatMap((page) => page.systems)
      .flatMap((system) => system.staves).length;

    expect(staffCount).toBe(36);
    expect(items).toHaveLength(5);
  });
});

describe('旋法の指定が階名に効く（Audiveris が mode を出さない制約の解消）', () => {
  const run = runFixture(readFixture('victoria', 'IMSLP19716.omr'), [
    readFixture('victoria', 'IMSLP19716.mvt1.mxl'),
    readFixture('victoria', 'IMSLP19716.mvt2.mxl'),
  ]);

  /** 指定の短調基準で階名のヒストグラムを作る */
  function syllables(
    minorBasis: 'la' | 'do',
    decisions: { measureIndex: number; mode: 'minor' }[],
  ) {
    const { keyRegions } = new KeyRegionBuilder().build(run.artifacts, run.structure, decisions);
    const engine = new SolfaEngine();
    const degrees = engine.computeDegrees(run.result.score, keyRegions, minorBasis);
    const score = applyDegrees(run.result.score, degrees);
    const histogram: Record<string, number> = {};
    for (const measure of score.measures) {
      for (const note of measure.notes) {
        if (note.solfa !== null) {
          const syllable = engine.toSyllable(note.solfa, { ...DEFAULT_SETTINGS, minorBasis });
          histogram[syllable] = (histogram[syllable] ?? 0) + 1;
        }
      }
    }
    return histogram;
  }

  /** 指定の短調基準で、全音符の度数を譜面順に取り出す */
  function degreesOf(
    minorBasis: 'la' | 'do',
    decisions: { measureIndex: number; mode: 'minor' }[],
  ): number[] {
    const { keyRegions } = new KeyRegionBuilder().build(run.artifacts, run.structure, decisions);
    const degrees = new SolfaEngine().computeDegrees(run.result.score, keyRegions, minorBasis);
    return run.result.score.measures
      .flatMap((measure) => measure.notes)
      .map((note) => degrees.get(note.id))
      .filter((degree): degree is NonNullable<typeof degree> => degree !== undefined)
      .map((degree) => degree.degree);
  }

  it('自動生成の調区間は必ず長調になる（Audiveris が mode を出さないため）', () => {
    const { keyRegions } = new KeyRegionBuilder().build(run.artifacts, run.structure);
    expect(keyRegions.every((region) => region.mode === 'major')).toBe(true);
    expect(keyRegions.every((region) => region.source === 'auto')).toBe(true);
  });

  it('mode を minor に訂正すると調号を保ったまま平行調へ移り、出所が user になる', () => {
    const auto = new KeyRegionBuilder().build(run.artifacts, run.structure).keyRegions[0];
    expect(auto).toBeDefined();
    const decided = new KeyRegionBuilder().build(run.artifacts, run.structure, [
      { measureIndex: auto!.start.measureIndex, mode: 'minor' },
    ]).keyRegions[0];

    expect(decided!.mode).toBe('minor');
    expect(decided!.source).toBe('user');
    // 平行調＝主音が長3度下がる（例: C major → A minor）
    expect(decided!.tonicStep).not.toBe(auto!.tonicStep);
  });

  it('短調と分かって初めて La 基準と Do 基準の階名が食い違う', () => {
    const decisions = new KeyRegionBuilder()
      .build(run.artifacts, run.structure)
      .keyRegions.map((region) => ({
        measureIndex: region.start.measureIndex,
        mode: 'minor' as const,
      }));

    // 長調のままなら La 基準・Do 基準は同じ結果を返す（短調基準は短調にしか効かない）
    const majorLa = syllables('la', []);
    const majorDo = syllables('do', []);
    expect(majorLa).toEqual(majorDo);

    // 短調と指定すると初めて両者が分岐する。これが「mode を出さない」制約の実害だった
    const minorLa = syllables('la', decisions);
    const minorDo = syllables('do', decisions);
    expect(minorLa).not.toEqual(minorDo);

    // 同じ音に対し、La 基準の度数は Do 基準より 5 つ進む（主音を 6=La と数えるか 1=Do と数えるかの差）。
    // 全音符でこの関係が成り立つことを確認し、「片方だけ壊れている」状態を弾く
    const degreesLa = degreesOf('la', decisions);
    const degreesDo = degreesOf('do', decisions);
    expect(degreesLa).toHaveLength(degreesDo.length);
    expect(degreesLa.length).toBeGreaterThan(0);
    expect(degreesLa).toEqual(degreesDo.map((degree) => ((degree - 1 + 5) % 7) + 1));
  });
});
