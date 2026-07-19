import { describe, expect, it } from 'vitest';

import {
  MAJOR_TONICS,
  MAX_FIFTHS,
  MIN_FIFTHS,
  MINOR_TONICS,
  tonicForFifths,
} from '../../../../src/domain/solfa/keyTable';
import type { KeyTonic } from '../../../../src/domain/solfa/keyTable';
import { resolveDo } from '../../../../src/domain/solfa/SolfaEngine';
import type { KeyRegion } from '../../../../src/shared/types/KeyRegion';

const ALL_FIFTHS = Array.from(
  { length: MAX_FIFTHS - MIN_FIFTHS + 1 },
  (_, i) => MIN_FIFTHS + i,
);

/** 期待表（五度圏。異名同音の書き分けを含む） */
const EXPECTED: readonly (readonly [number, string, string])[] = [
  [-7, 'C♭', 'A♭'],
  [-6, 'G♭', 'E♭'],
  [-5, 'D♭', 'B♭'],
  [-4, 'A♭', 'F'],
  [-3, 'E♭', 'C'],
  [-2, 'B♭', 'G'],
  [-1, 'F', 'D'],
  [0, 'C', 'A'],
  [1, 'G', 'E'],
  [2, 'D', 'B'],
  [3, 'A', 'F♯'],
  [4, 'E', 'C♯'],
  [5, 'B', 'G♯'],
  [6, 'F♯', 'D♯'],
  [7, 'C♯', 'A♯'],
];

function format(tonic: KeyTonic | null | undefined): string {
  if (tonic === null || tonic === undefined) {
    return '(none)';
  }
  const mark = tonic.alter > 0 ? '♯' : '♭';
  return tonic.step + mark.repeat(Math.abs(tonic.alter));
}

function regionOf(tonic: KeyTonic, mode: 'major' | 'minor'): KeyRegion {
  return {
    id: 'k',
    start: { measureIndex: 0, offset: 0 },
    tonicStep: tonic.step,
    tonicAlter: tonic.alter,
    mode,
    source: 'auto',
  };
}

describe('MAJOR_TONICS / MINOR_TONICS', () => {
  it.each(EXPECTED)('fifths=%i の長調主音は %s・短調主音は %s', (fifths, major, minor) => {
    expect(format(MAJOR_TONICS[fifths])).toBe(major);
    expect(format(MINOR_TONICS[fifths])).toBe(minor);
  });

  it('五度圏の全域（-7〜+7）を欠けなく定義している', () => {
    for (const fifths of ALL_FIFTHS) {
      expect(MAJOR_TONICS[fifths]).toBeDefined();
      expect(MINOR_TONICS[fifths]).toBeDefined();
    }
  });
});

describe('検算: 短調表は長調表の平行短調である', () => {
  // 平行短調の主音は長調主音の短3度下 = SolfaEngine の resolveDo(minor, 'la') の逆向き。
  // ここが食い違うと KeyRegionBuilder が作る調と SolfaEngine が解釈する調がずれる
  it.each(ALL_FIFTHS)('fifths=%i で resolveDo(短調, La基準) が長調主音に一致する', (fifths) => {
    const minor = MINOR_TONICS[fifths];
    const major = MAJOR_TONICS[fifths];
    expect(minor).toBeDefined();
    expect(major).toBeDefined();
    if (minor === undefined || major === undefined) {
      return;
    }
    expect(resolveDo(regionOf(minor, 'minor'), 'la')).toEqual(major);
  });

  it.each(ALL_FIFTHS)('fifths=%i で長調は Do 位置が主音そのものになる', (fifths) => {
    const major = MAJOR_TONICS[fifths];
    expect(major).toBeDefined();
    if (major === undefined) {
      return;
    }
    expect(resolveDo(regionOf(major, 'major'), 'la')).toEqual(major);
  });
});

describe('tonicForFifths', () => {
  it('長調・短調をそれぞれの表から引く', () => {
    expect(tonicForFifths(2, 'major')).toEqual({ step: 'D', alter: 0 });
    expect(tonicForFifths(2, 'minor')).toEqual({ step: 'B', alter: 0 });
  });

  it('五度圏の範囲外は null を返す（例外にしない）', () => {
    expect(tonicForFifths(8, 'major')).toBeNull();
    expect(tonicForFifths(-8, 'minor')).toBeNull();
    expect(tonicForFifths(99, 'major')).toBeNull();
  });

  it('整数でない fifths は null を返す', () => {
    expect(tonicForFifths(1.5, 'major')).toBeNull();
    expect(tonicForFifths(Number.NaN, 'major')).toBeNull();
  });
});
