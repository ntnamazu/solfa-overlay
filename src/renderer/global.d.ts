import type { SolfaOverlayApi } from '../preload/api';

declare global {
  interface Window {
    /**
     * preload（contextBridge）が公開する型付きIPC API
     *
     * preload が実行されない環境（dev サーバをブラウザで直接開いた場合）では
     * 存在しないため、オプショナルとして必ずガードしてから使う
     */
    solfaOverlay?: SolfaOverlayApi;
  }
}

export {};
