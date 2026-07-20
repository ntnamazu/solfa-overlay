import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { describeKeyRegions, runFixture, runSolfa, syllablesOf } from './realFixtureHelpers';
import { DEFAULT_SETTINGS } from '../../../src/shared/constants/DEFAULT_SETTINGS';

/**
 * 階名パイプラインの一気通貫回帰（ロードマップ Phase 3 のゲート）
 *
 * 「.omr + .mxl → 構造解決 → 照合 → KeyRegion 生成 → 階名計算 → 階名文字列」を
 * UI なしで実データに通す。照合そのものの回帰は victoria-regression / divisi-regression が担当し、
 * ここでは**階名側の実測値**を固定する。
 *
 * 実測値の根拠は tests/fixtures 配下の各 README.md 参照。
 */
const victoria = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../../fixtures/victoria/${name}`, import.meta.url)));
const divisi = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../../fixtures/divisi/${name}`, import.meta.url)));

describe('Victoria: 階名パイプライン一気通貫', () => {
  const run = runFixture(victoria('IMSLP19716.omr'), [
    victoria('IMSLP19716.mvt1.mxl'),
    victoria('IMSLP19716.mvt2.mxl'),
  ]);
  const solfa = runSolfa(run);

  it('調号から KeyRegion を復元する（曲頭の既定＋mvt2 冒頭の転調）', () => {
    // 曲頭に調号宣言がないため既定のハ長調が入る。mvt2 のローカル m7 が
    // 通し小節番号 28（mvt1 の 21 小節 + 7）に対応し、fifths=1 → ト長調になる
    expect(describeKeyRegions(solfa.keyRegions)).toEqual(['m0:C', 'm28:G']);
    expect(solfa.keyRegions[0]?.source).toBe('auto');
  });

  it('調号の食い違いがない（4 声部が全て同じ調号を宣言している）', () => {
    expect(solfa.keyRegionIssueCounts).toEqual({});
  });

  it('照合できた全ての音符が階名を得る（取りこぼしゼロ）', () => {
    expect(solfa.degreeCount).toBe(808);
    expect(solfa.degreeCount).toBe(run.summary.notes);

    const withoutSolfa = solfa.score.measures.flatMap((measure) =>
      measure.notes.filter((note) => note.solfa === null),
    );
    expect(withoutSolfa).toEqual([]);
  });

  it('階名の分布が実測値どおりになる', () => {
    expect(solfa.syllableHistogram).toEqual({
      do: 76,
      re: 160,
      mi: 119,
      fa: 94,
      so: 72,
      la: 167,
      ti: 51,
      di: 33,
      fi: 10,
      si: 4,
      te: 22,
    });
  });

  it('代表小節の階名列が実測値どおりになる', () => {
    expect(syllablesOf(solfa, 'P1', 2)).toEqual(['ti', 'ti', 'do', 'do']);
    expect(syllablesOf(solfa, 'P1', 4)).toEqual(['do', 're', 'mi', 'mi']);
    expect(syllablesOf(solfa, 'P1', 5)).toEqual(['mi', 'ti', 'do', 'ti']);
  });

  it('音節体系の切り替えが階名文字列に反映される', () => {
    expect(
      syllablesOf(solfa, 'P1', 4, { ...DEFAULT_SETTINGS, syllableSystem: 'tonicSolfa' }),
    ).toEqual(['d', 'r', 'm', 'm']);
  });
});

describe('divisi: 階名パイプライン一気通貫', () => {
  const run = runFixture(divisi('IMSLP175782.omr'), [divisi('IMSLP175782.mxl')]);
  const solfa = runSolfa(run);

  it('調号の変化点から KeyRegion を復元する', () => {
    expect(describeKeyRegions(solfa.keyRegions)).toEqual([
      'm0:C',
      'm48:G',
      'm114:C',
      'm133:F',
      'm141:C',
      'm145:F',
      'm153:C',
      'm178:F',
    ]);
  });

  it('パート間の調号の食い違いを報告する（多数決で採用した事実を残す）', () => {
    expect(solfa.keyRegionIssueCounts).toEqual({ keySignatureConflict: 10 });

    const conflicts = solfa.keyRegionIssues.filter(
      (issue) => issue.kind === 'keySignatureConflict',
    );
    expect(conflicts.map((issue) => issue.measureIndex)).toEqual([
      114, 141, 148, 177, 178, 182, 186, 187, 195, 321,
    ]);
  });

  it('照合できた全ての音符が階名を得る（取りこぼしゼロ）', () => {
    expect(solfa.degreeCount).toBe(3500);
    expect(solfa.degreeCount).toBe(run.summary.notes);

    const withoutSolfa = solfa.score.measures.flatMap((measure) =>
      measure.notes.filter((note) => note.solfa === null),
    );
    expect(withoutSolfa).toEqual([]);
  });

  it('階名の分布が実測値どおりになる', () => {
    expect(solfa.syllableHistogram).toEqual({
      do: 479,
      re: 532,
      mi: 395,
      fa: 151,
      so: 568,
      la: 396,
      ti: 379,
      di: 71,
      ri: 27,
      fi: 275,
      si: 41,
      li: 18,
      ra: 9,
      me: 48,
      le: 51,
      te: 56,
      // 表にない変位は異名同音に読み替えずフォールバック表示する（機能設計書の決定事項）
      'ti♯': 1,
      'do♭': 3,
    });
  });

  it('代表小節の階名列が実測値どおりになる', () => {
    expect(syllablesOf(solfa, 'P1', 33)).toEqual(['la', 'ti', 'do']);
    expect(syllablesOf(solfa, 'P1', 35)).toEqual(['re', 'ti', 'la']);
  });
});

describe('短調基準の切り替えは現状の実データでは効かない（既知の制約）', () => {
  // Audiveris は <key><fifths> のみを出力し <mode> を書かないため、自動生成の KeyRegion は
  // 全て長調になる。長調では La 基準と Do 基準で do の位置が変わらないため結果が一致する。
  //
  // これは「La 基準の移動ド」が**自動では効かない**ことを意味する制約であり、
  // ユーザーが調を短調に指定できるようになる ClefKeyConfirm（F-2）で解消する。
  // その時点でこのテストは「一致しなくなる」ことを期待する形へ更新する
  const run = runFixture(victoria('IMSLP19716.omr'), [
    victoria('IMSLP19716.mvt1.mxl'),
    victoria('IMSLP19716.mvt2.mxl'),
  ]);

  it('自動生成された KeyRegion が全て長調である', () => {
    const { keyRegions } = runSolfa(run);
    expect(keyRegions.every((region) => region.mode === 'major')).toBe(true);
  });

  it('La 基準と Do 基準で階名が一致する（全て長調であることの帰結）', () => {
    const la = runSolfa(run, { ...DEFAULT_SETTINGS, minorBasis: 'la' });
    const doBasis = runSolfa(run, { ...DEFAULT_SETTINGS, minorBasis: 'do' });

    expect(doBasis.syllableHistogram).toEqual(la.syllableHistogram);
  });
});
