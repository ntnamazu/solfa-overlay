/**
 * 適用できない注釈の編集（存在しない注釈・空の文字・対応するページが無い位置など）
 *
 * 予期されるエラー: Renderer は入力を制限しているため、ここへ来るのは画面と Main の状態の
 * 食い違い（古いスナップショットからの操作など）に限られる。編成レイヤーが捕捉して
 * UI エラーに変換し、注釈列は変更しない
 */
export class AnnotationEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnnotationEditError';
  }
}
