import type { MouseEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import type {
  ScorePreviewAnnotation,
  ScorePreviewMeasure,
  ScorePreviewPage,
  ScorePreviewStyle,
} from '../../shared/types/ScorePreview';
import { keyLabel } from '../labels/scoreLabels';
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
 */

/** スキップ小節のハイライト（機能設計書「カラーコーディング」の黄ハイライト。画面のみ） */
const SKIPPED_FILL = '#ffeb3b';
const SKIPPED_STROKE = '#f9a825';
/** 一覧からジャンプしてきた小節は枠を濃くして、どれを指しているか分かるようにする */
const FOCUSED_STROKE = '#e65100';
const WARNING_FILL = '#ff8f00';
/** 選んだ階名・書き足す位置の印（スキップ小節の黄・警告の橙・階名の赤紫と見分けられる青） */
const SELECTION_STROKE = '#1565c0';
/**
 * 調の区切りの印（機能設計書「Phase 6 で追加する」: auto=グレー、user=青）
 *
 * user の青は選択の印（`SELECTION_STROKE`）より明るくして、選んだものと見分けられるようにする
 */
const KEY_CHANGE_COLORS: Readonly<Record<'auto' | 'user', string>> = {
  auto: '#757575',
  user: '#1e88e5',
};

/** キャンバスの表示幅が測れないとき（レイアウト前）の仮の幅（CSS px） */
const FALLBACK_WIDTH_PX = 800;

/** スキップ小節を DOM 上で一意に指すキー（ジャンプ先の検索に使う） */
export function regionKey(partId: string, measureIndex: number): string {
  return `${partId}:${measureIndex}`;
}

/**
 * 楽譜の上で押したもの（編集の対象）
 *
 * 座標は SVG と同じページのポイント座標（左上原点）。Main がこれを `.omr` の座標へ戻す
 */
export type ScorePick =
  | { kind: 'annotation'; sourcePageIndex: number; annotation: ScorePreviewAnnotation }
  /** `measureIndex` は押した点を含む小節（小節の範囲が分からない位置では null） */
  | { kind: 'point'; sourcePageIndex: number; x: number; y: number; measureIndex: number | null }
  /** 調の区切りの印 */
  | { kind: 'keyChange'; sourcePageIndex: number; measureIndex: number };

/** 押した点を含む小節を探す（範囲の境目はどちらでもよいため、先に見つかった方） */
function measureAt(measures: readonly ScorePreviewMeasure[], x: number, y: number): number | null {
  const found = measures.find(
    (measure) =>
      measure.x <= x &&
      x <= measure.x + measure.width &&
      measure.y <= y &&
      y <= measure.y + measure.height,
  );
  return found?.measureIndex ?? null;
}

/** 書き足す位置（ページのポイント座標） */
export interface ScorePoint {
  x: number;
  y: number;
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
  /** 楽譜の上を押したとき（省略時は読み取り専用） */
  onPick?: (pick: ScorePick) => void;
  /** 選択中の階名の id */
  selectedAnnotationId?: string | null;
  /** このページで書き足そうとしている位置 */
  pendingPoint?: ScorePoint | null;
  /** 転調点を指定しようとしている小節（その範囲を枠で示す） */
  selectedMeasureIndex?: number | null;
}

export function ScorePage({
  pageIndex,
  size,
  document,
  overlay,
  style,
  focusedRegion,
  onPick,
  selectedAnnotationId = null,
  pendingPoint = null,
  selectedMeasureIndex = null,
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

  const pageNumber = pageIndex + 1;
  const editable = onPick !== undefined;
  // 重ねるものが無いページにも、編集できるなら SVG を置く（階名の無いページにも書き足せるように）
  const widthPt = overlay?.widthPt ?? size.widthPt;
  const heightPt = overlay?.heightPt ?? size.heightPt;
  const annotations = overlay?.annotations ?? [];
  const measures = overlay?.measures ?? [];

  /**
   * 押した位置を編集の対象へ直す
   *
   * 注釈は 1 ページ数百あるため要素ごとにハンドラを付けず、SVG の 1 か所で受ける。
   * 押した要素（またはその祖先）が `data-key-change` を持てば調の区切りを、
   * `data-annotation` を持てばその階名を選ぶ
   */
  const handleClick = (event: MouseEvent<SVGSVGElement>) => {
    if (onPick === undefined) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    const keyChange = target?.closest('[data-key-change]')?.getAttribute('data-key-change');
    if (keyChange != null) {
      onPick({ kind: 'keyChange', sourcePageIndex: pageIndex, measureIndex: Number(keyChange) });
      return;
    }
    const annotationId = target?.closest('[data-annotation]')?.getAttribute('data-annotation');
    const annotation =
      annotationId == null ? undefined : annotations.find((item) => item.id === annotationId);
    if (annotation !== undefined) {
      onPick({ kind: 'annotation', sourcePageIndex: pageIndex, annotation });
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return; // レイアウト前は位置を決められない
    }
    const x = ((event.clientX - rect.left) / rect.width) * widthPt;
    const y = ((event.clientY - rect.top) / rect.height) * heightPt;
    onPick({
      kind: 'point',
      sourcePageIndex: pageIndex,
      x,
      y,
      measureIndex: measureAt(measures, x, y),
    });
  };

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
        {(overlay !== undefined || editable) && (
          <svg
            role="img"
            aria-label={`${pageNumber} ページの階名`}
            viewBox={`0 0 ${widthPt} ${heightPt}`}
            onClick={editable ? handleClick : undefined}
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
            {/* 転調点を指定しようとしている小節（段の全譜表にわたる範囲） */}
            {measures
              .filter((measure) => measure.measureIndex === selectedMeasureIndex)
              .map((measure) => (
                <rect
                  key={`measure-${measure.measureIndex}`}
                  data-selected-measure={measure.measureIndex}
                  x={measure.x}
                  y={measure.y}
                  width={measure.width}
                  height={measure.height}
                  fill={SELECTION_STROKE}
                  fillOpacity={0.08}
                  stroke={SELECTION_STROKE}
                  strokeWidth={1.5}
                  pointerEvents="none"
                />
              ))}
            {/* 調の区切りは件数が少なく（曲全体で数件）、楽譜を眺めて探すものなので常に描く */}
            {overlay?.keyChanges.map((marker) => {
              const color = KEY_CHANGE_COLORS[marker.source];
              const label = keyLabel(marker.tonicStep, marker.tonicAlter, marker.mode);
              return (
                <g
                  key={`key-${marker.measureIndex}`}
                  data-key-change={marker.measureIndex}
                  style={editable ? { cursor: 'pointer' } : undefined}
                >
                  <title>
                    {marker.source === 'user' ? '指定した調の区切り' : '自動で判定した調の区切り'}（
                    {marker.measureIndex + 1} 小節目から {label}）
                  </title>
                  {/* 細い線は押しにくいため、透明の太い帯で受ける */}
                  <rect
                    x={marker.x - style.fontSizePt * 0.4}
                    y={marker.y}
                    width={style.fontSizePt * 0.8}
                    height={marker.height}
                    fill="transparent"
                  />
                  <line
                    x1={marker.x}
                    x2={marker.x}
                    y1={marker.y}
                    y2={marker.y + marker.height}
                    stroke={color}
                    strokeWidth={style.fontSizePt * 0.15}
                    strokeDasharray={
                      marker.source === 'auto' ? `${style.fontSizePt * 0.4}` : undefined
                    }
                  />
                  <text
                    x={marker.x}
                    y={marker.y - style.fontSizePt * 0.3}
                    fontFamily="sans-serif"
                    fontWeight="bold"
                    fontSize={style.fontSizePt}
                    fill={color}
                    // 譜面の線や記号に重なっても読めるよう、白い縁取りを文字の下に敷く
                    stroke="#ffffff"
                    strokeWidth={style.fontSizePt * 0.25}
                    paintOrder="stroke"
                  >
                    {label}
                  </text>
                </g>
              );
            })}
            {/* 注釈は数が多い（1 ページ数百）ため、画面の近くにあるページだけ描く */}
            {near &&
              annotations.map((annotation) => {
                const selected = annotation.id === selectedAnnotationId;
                return (
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
                    // 選んだ階名は縁取りと下線で示す（文字の色は出力PDFと同じまま）
                    stroke={selected ? SELECTION_STROKE : undefined}
                    strokeWidth={selected ? style.fontSizePt * 0.08 : undefined}
                    textDecoration={selected ? 'underline' : undefined}
                    style={editable ? { cursor: 'pointer' } : undefined}
                  >
                    {annotation.text}
                  </text>
                );
              })}
            {overlay?.placementWarnings.map((marker) => (
              <g
                key={marker.annotationId}
                data-warning={marker.annotationId}
                // 印を押しても、その階名を選べるようにする
                data-annotation={marker.annotationId}
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
            {pendingPoint !== null && (
              // 書き足す位置の印（十字）。押した点が書き足す文字の中心になる
              <g
                data-pending-point=""
                transform={`translate(${pendingPoint.x} ${pendingPoint.y})`}
                stroke={SELECTION_STROKE}
                strokeWidth={style.fontSizePt * 0.1}
                pointerEvents="none"
              >
                <title>ここに階名を書き足します</title>
                <circle r={style.fontSizePt * 0.6} fill="none" />
                <line x1={-style.fontSizePt} x2={style.fontSizePt} />
                <line y1={-style.fontSizePt} y2={style.fontSizePt} />
              </g>
            )}
          </svg>
        )}
      </div>
      {failed && <p role="alert">このページを表示できませんでした。</p>}
    </figure>
  );
}
