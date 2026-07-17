import type { SolfaDegree } from '../../shared/types/SolfaDegree';
import type { SyllableSystem } from '../../shared/types/ProjectSettings';

type Degree = SolfaDegree['degree'];

/** 度数ごとの「変位 → 音節」対応。表にない変位は fallback で文字列化する */
type SyllableTable = Readonly<Record<Degree, Readonly<Partial<Record<number, string>>>>>;

/**
 * コダーイ式の文字列化表（機能設計書「階名計算」ステップ4）
 *
 * 幹音の7度は ti。上げは母音 i（di, ri, fi, si, li）、下げは ra/me/se/le/te
 */
export const KODALY_TABLE: SyllableTable = {
  1: { 0: 'do', 1: 'di' },
  2: { [-1]: 'ra', 0: 're', 1: 'ri' },
  3: { [-1]: 'me', 0: 'mi' },
  4: { 0: 'fa', 1: 'fi' },
  5: { [-1]: 'se', 0: 'so', 1: 'si' },
  6: { [-1]: 'le', 0: 'la', 1: 'li' },
  7: { [-1]: 'te', 0: 'ti' },
};

/**
 * Tonic sol-fa 略記（Curwen式）の文字列化表（機能設計書「階名計算」ステップ4）
 *
 * 幹音の7度は te（略記 t）。上げは母音 e（de, re, fe, se, le）、下げは母音 a（ra, ma, ta）。
 * 「下げた7度」はコダーイ式 te / Tonic sol-fa 略記 ta となる点に注意（両者を混用しない）
 */
export const TONIC_SOLFA_TABLE: SyllableTable = {
  1: { 0: 'd', 1: 'de' },
  2: { [-1]: 'ra', 0: 'r', 1: 're' },
  3: { [-1]: 'ma', 0: 'm' },
  4: { 0: 'f', 1: 'fe' },
  5: { 0: 's', 1: 'se' },
  6: { 0: 'l', 1: 'le' },
  7: { [-1]: 'ta', 0: 't' },
};

const TABLES: Readonly<Record<SyllableSystem, SyllableTable>> = {
  kodaly: KODALY_TABLE,
  tonicSolfa: TONIC_SOLFA_TABLE,
};

/**
 * 度数＋変位を音節体系に従って文字列化する
 *
 * 表の空欄・稀な変位（重変化含む）は異名同音に読み替えず、
 * 変位0の音節＋変位記号でフォールバック表示する（例: do♯♯。機能設計書の決定事項）
 */
export function syllableFor(solfa: SolfaDegree, system: SyllableSystem): string {
  const row = TABLES[system][solfa.degree];
  const cell = row[solfa.alteration];
  if (cell !== undefined) {
    return cell;
  }
  const base = row[0];
  /* v8 ignore start -- 全度数で変位0のセルは定義済みのため到達しない防御ガード */
  if (base === undefined) {
    throw new Error(`syllable table has no base cell for degree ${solfa.degree}`);
  }
  /* v8 ignore stop */
  const mark = solfa.alteration > 0 ? '♯' : '♭';
  return base + mark.repeat(Math.abs(solfa.alteration));
}
