import type { SolfaOverlayApi } from '../preload/api';

/**
 * preload が公開した API を取得する
 *
 * ブラウザで dev サーバを直接開いた場合は preload が実行されず存在しない。
 * 落とさずプレビュー表示へ切り替えられるよう、`null` を返して呼び出し側にガードさせる
 */
export function getApi(): SolfaOverlayApi | null {
  return window.solfaOverlay ?? null;
}
