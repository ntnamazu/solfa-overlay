import type { SolfaOverlayApi } from '../preload/api';

declare global {
  interface Window {
    /** preload（contextBridge）が公開する型付きIPC API */
    solfaOverlay: SolfaOverlayApi;
  }
}

export {};
