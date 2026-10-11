import type { KeyChange, KeyChangeEdit } from '../../shared/types/KeyRegion';
import { KeyChangeEditError } from './errors';
import { tonicForFifths } from './keyTable';

/** 転調点の編集の検証・解釈に要る文脈 */
export interface KeyChangeEditContext {
  /** 曲の小節数（通し小節番号の終端）。指定できる小節は 0〜measureCount-1 */
  measureCount: number;
  /**
   * 自動判定の区切りが始まる小節（指定を反映する前。`KeyRegionBuildResult.detectedKeyRegions`）
   *
   * 削除の保存のされ方と「自動判定に戻す」の可否を決める
   */
  detectedMeasures: ReadonlySet<number>;
}

/**
 * 転調点の編集を 1 件適用した、新しい指定の列を返す（F-6・純関数）
 *
 * 1 小節につき指定は 1 件で、結果は小節順に並べる。
 * 区間そのものの組み立て（挿入・上書き・削除・隣接の統合）は `KeyRegionBuilder` が
 * 解析のたびに行い、ここでは**ユーザー判断の列**を更新するだけにする
 * （解析結果のキャッシュである `keyRegions` を直接書き換えると、再解析で指定が消える）
 *
 * - `set`: 同じ小節の指定を置き換える
 * - `remove`: 自動判定の区切りがある小節は `remove` を残してその区切りを取り除く。
 *   無い小節（書き足した転調点）は指定の記録を消すだけにする（`remove` を残すと、
 *   取り除く区切りが無いため解析のたびに `unmatchedKeyChange` として報告されてしまう）
 * - `revert`: 指定の記録を消し、自動判定（無ければ前の区間の調）に戻す
 *
 * @throws KeyChangeEditError 曲の範囲外の小節・扱えない調号・曲頭の区切りの削除・
 *   その小節に取り除く区切りや取り消す指定が無い場合
 */
export function applyKeyChangeEdit(
  keyChanges: readonly KeyChange[],
  edit: KeyChangeEdit,
  context: KeyChangeEditContext,
): KeyChange[] {
  validateMeasure(edit.measureIndex, context.measureCount);
  const { measureIndex } = edit;
  const current = keyChanges.find((change) => change.measureIndex === measureIndex);
  const others = keyChanges.filter((change) => change.measureIndex !== measureIndex);
  const detected = context.detectedMeasures.has(measureIndex);

  switch (edit.kind) {
    case 'set':
      if (tonicForFifths(edit.fifths, edit.mode) === null) {
        throw new KeyChangeEditError('扱えない調が指定されました。画面を開き直してください');
      }
      return sorted([...others, edit]);
    case 'remove': {
      // 曲頭の区切りは「先頭要素は曲頭に必ず存在する」制約そのもの。消すと調文脈が組めない
      if (measureIndex === 0) {
        throw new KeyChangeEditError('曲の始まりの調は削除できません。調を選び直してください');
      }
      // 今その小節に区切りがあるのは「指定で置いた」か「自動判定の区切りを取り除いていない」とき
      const hasRegion = current?.kind === 'set' || (detected && current === undefined);
      if (!hasRegion) {
        throw new KeyChangeEditError(
          `${measureIndex + 1} 小節目に転調点はありません。画面を開き直してください`,
        );
      }
      return detected ? sorted([...others, edit]) : others;
    }
    case 'revert':
      if (current === undefined) {
        throw new KeyChangeEditError(
          `${measureIndex + 1} 小節目の調は自動判定のままです。画面を開き直してください`,
        );
      }
      return others;
  }
}

function sorted(keyChanges: KeyChange[]): KeyChange[] {
  return keyChanges.sort((a, b) => a.measureIndex - b.measureIndex);
}

function validateMeasure(measureIndex: number, measureCount: number): void {
  // 整数でない値は小節番号として読めないため、文言に数を出さない（「NaN 小節目」を見せない）
  if (!Number.isInteger(measureIndex)) {
    throw new KeyChangeEditError('指定された小節が分かりません。画面を開き直してください');
  }
  if (measureIndex < 0 || measureIndex >= measureCount) {
    throw new KeyChangeEditError(
      `${measureIndex + 1} 小節目は曲の範囲外です。画面を開き直してください`,
    );
  }
}
