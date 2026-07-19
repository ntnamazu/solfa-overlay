import type { PitchStep } from '../../shared/types/Pitch';

/** C0 起点の絶対幹音番号で使うレター順（C=0, D=1, ... B=6） */
const LETTERS: readonly PitchStep[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/**
 * Audiveris の clef kind → 譜表中線の音（stepIndex は LETTERS の添字）
 *
 * TREBLE の中線は B4、BASS は D3、ALTO は C4、TENOR は A3。
 * TREBLE_DOWN_8（オクターブ下ト音記号。テノールで頻出）は B3（プロトタイプ CLEF_MIDDLE と同値）
 */
const CLEF_MIDDLE_LINE: Readonly<Record<string, { stepIndex: number; octave: number }>> = {
  TREBLE: { stepIndex: 6, octave: 4 },
  G_CLEF: { stepIndex: 6, octave: 4 },
  TREBLE_DOWN_8: { stepIndex: 6, octave: 3 },
  BASS: { stepIndex: 1, octave: 3 },
  F_CLEF: { stepIndex: 1, octave: 3 },
  ALTO: { stepIndex: 0, octave: 4 },
  TENOR: { stepIndex: 5, octave: 3 },
};

/**
 * .omr の符頭の譜表位置から幹音（step + octave）を逆算する
 *
 * Audiveris の符頭 pitch は「中線=0・下向き正」（Audiveris仕様）のため、
 * 絶対幹音番号（C0 起点）では中線から pitch を引く方向になる
 *
 * @param headPitch - 符頭の譜表位置（中線=0・下向き正）
 * @param clefKind - Audiveris の clef kind。未知・null ならチェック不能として null
 * @returns 幹音と octave。clef が未知なら null
 */
export function headStepOctave(
  headPitch: number,
  clefKind: string | null,
): { step: PitchStep; octave: number } | null {
  if (clefKind === null) {
    return null;
  }
  const middle = CLEF_MIDDLE_LINE[clefKind];
  if (middle === undefined) {
    return null;
  }
  const absIndex = middle.octave * 7 + middle.stepIndex - headPitch;
  const step = LETTERS[((absIndex % 7) + 7) % 7];
  /* v8 ignore start -- mod 7 により添字は常に 0〜6 のため到達しない防御ガード */
  if (step === undefined) {
    throw new Error(`unreachable: invalid letter index ${absIndex}`);
  }
  /* v8 ignore stop */
  return { step, octave: Math.floor(absIndex / 7) };
}

/** ScoreModelBuilder が clef 妥当性を issue 化する際の判定に使う */
export function isKnownClefKind(clefKind: string): boolean {
  return clefKind in CLEF_MIDDLE_LINE;
}

/**
 * 幹音の絶対番号（C0 起点。C0=0, D0=1, ... B4=34）
 *
 * 譜表上の縦位置と一対一（臨時記号は位置を動かさない）のため、同時に鳴る音群（列）内で
 * 符頭と音符を縦順に対付けするキーに使う（ScoreModelBuilder の列対付け）
 */
export function diatonicIndex(step: PitchStep, octave: number): number {
  return octave * 7 + LETTERS.indexOf(step);
}
