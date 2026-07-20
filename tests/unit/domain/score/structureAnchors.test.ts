import { describe, expect, it } from 'vitest';

import {
  movementEndMeasureIndex,
  movementFirstMeasureIndex,
} from '../../../../src/domain/score/structureAnchors';
import type {
  ResolvedMovement,
  ResolvedSystem,
} from '../../../../src/shared/types/ResolvedStructure';

function system(firstMeasureIndex: number, measureCount: number): ResolvedSystem {
  return { pageIndex: 0, systemIndex: 0, firstMeasureIndex, measureCount };
}

function movement(systems: ResolvedSystem[]): ResolvedMovement {
  return { musicXmlIndex: 0, pageIndices: [0], systems };
}

describe('movementFirstMeasureIndex', () => {
  it('段が並び順どおりなら先頭段の小節番号を返す', () => {
    expect(movementFirstMeasureIndex(movement([system(10, 4), system(14, 4)]))).toBe(10);
  });

  it('段が並び順どおりでなくても最小値を返す', () => {
    expect(movementFirstMeasureIndex(movement([system(14, 4), system(10, 4)]))).toBe(10);
  });

  it('段が 1 つもなければ +Infinity を返す（呼び出し側が空を判定する契約）', () => {
    expect(movementFirstMeasureIndex(movement([]))).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('movementEndMeasureIndex', () => {
  it('最も後ろまで伸びる段の終端を返す', () => {
    expect(movementEndMeasureIndex(movement([system(10, 4), system(14, 6)]), 0)).toBe(20);
  });

  it('段の並び順に依存しない', () => {
    expect(movementEndMeasureIndex(movement([system(14, 6), system(10, 4)]), 0)).toBe(20);
  });

  it('段が 1 つもなければ fallback をそのまま返す', () => {
    expect(movementEndMeasureIndex(movement([]), 7)).toBe(7);
  });

  it('全段が fallback より手前で終わる場合は fallback を保つ', () => {
    expect(movementEndMeasureIndex(movement([system(0, 3)]), 12)).toBe(12);
  });
});
