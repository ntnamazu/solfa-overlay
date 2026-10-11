import { describe, expect, it } from 'vitest';

import { KeyChangeEditError } from '../../../../src/domain/solfa/errors';
import { applyKeyChangeEdit } from '../../../../src/domain/solfa/keyChanges';
import type { KeyChange, KeyChangeEdit } from '../../../../src/shared/types/KeyRegion';

/** 20 小節の曲。自動判定の区切りは曲頭と 10 小節目（添字） */
const context = { measureCount: 20, detectedMeasures: new Set([0, 10]) };

const set = (measureIndex: number, fifths = 1): KeyChange => ({
  kind: 'set',
  measureIndex,
  fifths,
  mode: 'major',
});

const edit = (keyChanges: KeyChange[], change: KeyChangeEdit) =>
  applyKeyChangeEdit(keyChanges, change, context);

describe('applyKeyChangeEdit: set', () => {
  it('指定を追加し、小節順に並べる', () => {
    expect(edit([set(10)], { kind: 'set', measureIndex: 4, fifths: 0, mode: 'minor' })).toEqual([
      { kind: 'set', measureIndex: 4, fifths: 0, mode: 'minor' },
      set(10),
    ]);
  });

  it('同じ小節の指定は置き換える（自動判定の区切りを取り除いた小節にも置き直せる）', () => {
    expect(edit([set(10)], set(10, -3))).toEqual([set(10, -3)]);
    expect(edit([{ kind: 'remove', measureIndex: 10 }], set(10, 2))).toEqual([set(10, 2)]);
  });

  it('元の配列は変更しない', () => {
    const existing = [set(10)];
    edit(existing, set(4));
    expect(existing).toEqual([set(10)]);
  });

  it('曲頭の調は選び直せる', () => {
    expect(edit([], set(0, 2))).toEqual([set(0, 2)]);
  });

  it.each([8, -8, 0.5])('扱えない調号 %s は拒否する', (fifths) => {
    expect(() => edit([], set(3, fifths))).toThrow(KeyChangeEditError);
  });
});

describe('applyKeyChangeEdit: remove', () => {
  it('書き足した転調点（自動判定の区切りが無い小節）の削除は、指定の記録を消すだけにする', () => {
    // remove を残すと、取り除く区切りが無いため毎回「適用できなかった指定」になる（レビュー #1）
    expect(edit([set(4), set(10)], { kind: 'remove', measureIndex: 4 })).toEqual([set(10)]);
  });

  it('自動判定の区切りの削除は remove を残す', () => {
    expect(edit([], { kind: 'remove', measureIndex: 10 })).toEqual([
      { kind: 'remove', measureIndex: 10 },
    ]);
  });

  it('自動判定の区切りを上書きした小節の削除は、区切りごと取り除く（remove に置き換える）', () => {
    expect(edit([set(10, 2)], { kind: 'remove', measureIndex: 10 })).toEqual([
      { kind: 'remove', measureIndex: 10 },
    ]);
  });

  it('曲頭の区切りは削除できない', () => {
    expect(() => edit([set(0)], { kind: 'remove', measureIndex: 0 })).toThrow(
      '曲の始まりの調は削除できません',
    );
  });

  it.each([
    { name: '区切りの無い小節', keyChanges: [] },
    { name: '取り除き済みの自動判定の区切り', keyChanges: [{ kind: 'remove', measureIndex: 10 }] },
  ] satisfies { name: string; keyChanges: KeyChange[] }[])(
    '$name の削除は拒否する',
    ({ keyChanges }) => {
      const measureIndex = keyChanges.length === 0 ? 4 : 10;
      expect(() => edit(keyChanges, { kind: 'remove', measureIndex })).toThrow(
        `${measureIndex + 1} 小節目に転調点はありません`,
      );
    },
  );
});

describe('applyKeyChangeEdit: revert（自動判定に戻す）', () => {
  it.each([
    { name: '上書きした自動判定の区切り', current: set(10, 2) },
    { name: '取り除いた自動判定の区切り', current: { kind: 'remove', measureIndex: 10 } },
  ] satisfies { name: string; current: KeyChange }[])('$name の指定を消す', ({ current }) => {
    expect(edit([set(4), current], { kind: 'revert', measureIndex: 10 })).toEqual([set(4)]);
  });

  it('指定の無い小節は拒否する', () => {
    expect(() => edit([], { kind: 'revert', measureIndex: 10 })).toThrow(
      '11 小節目の調は自動判定のままです',
    );
  });
});

describe('applyKeyChangeEdit: 小節の検証', () => {
  it.each([-1, 20])('範囲外の小節 %s は拒否する', (measureIndex) => {
    for (const change of [
      set(measureIndex),
      { kind: 'remove', measureIndex },
      { kind: 'revert', measureIndex },
    ] satisfies KeyChangeEdit[]) {
      expect(() => edit([], change)).toThrow(`${measureIndex + 1} 小節目は曲の範囲外です`);
    }
  });

  it.each([1.5, Number.NaN])('整数でない小節 %s は数を出さずに拒否する', (measureIndex) => {
    // 「NaN 小節目」のような文言を見せない（レビュー #4）
    expect(() => edit([], set(measureIndex))).toThrow('指定された小節が分かりません');
  });
});
