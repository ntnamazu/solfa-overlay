/**
 * 元PDF の読み込みとページ描画（PDF.js の薄い包み）
 *
 * 画面部品は PDF.js の API に直接触れず、ここで定義する `PdfLoader` / `PdfDocumentHandle` だけを使う。
 * 理由は 2 つ:
 *
 * - 画面テスト（jsdom）には canvas も worker も無い。ローダーを差し替えられれば、
 *   PDF.js を持ち込まずに表示分岐・遅延描画・ジャンプを検証できる
 * - `pdfjs-dist` を**動的 import** にでき、Editor を開くまで読み込まずに済む（バンドルも分割される）
 */

/** ページの寸法（ポイント。ページの回転を適用した表示上の寸法） */
export interface PdfPageSize {
  widthPt: number;
  heightPt: number;
}

/** 描画中のページ。スクロールで離れたら `cancel` で止める */
export interface PdfRenderTask {
  promise: Promise<void>;
  cancel(): void;
}

export interface PdfDocumentHandle {
  /** 全ページの寸法（ページ枠を描画前に確保するため、読み込み時にまとめて求める） */
  pageSizes: PdfPageSize[];
  /**
   * ページをキャンバスへ描く
   *
   * @param pageIndex - 0 始まり
   * @param scale - 1pt あたりのキャンバス画素数
   */
  renderPage(pageIndex: number, canvas: HTMLCanvasElement, scale: number): PdfRenderTask;
  /** worker とページのキャッシュを解放する */
  destroy(): void;
}

export type PdfLoader = (bytes: Uint8Array) => Promise<PdfDocumentHandle>;

/** 描画のキャンセルによる失敗か（スクロールで離れただけで、エラー表示の対象ではない） */
export function isRenderCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'RenderingCancelledException';
}

/**
 * PDF.js で元PDF を読み込む
 *
 * CSP（`default-src 'self'`）を緩めずに動かすため、worker・デコーダ・標準フォントは
 * すべて同一オリジンのファイルとして配る（`electron.vite.config.ts` の `servePdfjsAssets`）。
 * PDF.js には**バイト列だけ**を渡し、URL からの読み込みは使わない（ネットワーク経路を持たない）
 */
export const loadPdfWithPdfjs: PdfLoader = async (bytes) => {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  // worker は自分の URL を基準に相対パスを解くため、文書基準の絶対 URL にして渡す
  const assetUrl = (directory: string): string =>
    new URL(`pdfjs/${directory}/`, document.baseURI).href;
  const loadingTask = pdfjs.getDocument({
    // PDF.js は受け取った配列を worker へ転送して使えなくする。呼び出し側が同じバイト列で
    // 読み直せるよう（React の再描画・StrictMode の二重実行）、複製を渡す
    data: bytes.slice(),
    wasmUrl: assetUrl('wasm'),
    standardFontDataUrl: assetUrl('standard_fonts'),
    // 埋め込みのない Helvetica / Arial の代替字形（LiberationSans）は同梱しないため、
    // OS のフォントで代替させる（`local()` 参照でありネットワークは使わない）
    useSystemFonts: true,
  });
  const document_ = await loadingTask.promise;

  const pages = await Promise.all(
    Array.from({ length: document_.numPages }, (_, index) => document_.getPage(index + 1)),
  );
  const pageSizes = pages.map((page) => {
    const viewport = page.getViewport({ scale: 1 });
    return { widthPt: viewport.width, heightPt: viewport.height };
  });

  return {
    pageSizes,
    renderPage(pageIndex, canvas, scale) {
      const page = pages[pageIndex];
      if (page === undefined) {
        return {
          promise: Promise.reject(new Error(`ページ ${pageIndex + 1} がありません`)),
          cancel: () => {},
        };
      }
      const viewport = page.getViewport({ scale });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const task = page.render({ canvas, viewport });
      return { promise: task.promise, cancel: () => task.cancel() };
    },
    destroy() {
      // v6 では文書の解放（worker の停止を含む）は読み込みタスク側が持つ
      void loadingTask.destroy();
    },
  };
};
