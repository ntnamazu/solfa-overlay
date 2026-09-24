import { useEffect, useRef, useState } from 'react';
import type { ScorePreview } from '../../shared/types/ScorePreview';
import type { PdfDocumentHandle, PdfLoader } from './pdfDocument';
import { loadPdfWithPdfjs } from './pdfDocument';
import type { ScorePick, ScorePoint } from './ScorePage';
import { ScorePage, regionKey } from './ScorePage';

/**
 * 楽譜プレビュー（元PDF ＋ 階名注釈。機能設計書「Phase 6 で追加する」）
 *
 * 元PDF の全ページを縦に並べ、Main が確定させた重ね描き内容（`ScorePreview`）を載せる。
 * 何をどこに描くかはここでは決めない（表示文字列・座標は Main 側で出力PDFと同じ規則で確定済み）。
 * `onPick` を渡すと、押した階名・位置を編集の対象として知らせる（F-5。編集自体は Editor と Main の担当）。
 */

/** 一覧から指定されたジャンプ先（`seq` は同じ小節を続けて押したときにも反応させるための通し番号） */
export interface ScoreViewerFocus {
  partId: string;
  measureIndex: number;
  seq: number;
}

export interface ScoreViewerProps {
  /** 元PDF のバイト列（取得中は null） */
  sourcePdf: Uint8Array | null;
  /** 元PDF を取得できなかった理由（取得できていれば null） */
  sourcePdfError: string | null;
  preview: ScorePreview;
  focus: ScoreViewerFocus | null;
  /** PDF の読み込み方法（画面テストで差し替える） */
  loadPdf?: PdfLoader;
  /** 楽譜の上を押したとき（省略時は読み取り専用） */
  onPick?: (pick: ScorePick) => void;
  /** 選択中の階名の id */
  selectedAnnotationId?: string | null;
  /** 書き足そうとしている位置（元PDFのページとポイント座標） */
  pendingPoint?: (ScorePoint & { sourcePageIndex: number }) | null;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; document: PdfDocumentHandle }
  | { status: 'error'; message: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ScoreViewer({
  sourcePdf,
  sourcePdfError,
  preview,
  focus,
  loadPdf = loadPdfWithPdfjs,
  onPick,
  selectedAnnotationId = null,
  pendingPoint = null,
}: ScoreViewerProps) {
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    if (sourcePdf === null) {
      setState({ status: 'loading' });
      return;
    }
    // 読み込み中に別の PDF へ切り替わったら、古い結果を画面へ反映しない
    let active = true;
    let loaded: PdfDocumentHandle | null = null;
    setState({ status: 'loading' });
    loadPdf(sourcePdf).then(
      (document) => {
        if (active) {
          loaded = document;
          setState({ status: 'ready', document });
        } else {
          document.destroy();
        }
      },
      (error: unknown) => {
        // 壊れた PDF 等。画面全体は落とさず、この区画にだけ理由を出す
        if (active) {
          setState({ status: 'error', message: errorMessage(error) });
        }
      },
    );
    return () => {
      active = false;
      loaded?.destroy();
    };
  }, [sourcePdf, loadPdf]);

  const ready = state.status === 'ready';
  const focusKey = focus === null ? null : regionKey(focus.partId, focus.measureIndex);
  useEffect(() => {
    if (!ready || focusKey === null) {
      return;
    }
    const target = [...(container.current?.querySelectorAll('[data-region]') ?? [])].find(
      (element) => element.getAttribute('data-region') === focusKey,
    );
    // jsdom には scrollIntoView が無い
    target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    // seq は同じ小節を続けて押したときにもスクロールし直すための依存
  }, [ready, focusKey, focus?.seq]);

  if (sourcePdfError !== null) {
    return <p role="alert">楽譜を表示できませんでした（{sourcePdfError}）。</p>;
  }
  if (state.status === 'error') {
    return <p role="alert">楽譜を表示できませんでした（{state.message}）。</p>;
  }
  if (state.status === 'loading') {
    return <p>楽譜を読み込んでいます…</p>;
  }

  const overlays = new Map(preview.pages.map((page) => [page.sourcePageIndex, page]));
  return (
    <div ref={container}>
      {state.document.pageSizes.map((size, pageIndex) => (
        <ScorePage
          key={pageIndex}
          pageIndex={pageIndex}
          size={size}
          document={state.document}
          overlay={overlays.get(pageIndex)}
          style={preview.style}
          focusedRegion={focusKey}
          onPick={onPick}
          selectedAnnotationId={selectedAnnotationId}
          pendingPoint={pendingPoint?.sourcePageIndex === pageIndex ? pendingPoint : null}
        />
      ))}
    </div>
  );
}
