import { describe, expect, it } from 'vitest';
import {
  diatonicIndex,
  headStepOctave,
  isKnownClefKind,
} from '../../../../src/domain/score/clefTable';
import { SELECTABLE_CLEF_KINDS } from '../../../../src/shared/types/Confirmation';

describe('clefTable', () => {
  describe('headStepOctave', () => {
    it.each([
      ['TREBLE', 'B', 4],
      ['G_CLEF', 'B', 4],
      ['TREBLE_DOWN_8', 'B', 3],
      ['BASS', 'D', 3],
      ['F_CLEF', 'D', 3],
      ['ALTO', 'C', 4],
      ['TENOR', 'A', 3],
    ] as const)('%s の中線（pitch=0）は %s%d になる', (clef, step, octave) => {
      expect(headStepOctave(0, clef)).toEqual({ step, octave });
    });

    it('pitch は下向き正のため、正の値で音が下がる（TREBLE の pitch=+2 は G4）', () => {
      expect(headStepOctave(2, 'TREBLE')).toEqual({ step: 'G', octave: 4 });
    });

    it('負の pitch で音が上がり、オクターブ繰り上がりも正しい（TREBLE の pitch=-1 は C5）', () => {
      expect(headStepOctave(-1, 'TREBLE')).toEqual({ step: 'C', octave: 5 });
    });

    it('BASS の最下線（pitch=+4）は G2 になる', () => {
      expect(headStepOctave(4, 'BASS')).toEqual({ step: 'G', octave: 2 });
    });

    it('TREBLE と TREBLE_DOWN_8 は同じ譜表位置で step が同じ・octave が1違いになる', () => {
      const treble = headStepOctave(3, 'TREBLE');
      const down8 = headStepOctave(3, 'TREBLE_DOWN_8');
      expect(treble?.step).toBe(down8?.step);
      expect((treble?.octave ?? 0) - (down8?.octave ?? 0)).toBe(1);
    });

    it('未知の clef kind では null を返す（クロスチェック不能）', () => {
      expect(headStepOctave(0, 'PERCUSSION')).toBeNull();
    });

    it('clef が null（未検出）でも null を返す', () => {
      expect(headStepOctave(0, null)).toBeNull();
    });
  });

  describe('diatonicIndex', () => {
    it.each([
      ['C', 0, 0],
      ['B', 4, 34], // TREBLE の中線
      ['D', 3, 22], // BASS の中線
      ['G', 5, 39],
    ] as const)('%s%d は C0 起点の絶対番号 %d になる', (step, octave, expected) => {
      expect(diatonicIndex(step, octave)).toBe(expected);
    });

    it('headStepOctave の逆算結果と整合する（譜表位置→幹音→絶対番号の往復）', () => {
      // TREBLE 中線 B4（=34）から pitch=-3 は 3 つ上 → 絶対番号 37（E5）
      const derived = headStepOctave(-3, 'TREBLE');
      expect(derived).toEqual({ step: 'E', octave: 5 });
      expect(derived && diatonicIndex(derived.step, derived.octave)).toBe(37);
    });
  });

  describe('isKnownClefKind', () => {
    it('定義済みの clef kind で true を返す', () => {
      expect(isKnownClefKind('TREBLE_DOWN_8')).toBe(true);
    });

    it('未知の clef kind で false を返す', () => {
      expect(isKnownClefKind('PERCUSSION')).toBe(false);
    });
  });
});

describe('確認画面の選択肢との整合', () => {
  it('確認画面で選べる音部記号はすべて domain が解釈できる', () => {
    // 片方だけを増やすと「選べるのに解釈されない値」が生まれ、訂正しても照合が直らない
    for (const kind of SELECTABLE_CLEF_KINDS) {
      expect(isKnownClefKind(kind)).toBe(true);
    }
  });
});
