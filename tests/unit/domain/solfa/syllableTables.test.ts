import { describe, expect, it } from 'vitest';
import { syllableFor } from '../../../../src/domain/solfa/syllableTables';
import type { SolfaDegree } from '../../../../src/shared/types/SolfaDegree';

type Cell = [SolfaDegree['degree'], number, string];

describe('syllableTables', () => {
  describe('syllableFor（コダーイ式）', () => {
    // 機能設計書ステップ4の表の全セル
    it.each<Cell>([
      [1, 0, 'do'],
      [1, 1, 'di'],
      [2, -1, 'ra'],
      [2, 0, 're'],
      [2, 1, 'ri'],
      [3, -1, 'me'],
      [3, 0, 'mi'],
      [4, 0, 'fa'],
      [4, 1, 'fi'],
      [5, -1, 'se'],
      [5, 0, 'so'],
      [5, 1, 'si'],
      [6, -1, 'le'],
      [6, 0, 'la'],
      [6, 1, 'li'],
      [7, -1, 'te'],
      [7, 0, 'ti'],
    ])('度数%i・変位%iで%sを返す', (degree, alteration, expected) => {
      expect(syllableFor({ degree, alteration }, 'kodaly')).toBe(expected);
    });
  });

  describe('syllableFor（Tonic sol-fa 略記）', () => {
    it.each<Cell>([
      [1, 0, 'd'],
      [1, 1, 'de'],
      [2, -1, 'ra'],
      [2, 0, 'r'],
      [2, 1, 're'],
      [3, -1, 'ma'],
      [3, 0, 'm'],
      [4, 0, 'f'],
      [4, 1, 'fe'],
      [5, 0, 's'],
      [5, 1, 'se'],
      [6, 0, 'l'],
      [6, 1, 'le'],
      [7, -1, 'ta'],
      [7, 0, 't'],
    ])('度数%i・変位%iで%sを返す', (degree, alteration, expected) => {
      expect(syllableFor({ degree, alteration }, 'tonicSolfa')).toBe(expected);
    });
  });

  it('「下げた7度」はコダーイ式 te / Tonic sol-fa 略記 ta となる（両者を混用しない）', () => {
    expect(syllableFor({ degree: 7, alteration: -1 }, 'kodaly')).toBe('te');
    expect(syllableFor({ degree: 7, alteration: -1 }, 'tonicSolfa')).toBe('ta');
  });

  describe('フォールバック表示（表の空欄・重変化）', () => {
    it('表にない下げ（コダーイ式の度数1・変位-1）は do♭ になる', () => {
      expect(syllableFor({ degree: 1, alteration: -1 }, 'kodaly')).toBe('do♭');
    });

    it('表にない上げ（コダーイ式の度数3・変位+1）は mi♯ になる', () => {
      expect(syllableFor({ degree: 3, alteration: 1 }, 'kodaly')).toBe('mi♯');
    });

    it('重変化（変位+2）は do♯♯ になる', () => {
      expect(syllableFor({ degree: 1, alteration: 2 }, 'kodaly')).toBe('do♯♯');
    });

    it('重変化（変位-2）は fa♭♭ になる', () => {
      expect(syllableFor({ degree: 4, alteration: -2 }, 'kodaly')).toBe('fa♭♭');
    });

    it('Tonic sol-fa 略記で表にない下げ（度数5・変位-1）は s♭ になる', () => {
      expect(syllableFor({ degree: 5, alteration: -1 }, 'tonicSolfa')).toBe('s♭');
    });

    it('Tonic sol-fa 略記で表にない下げ（度数6・変位-1）は l♭ になる', () => {
      expect(syllableFor({ degree: 6, alteration: -1 }, 'tonicSolfa')).toBe('l♭');
    });
  });
});
