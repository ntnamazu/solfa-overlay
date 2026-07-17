/** 幹音の音名（レター） */
export type PitchStep = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';

/**
 * 記譜音高（MusicXML由来）
 *
 * alter は記譜上の変位で、調号込みの実音を表す（機能設計書「データモデル定義」）
 */
export interface Pitch {
  step: PitchStep;
  /** -2〜+2（記譜上の変位。調号込みの実音） */
  alter: number;
  octave: number;
}
