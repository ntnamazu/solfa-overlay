import type { MouseEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { AnnotationEdit } from '../../shared/ipc/contract';
import type { ScorePreviewPage, ScorePreviewStyle } from '../../shared/types/ScorePreview';
import type { AnnotationDraft } from './AnnotationEditForm';
import { AnnotationEditForm } from './AnnotationEditForm';
import type { PdfDocumentHandle, PdfPageSize } from './pdfDocument';
import { isRenderCancelled } from './pdfDocument';
import { useNearViewport } from './useNearViewport';

/**
 * 楽譜プレビューの 1 ページ（元PDFのキャンバス描画 ＋ SVG の重ね描き）
 *
 * SVG の座標系はページのポイント寸法（`viewBox="0 0 widthPt heightPt"`）にそろえる。
 * Main から届く座標（pt・左上原点）をそのまま置け、SVG の `<text x y>` は pdf-lib の
 * `drawText` と同じく「左端＋ベースライン」を基準にするため、出力PDFと同じ位置に文字が載る。
 *
 * スタイルは React の `style` プロパティ（CSSOM 経由）と SVG の表示属性だけで付ける。
 * CSP（`default-src 'self'`）はインラインの `<style>` を許さないため
 *
 * 編集できる状態（`editable`）では、何も無い位置を押すとそこへの追加、注釈の文字を押すと
 * その注釈の修正になる（F-5）。押した位置は SVG と同じページのポイント座標に直して渡す
 */

/** スキップ小節のハイライト（機能設計書「カラーコーディング」の黄ハイライト。画面のみ） */
const SKIPPED_FILL = '#ffeb3b';
const SKIPPED_STROKE = '#f9a825';
/** 一覧からジャンプしてきた小節は枠を濃くして、どれを指しているか分かるようにする */
const FOCUSED_STROKE = '#e65100';
const WARNING_FILL = '#ff8f00';
/** 追加しようとしている位置・直そうとしている注釈の印 */
const DRAFT_STROKE = '#1565c0';

/** キャンバスの表示幅が測れないとき（レイアウト前）の仮の幅（CSS px） */
const FALLBACK_WIDTH_PX = 800;

/** スキップ小節を DOM 上で一意に指すキー（ジャンプ先の検索に使う） */
export function regionKey(partId: string, measureIndex: number): string {
  return `${partId}:${measureIndex}`;
}

export interface ScorePageProps {
  /** 元PDF のページ添字（0始まり） */
  pageIndex: number;
  size: PdfPageSize;
  document: PdfDocumentHandle;
  /** このページに重ねる内容（重ねるものが無いページは undefined） */
  overlay: ScorePreviewPage | undefined;
  style: ScorePreviewStyle;
  /** 強調表示するスキップ小節（`regionKey`） */
  focusedRegion: string | null;
  /** 楽譜を押して階名を足す・直せるか */
  editable: boolean;
  /** このページで編集中の対象（無ければ null） */
  draft: AnnotationDraft | null;
  /** 楽譜の位置・注釈を押した */
  onPick: (draft: AnnotationDraft) => void;
  onSubmitEdit: (edit: AnnotationEdit) => void;
  onCancelEdit: () => void;
}

/** 入力欄を押した位置の左右どちらへ伸ばすか（ページの右寄りなら左へ伸ばし、はみ出させない） */
function formPosition(x: number, y: number, widthPt: number, heightPt: number) {
  const left = (x / widthPt) * 100;
  const top = `calc(${(y / heightPt) * 100}% + 6px)`;
  return left > 60 ? { right: `${100 - left}%`, top } : { left: `${left}%`, top };
}

export function ScorePage({
  pageIndex,
  size,
  document,
  overlay,
  style,
  focusedRegion,
  editable,
  draft,
  onPick,
  onSubmitEdit,
  onCancelEdit,
}: ScorePageProps) {
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const near = useNearViewport(frame);
  const [failed, setFailed] = useState(false);
  // ウィンドウ幅が変わったら、その幅に合う解像度で描き直す（古い解像度のままぼやけさせない）
  const [widthPx, setWidthPx] = useState(0);
  useEffect(() => {
    const element = frame.current;
    if (element === null || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => {
      setWidthPx(Math.round(element.clientWidth));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const target = canvas.current;
    if (!near || target === null) {
      return;
    }
    // 高解像度ディスプレイでぼやけないよう、表示幅×画素密度で描く
    const displayWidth = widthPx || frame.current?.clientWidth || FALLBACK_WIDTH_PX;
    const scale = (displayWidth / size.widthPt) * (window.devicePixelRatio || 1);
    const task = document.renderPage(pageIndex, target, scale);
    task.promise.then(
      () => setFailed(false),
      (error: unknown) => {
        // スクロールで離れて止めただけなら失敗ではない
        if (!isRenderCancelled(error)) {
          setFailed(true);
        }
      },
    );
    return () => {
      task.cancel();
    };
  }, [near, document, pageIndex, size.widthPt, widthPx]);

  // 重ねるものが無いページでも、編集中はどこにでも書き足せるよう SVG を置く
  const widthPt = overlay?.widthPt ?? size.widthPt;
  const heightPt = overlay?.heightPt ?? size.heightPt;
  const showSvg = overlay !== undefined || editable;

  /** 押した位置をページのポイント座標へ直す（SVG は枠いっぱいに伸びている） */
  const pickPosition = (event: MouseEvent<SVGSVGElement>) => {
    if (!editable) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      return; // レイアウト前は位置を決められない
    }
    onPick({
      kind: 'add',
      sourcePageIndex: pageIndex,
      x: ((event.clientX - bounds.left) / bounds.width) * widthPt,
      y: ((event.clientY - bounds.top) / bounds.height) * heightPt,
    });
  };
  const draftPoint =
    draft === null
      ? null
      : draft.kind === 'add'
        ? { x: draft.x, y: draft.y }
        : { x: draft.annotation.x, y: draft.annotation.y };

  const pageNumber = pageIndex + 1;
  return (
    <figure style={{ margin: '0 0 24px' }}>
      <figcaption>{pageNumber} ページ</figcaption>
      <div
        ref={frame}
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: `${size.widthPt} / ${size.heightPt}`,
          background: '#ffffff',
          boxShadow: '0 0 0 1px #cccccc',
        }}
      >
        {near && (
          <canvas
            ref={canvas}
            aria-hidden="true"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          />
        )}
        {showSvg && (
          <svg
            role="img"
            aria-label={`${pageNumber} ページの階名`}
            viewBox={`0 0 ${widthPt} ${heightPt}`}
            onClick={pickPosition}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              cursor: editable ? 'crosshair' : undefined,
            }}
          >
            {/* 件数が少なくジャンプ先にもなるため、スキップ小節と警告は常に描く */}
            {overlay?.skippedMeasures.map((region) => {
              const key = regionKey(region.partId, region.measureIndex);
              const focused = key === focusedRegion;
              return (
                <rect
                  key={key}
                  data-region={key}
                  x={region.x}
                  y={region.y}
                  width={region.width}
                  height={region.height}
                  fill={SKIPPED_FILL}
                  fillOpacity={focused ? 0.55 : 0.35}
                  stroke={focused ? FOCUSED_STROKE : SKIPPED_STROKE}
                  strokeWidth={focused ? 2 : 0.75}
                >
                  <title>階名が付かなかった小節</title>
                </rect>
              );
            })}
            {/* 注釈は数が多い（1 ページ数百）ため、画面の近くにあるページだけ描く */}
            {near &&
              overlay?.annotations.map((annotation) => (
                <text
                  key={annotation.id}
                  data-annotation={annotation.id}
                  x={annotation.x}
                  y={annotation.y}
                  fontFamily={style.fontFamily}
                  fontSize={style.fontSizePt}
                  // 変化音は色と太字の両方で区別する（モノクロ印刷と同じ考え方）
                  fontWeight={annotation.chromatic ? 'bold' : 'normal'}
                  fill={annotation.chromatic ? style.chromaticColor : style.diatonicColor}
                  textDecoration={
                    draft?.kind === 'edit' && draft.annotation.id === annotation.id
                      ? 'underline'
                      : undefined
                  }
                  onClick={
                    editable
                      ? (event) => {
                          // 下の SVG へ伝えると「この位置に追加」と解釈されてしまう
                          event.stopPropagation();
                          onPick({ kind: 'edit', sourcePageIndex: pageIndex, annotation });
                        }
                      : undefined
                  }
                  style={editable ? { cursor: 'pointer' } : undefined}
                >
                  {annotation.text}
                </text>
              ))}
            {overlay?.placementWarnings.map((marker) => (
              <g
                key={marker.annotationId}
                data-warning={marker.annotationId}
                // 注釈の文字に重ならないよう、左上に小さく置く
                transform={`translate(${marker.x - style.fontSizePt * 0.6} ${marker.y - style.fontSizePt})`}
              >
                <title>まわりの記号と重なっている階名</title>
                <circle r={style.fontSizePt * 0.45} fill={WARNING_FILL} />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontFamily="sans-serif"
                  fontWeight="bold"
                  fontSize={style.fontSizePt * 0.7}
                  fill="#ffffff"
                >
                  !
                </text>
              </g>
            ))}
            {draft?.kind === 'add' && (
              // 足す位置（文字の左端＋ベースライン）に小さな十字を出す
              <g data-draft="add" stroke={DRAFT_STROKE} strokeWidth={0.75} pointerEvents="none">
                <line
                  x1={draft.x - style.fontSizePt / 2}
                  y1={draft.y}
                  x2={draft.x + style.fontSizePt / 2}
                  y2={draft.y}
                />
                <line
                  x1={draft.x}
                  y1={draft.y - style.fontSizePt / 2}
                  x2={draft.x}
                  y2={draft.y + style.fontSizePt / 2}
                />
              </g>
            )}
          </svg>
        )}
        {draft !== null && draftPoint !== null && (
          <div
            style={{
              position: 'absolute',
              zIndex: 1,
              ...formPosition(draftPoint.x, draftPoint.y, widthPt, heightPt),
            }}
          >
            <AnnotationEditForm
              // 対象が変わったら入力欄を作り直す（前の対象の文字を持ち越さない）
              key={
                draft.kind === 'add' ? `add-${draft.x}-${draft.y}` : `edit-${draft.annotation.id}`
              }
              draft={draft}
              onSubmit={onSubmitEdit}
              onCancel={onCancelEdit}
            />
          </div>
        )}
      </div>
      {failed && <p role="alert">このページを表示できませんでした。</p>}
    </figure>
  );
}
