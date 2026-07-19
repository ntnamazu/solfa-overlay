import type { ResolvedMovement } from '../../shared/types/ResolvedStructure';

/**
 * 確定構造から通し小節番号の基準値を求める純粋関数群
 *
 * `ScoreModelBuilder`（照合）と `KeyRegionBuilder`（調文脈）は、どちらも
 * 「MusicXML の movement ローカル小節番号 → 通し小節番号」の変換を必要とする。
 * 片方だけ計算を変えると照合結果と調文脈の小節番号が静かにずれるため、基準値の導出は 1 箇所に集約する
 */

/**
 * movement の先頭小節（通し小節番号）
 *
 * 段の並び順に依存しないよう最小値を採る。段が 1 つもない movement では
 * `Number.POSITIVE_INFINITY` を返すため、呼び出し側は `systems.length > 0` を確認してから使う
 */
export function movementFirstMeasureIndex(movement: ResolvedMovement): number {
  return movement.systems.reduce(
    (min, system) => Math.min(min, system.firstMeasureIndex),
    Number.POSITIVE_INFINITY,
  );
}

/**
 * movement の終端（最後の小節の次の通し小節番号）
 *
 * @param fallback - 段が 1 つもないときに返す値（直前の movement の終端を引き継ぐ用途）
 */
export function movementEndMeasureIndex(movement: ResolvedMovement, fallback: number): number {
  return movement.systems.reduce(
    (end, system) => Math.max(end, system.firstMeasureIndex + system.measureCount),
    fallback,
  );
}
