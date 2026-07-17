/**
 * 階名の内部表現「度数＋変位」（表示文字列は SolfaEngine が導出する）
 *
 * 音節体系（コダーイ式/Tonic sol-fa略記）と短調基準（La/Do）の2軸を直交させるための表現。
 * 文字列化は表示時に syllableTables で行う（用語集「度数＋変位（SolfaDegree）」）
 */
export interface SolfaDegree {
  /** 現在の「do」を1とするダイアトニック度数 */
  degree: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  /** ダイアトニック音からの半音変位。通常 -1/0/+1、重変化で ±2（±2は文字列化時にフォールバック表示） */
  alteration: number;
}
