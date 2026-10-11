import type { PitchStep } from '../types/Pitch';

/**
 * 調号（fifths）→ 主音の対応表（旋法ごと）
 *
 * MusicXML の `<key><fifths>` は ♯を正・♭を負の数で表す。長調の主音は五度圏そのもので、
 * 短調の主音は同じ調号を持つ平行短調（長調主音の短3度下）になる。
 * 異名同音の書き分けが必要なため（例: fifths=-7 は B♮ ではなく C♭）、導出ではなく表で持つ。
 *
 * **shared に置く理由**: 主音の解決（`domain/solfa/keyTable.ts`）だけでなく、Editor の転調点の
 * 指定（F-6）で調の選択肢を並べる Renderer も同じ表を要る。Renderer は domain を import できず
 * （アーキテクチャ設計書の依存方向）、表は定数のため shared に置ける。引く関数は domain に残す
 */
export const KEY_SIGNATURE_TONICS: Readonly<
  Record<'major' | 'minor', Readonly<Record<number, { step: PitchStep; alter: number }>>>
> = {
  /** 長調の主音（C♭ … C♯） */
  major: {
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
  },
  /** 短調の主音（平行短調。a♭ … a♯） */
  minor: {
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
  },
};
