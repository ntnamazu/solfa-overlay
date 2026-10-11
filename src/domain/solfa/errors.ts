/**
 * 適用できない転調点の指定（曲の範囲外の小節・扱えない調号・曲頭の区切りの削除など）
 *
 * 予期されるエラー: Renderer は範囲内の小節・表にある調しか選ばせないため、ここへ来るのは
 * 画面と Main の状態の食い違い（古いスナップショットからの操作など）に限られる。
 * 編成レイヤーが捕捉して UI エラーに変換し、転調点の指定は変更しない
 */
export class KeyChangeEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyChangeEditError';
  }
}
