import { describe, expect, it } from 'vitest';
import {
  SolfaEngine,
  computeDegree,
  expectedAlterInDoMajor,
  letterDistance,
  resolveDo,
} from '../../../../src/domain/solfa/SolfaEngine';
import { DEFAULT_SETTINGS } from '../../../../src/shared/constants/DEFAULT_SETTINGS';
import type { KeyRegion } from '../../../../src/shared/types/KeyRegion';
import type { Pitch, PitchStep } from '../../../../src/shared/types/Pitch';

function keyRegion(partial: {
  tonicStep: PitchStep;
  tonicAlter?: number;
  mode: 'major' | 'minor';
}): KeyRegion {
  return {
    id: 'test-region',
    start: { measureIndex: 0, offset: 0 },
    tonicStep: partial.tonicStep,
    tonicAlter: partial.tonicAlter ?? 0,
    mode: partial.mode,
    source: 'auto',
  };
}

function pitch(step: PitchStep, alter: number, octave = 4): Pitch {
  return { step, alter, octave };
}

const SHARP_ORDER: readonly PitchStep[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER: readonly PitchStep[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** 長調の主音 → 調号（♯なら正・♭なら負の個数） */
const MAJOR_KEY_SIGNATURES: readonly {
  name: string;
  doStep: PitchStep;
  doAlter: number;
  signature: number;
}[] = [
  { name: 'ハ長調 (C)', doStep: 'C', doAlter: 0, signature: 0 },
  { name: 'ト長調 (G)', doStep: 'G', doAlter: 0, signature: 1 },
  { name: 'ニ長調 (D)', doStep: 'D', doAlter: 0, signature: 2 },
  { name: 'イ長調 (A)', doStep: 'A', doAlter: 0, signature: 3 },
  { name: 'ホ長調 (E)', doStep: 'E', doAlter: 0, signature: 4 },
  { name: 'ロ長調 (B)', doStep: 'B', doAlter: 0, signature: 5 },
  { name: '嬰ヘ長調 (F♯)', doStep: 'F', doAlter: 1, signature: 6 },
  { name: '嬰ハ長調 (C♯)', doStep: 'C', doAlter: 1, signature: 7 },
  { name: 'ヘ長調 (F)', doStep: 'F', doAlter: 0, signature: -1 },
  { name: '変ロ長調 (B♭)', doStep: 'B', doAlter: -1, signature: -2 },
  { name: '変ホ長調 (E♭)', doStep: 'E', doAlter: -1, signature: -3 },
  { name: '変イ長調 (A♭)', doStep: 'A', doAlter: -1, signature: -4 },
  { name: '変ニ長調 (D♭)', doStep: 'D', doAlter: -1, signature: -5 },
  { name: '変ト長調 (G♭)', doStep: 'G', doAlter: -1, signature: -6 },
  { name: '変ハ長調 (C♭)', doStep: 'C', doAlter: -1, signature: -7 },
];

/** 調号（♯♭の個数）から各幹音の変位を引く */
function signatureAlterOf(letter: PitchStep, signature: number): number {
  if (signature > 0) {
    return SHARP_ORDER.slice(0, signature).includes(letter) ? 1 : 0;
  }
  return FLAT_ORDER.slice(0, -signature).includes(letter) ? -1 : 0;
}

describe('SolfaEngine', () => {
  describe('expectedAlterInDoMajor', () => {
    // 機能設計書の検算規定: 結果は do を主音とする長調の調号と必ず一致する
    it.each(MAJOR_KEY_SIGNATURES)(
      '$name の期待変位が調号と一致する',
      ({ doStep, doAlter, signature }) => {
        const doPitch = { step: doStep, alter: doAlter };
        for (const letter of SHARP_ORDER) {
          const degree = letterDistance(doStep, letter);
          expect(expectedAlterInDoMajor(doPitch, degree)).toBe(
            signatureAlterOf(letter, signature),
          );
        }
      },
    );
  });

  describe('resolveDo', () => {
    it('長調では主音がそのまま do になる', () => {
      expect(resolveDo(keyRegion({ tonicStep: 'E', tonicAlter: -1, mode: 'major' }), 'la')).toEqual(
        { step: 'E', alter: -1 },
      );
    });

    it('Do基準短調では主音がそのまま do になる', () => {
      expect(resolveDo(keyRegion({ tonicStep: 'A', mode: 'minor' }), 'do')).toEqual({
        step: 'A',
        alter: 0,
      });
    });

    // La基準短調の do = 平行長調の主音（同じ調号を持つ長調）
    it.each<{ name: string; tonicStep: PitchStep; tonicAlter: number; doStep: PitchStep; doAlter: number }>(
      [
        { name: 'イ短調 → C', tonicStep: 'A', tonicAlter: 0, doStep: 'C', doAlter: 0 },
        { name: 'ホ短調 → G', tonicStep: 'E', tonicAlter: 0, doStep: 'G', doAlter: 0 },
        { name: 'ロ短調 → D', tonicStep: 'B', tonicAlter: 0, doStep: 'D', doAlter: 0 },
        { name: '嬰ヘ短調 → A', tonicStep: 'F', tonicAlter: 1, doStep: 'A', doAlter: 0 },
        { name: '嬰ハ短調 → E', tonicStep: 'C', tonicAlter: 1, doStep: 'E', doAlter: 0 },
        { name: '嬰ト短調 → B', tonicStep: 'G', tonicAlter: 1, doStep: 'B', doAlter: 0 },
        { name: '嬰ニ短調 → F♯', tonicStep: 'D', tonicAlter: 1, doStep: 'F', doAlter: 1 },
        { name: '嬰イ短調 → C♯', tonicStep: 'A', tonicAlter: 1, doStep: 'C', doAlter: 1 },
        { name: 'ニ短調 → F', tonicStep: 'D', tonicAlter: 0, doStep: 'F', doAlter: 0 },
        { name: 'ト短調 → B♭', tonicStep: 'G', tonicAlter: 0, doStep: 'B', doAlter: -1 },
        { name: 'ハ短調 → E♭', tonicStep: 'C', tonicAlter: 0, doStep: 'E', doAlter: -1 },
        { name: 'ヘ短調 → A♭', tonicStep: 'F', tonicAlter: 0, doStep: 'A', doAlter: -1 },
        { name: '変ロ短調 → D♭', tonicStep: 'B', tonicAlter: -1, doStep: 'D', doAlter: -1 },
        { name: '変ホ短調 → G♭', tonicStep: 'E', tonicAlter: -1, doStep: 'G', doAlter: -1 },
        { name: '変イ短調 → C♭', tonicStep: 'A', tonicAlter: -1, doStep: 'C', doAlter: -1 },
      ],
    )('La基準短調: $name', ({ tonicStep, tonicAlter, doStep, doAlter }) => {
      expect(resolveDo(keyRegion({ tonicStep, tonicAlter, mode: 'minor' }), 'la')).toEqual({
        step: doStep,
        alter: doAlter,
      });
    });
  });

  describe('computeDegree', () => {
    it('ト長調のF♮を度数7・変位-1として計算する', () => {
      const region = keyRegion({ tonicStep: 'G', mode: 'major' });
      expect(computeDegree(pitch('F', 0), region, 'la')).toEqual({ degree: 7, alteration: -1 });
    });

    it('イ短調La基準では do が C になる', () => {
      const region = keyRegion({ tonicStep: 'A', mode: 'minor' });
      expect(computeDegree(pitch('C', 0), region, 'la')).toEqual({ degree: 1, alteration: 0 });
    });

    it('ニ長調のC♮を度数7・変位-1として計算する', () => {
      const region = keyRegion({ tonicStep: 'D', mode: 'major' });
      expect(computeDegree(pitch('C', 0), region, 'la')).toEqual({ degree: 7, alteration: -1 });
    });

    it('変ホ長調のB♮を度数5・変位+1として計算する', () => {
      const region = keyRegion({ tonicStep: 'E', tonicAlter: -1, mode: 'major' });
      expect(computeDegree(pitch('B', 0), region, 'la')).toEqual({ degree: 5, alteration: 1 });
    });

    it('嬰ヘ長調のE♯を度数7・変位0として計算する', () => {
      const region = keyRegion({ tonicStep: 'F', tonicAlter: 1, mode: 'major' });
      expect(computeDegree(pitch('E', 1), region, 'la')).toEqual({ degree: 7, alteration: 0 });
    });

    it('イ短調La基準のG♯（導音）を度数5・変位+1として計算する', () => {
      const region = keyRegion({ tonicStep: 'A', mode: 'minor' });
      expect(computeDegree(pitch('G', 1), region, 'la')).toEqual({ degree: 5, alteration: 1 });
    });

    // 2軸直交の担保: 同じ音が La基準では do/fa/so、Do基準では me/le/te 相当になる
    describe('La基準⇔Do基準の読み替え（イ短調の C/F/G）', () => {
      const region = keyRegion({ tonicStep: 'A', mode: 'minor' });

      it.each<{ step: PitchStep; la: [number, number]; doBasis: [number, number] }>([
        { step: 'C', la: [1, 0], doBasis: [3, -1] },
        { step: 'F', la: [4, 0], doBasis: [6, -1] },
        { step: 'G', la: [5, 0], doBasis: [7, -1] },
      ])('$step: La基準 $la / Do基準 $doBasis', ({ step, la, doBasis }) => {
        expect(computeDegree(pitch(step, 0), region, 'la')).toEqual({
          degree: la[0],
          alteration: la[1],
        });
        expect(computeDegree(pitch(step, 0), region, 'do')).toEqual({
          degree: doBasis[0],
          alteration: doBasis[1],
        });
      });
    });
  });

  describe('SolfaEngine クラス', () => {
    it('計算から文字列化まで一貫して動作する（ト長調F♮ → te）', () => {
      const engine = new SolfaEngine();
      const region = keyRegion({ tonicStep: 'G', mode: 'major' });
      const degree = engine.computeDegree(pitch('F', 0), region, DEFAULT_SETTINGS.minorBasis);
      expect(engine.toSyllable(degree, DEFAULT_SETTINGS)).toBe('te');
      expect(engine.toSyllable(degree, { ...DEFAULT_SETTINGS, syllableSystem: 'tonicSolfa' })).toBe(
        'ta',
      );
    });
  });
});
