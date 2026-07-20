/**
 * 編成レイヤーが投げる操作エラー
 *
 * IPC 越しに例外を投げるとクラス情報が失われるため、`toIpcError` が種別へ翻訳する。
 * 「何が起きたか」ではなく**ユーザーが次に何をすれば直るか**で種別を分ける
 * （`ProjectFileError` の `reason` と同じ方針）。
 */

/**
 * 音部記号・調の確認が完了していない状態で、確認後にしかできない操作を呼んだ
 *
 * UI はボタンを無効化して防いでいるが、訂正操作と出力操作が競合したときなど
 * Renderer 側の状態が一瞬古くなる経路がある。汎用 `Error` にすると IPC 越しでは
 * 「想定外のエラー」に丸められ、**確認画面へ戻る**という回復手段を案内できない
 */
export class ConfirmationRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfirmationRequiredError';
  }
}
