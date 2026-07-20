import type { PitchStep } from '../../shared/types/Pitch';

/**
 * 調号（fifths）→ 主音の対応表
 *
 * MusicXML の `<key><fifths>` は ♯を正・♭を負の数で表す。長調の主音は五度圏そのもので、
 * 短調の主音は同じ調号を持つ平行短調（長調主音の短3度下）になる。
 * 異名同音の書き分けが必要なため（例: fifths=-7 は B♮ ではなく C♭）、導出ではなく表で持つ
 */

/** 調の主音（オクターブに依存しないため step + alter のみ。`DoPitch` と同じ形） */
export interface KeyTonic {
  step: PitchStep;
  alter: number;
}

/** 扱える調号の範囲（五度圏の両端。これを超える調号は実用上存在しない） */
export const MIN_FIFTHS = -7;
export const MAX_FIFTHS = 7;

/** 長調の主音（C♭ … C♯） */
export const MAJOR_TONICS: Readonly<Record<number, KeyTonic>> = {
  [-7]: { step: 'C', alter: -1 },
  [-6]: { step: 'G', alter: -1 },
  [-5]: { step: 'D', alter: -1 },
  [-4]: { step: 'A', alter: -1 },
  [-3]: { step: 'E', alter: -1 },
  [-2]: { step: 'B', alter: -1 },
  [-1]: { step: 'F', alter: 0 },
  0: { step: 'C', alter: 0 },
  1: { step: 'G', alter: 0 },
  2: { step: 'D', alter: 0 },
  3: { step: 'A', alter: 0 },
  4: { step: 'E', alter: 0 },
  5: { step: 'B', alter: 0 },
  6: { step: 'F', alter: 1 },
  7: { step: 'C', alter: 1 },
};

/** 短調の主音（平行短調。a♭ … a♯） */
export const MINOR_TONICS: Readonly<Record<number, KeyTonic>> = {
  [-7]: { step: 'A', alter: -1 },
  [-6]: { step: 'E', alter: -1 },
  [-5]: { step: 'B', alter: -1 },
  [-4]: { step: 'F', alter: 0 },
  [-3]: { step: 'C', alter: 0 },
  [-2]: { step: 'G', alter: 0 },
  [-1]: { step: 'D', alter: 0 },
  0: { step: 'A', alter: 0 },
  1: { step: 'E', alter: 0 },
  2: { step: 'B', alter: 0 },
  3: { step: 'F', alter: 1 },
  4: { step: 'C', alter: 1 },
  5: { step: 'G', alter: 1 },
  6: { step: 'D', alter: 1 },
  7: { step: 'A', alter: 1 },
};

/**
 * 調号と旋法から主音を引く
 *
 * @returns 範囲外（|fifths| > 7）や整数でない fifths では `null`。
 *   呼び出し側が「認識エラーとして報告し、直前の調を維持する」判断をするため、例外にはしない
 */
export function tonicForFifths(fifths: number, mode: 'major' | 'minor'): KeyTonic | null {
  if (!Number.isInteger(fifths) || fifths < MIN_FIFTHS || fifths > MAX_FIFTHS) {
    return null;
  }
  // 範囲内の fifths は必ず表に存在する（テストで全域の定義を検証済み）
  return (mode === 'major' ? MAJOR_TONICS : MINOR_TONICS)[fifths] ?? /* v8 ignore next */ null;
}

/**
 * 主音と旋法から調号を逆引きする（`tonicForFifths` の逆写像）
 *
 * `KeyRegion` は調号ではなく主音を保持するため、ユーザーが旋法だけを訂正したときに
 * 「調号を保ったまま平行調へ移す」には元の調号を復元する必要がある
 * （例: ハ長調の区間に `mode: 'minor'` を指定 → 同じ調号のイ短調になる）
 *
 * @returns 表にない主音・旋法の組み合わせでは `null`
 */
export function fifthsForTonic(tonic: KeyTonic, mode: 'major' | 'minor'): number | null {
  const table = mode === 'major' ? MAJOR_TONICS : MINOR_TONICS;
  for (const [fifths, candidate] of Object.entries(table)) {
    if (candidate.step === tonic.step && candidate.alter === tonic.alter) {
      return Number(fifths);
    }
  }
  return null;
}
