import type { OmrSymbol } from '../score/OmrSheetParser';

/**
 * 注釈の配置と衝突回避（機能設計書「注釈配置と衝突回避」）
 *
 * 階名は符頭の直上に置きたいが、譜面には他の記号が詰まっている。基本位置が塞がっていれば
 * 候補位置を順に試し、どれも空かなければ基本位置に置いて警告する。
 *
 * 座標はすべて `.omr` の 300dpi 画像ピクセル（左上原点・y 下向き）。
 */

/** 軸並行の矩形（左上原点） */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 重なっても判読を妨げない**細い線**
 *
 * 実測で、基本位置の衝突相手の 8 割が `stem`（符幹）だった。符幹・加線は幅数pxの線であり、
 * 階名文字が重なっても読める（手書きの階名も符幹をまたいで書く）。これを障害物から外すと
 * 符頭の直上をそのまま使える注釈が Victoria で 43.2% → 89.2%、divisi で 21.6% → 61.1% に増え、
 * 配置不能は divisi で 123 → 25 件に減る（要求 発見3）
 */
export const THIN_SYMBOL_KINDS: ReadonlySet<string> = new Set(['stem', 'ledger']);

/** 符頭の高さの近似（`NoteEvent.head` は点しか持たないため譜線間隔から見積もる） */
const HEAD_HEIGHT_RATIO = 1.08;

/** 符頭と文字の間の余白（譜線間隔比） */
const GAP_RATIO = 0.25;

/** 横へずらす量（文字幅比） */
const SHIFT_RATIO = 0.85;

/**
 * 候補位置の梯子
 *
 * `above` が符頭の上側か、`steps` が文字高さ何段ぶん離すか、`shift` が横方向のずれ。
 * 順序は実測で決めた（採用率は #0 が Victoria 89.2% / divisi 61.1%）。
 * 上を優先し、次に下、最後に斜めへ逃がす
 */
const LADDER: readonly { above: boolean; steps: number; shift: number }[] = [
  { above: true, steps: 0, shift: 0 },
  { above: true, steps: 1.05, shift: 0 },
  { above: false, steps: 0, shift: 0 },
  { above: false, steps: 1.05, shift: 0 },
  { above: true, steps: 0, shift: -SHIFT_RATIO },
  { above: true, steps: 0, shift: SHIFT_RATIO },
  { above: true, steps: 2.1, shift: 0 },
  { above: false, steps: 2.1, shift: 0 },
  { above: false, steps: 0, shift: -SHIFT_RATIO },
  { above: false, steps: 0, shift: SHIFT_RATIO },
];

/** 1 つの注釈を置きたい要求 */
export interface PlacementRequest {
  /** 符頭中心の x */
  headCenterX: number;
  /** 符頭上端の y */
  headTopY: number;
  /** 注釈の描画幅 */
  width: number;
  /** 注釈の高さ（アセンダ高） */
  height: number;
  /** 譜線間隔。符頭の高さと余白の基準 */
  interlinePx: number;
}

/** 配置結果 */
export interface Placement {
  /** 文字列の左端 x（`Annotation.anchor` と同じ基準） */
  x: number;
  /** ベースラインの y（＝矩形の下端。`Annotation.anchor` と同じ基準） */
  y: number;
  /** 採用した候補の番号。0 が基本位置（符頭の直上） */
  candidateIndex: number;
  /** false なら全候補が塞がっており、基本位置へ置いた（人手調整が要る） */
  resolved: boolean;
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * 一様格子による矩形の索引
 *
 * ページあたり障害物 930・注釈 283 の実測に対し、候補 10 段の総当たりでは
 * 5,000 注釈の性能要件（アーキテクチャ設計書）に対して余裕がない。
 * セル幅は譜線間隔の 4 倍にしてある（記号 1 つがまたぐセル数を小さく保つため）
 */
class RectGrid {
  private readonly cells = new Map<string, Rect[]>();

  constructor(private readonly cellSize: number) {}

  private *keysFor(rect: Rect): Generator<string> {
    const x0 = Math.floor(rect.x / this.cellSize);
    const x1 = Math.floor((rect.x + rect.w) / this.cellSize);
    const y0 = Math.floor(rect.y / this.cellSize);
    const y1 = Math.floor((rect.y + rect.h) / this.cellSize);
    for (let cx = x0; cx <= x1; cx += 1) {
      for (let cy = y0; cy <= y1; cy += 1) {
        yield `${cx},${cy}`;
      }
    }
  }

  add(rect: Rect): void {
    for (const key of this.keysFor(rect)) {
      const bucket = this.cells.get(key);
      if (bucket === undefined) {
        this.cells.set(key, [rect]);
      } else {
        bucket.push(rect);
      }
    }
  }

  /** rect と交差する矩形があるか */
  hits(rect: Rect): boolean {
    for (const key of this.keysFor(rect)) {
      const bucket = this.cells.get(key);
      if (bucket !== undefined && bucket.some((other) => intersects(rect, other))) {
        return true;
      }
    }
    return false;
  }
}

/**
 * ページ 1 枚分の配置領域
 *
 * `place` を呼ぶたびに採用した矩形を占有として記録するため、**注釈どうしも重ならない**。
 * 呼び出し順によって結果が変わるので、呼び出し側は決定的な順序で回すこと
 */
export class PlacementSpace {
  private readonly grid: RectGrid;

  /**
   * @param symbols - このページの記号。細い線は障害物にしない
   * @param interlinePx - 格子のセル幅の基準
   */
  constructor(symbols: readonly OmrSymbol[], interlinePx: number) {
    // セル幅が 0 以下だと格子が破綻する。譜線間隔が異常な .omr でも落ちないように下限を置く
    this.grid = new RectGrid(Math.max(interlinePx, 1) * 4);
    for (const symbol of symbols) {
      if (!THIN_SYMBOL_KINDS.has(symbol.kind)) {
        this.grid.add(symbol);
      }
    }
  }

  /**
   * 矩形を障害物として先に占有させる（配置はしない）
   *
   * 描画される既存の手動注釈を、自動注釈の候補探索が避けられるようにするためのもの。
   * これを呼ばないと自動注釈が手動注釈の真上に重なって出力され得る
   */
  occupy(rect: Rect): void {
    this.grid.add(rect);
  }

  /** 候補位置を順に試し、最初に空いている位置を採用する */
  place(request: PlacementRequest): Placement {
    const gap = request.interlinePx * GAP_RATIO;
    const headHeight = request.interlinePx * HEAD_HEIGHT_RATIO;

    let base: Rect | null = null;
    for (const [index, candidate] of LADDER.entries()) {
      const rect = this.rectFor(request, candidate, gap, headHeight);
      base ??= rect;
      if (!this.grid.hits(rect)) {
        this.grid.add(rect);
        return { x: rect.x, y: rect.y + rect.h, candidateIndex: index, resolved: true };
      }
    }

    // どの候補も塞がっている。基本位置へ置き、修正UIでの調整に委ねる（機能設計書 ステップ4）。
    // 占有として記録もする（後続の注釈がここへ重ねて置くのを防ぐ）
    /* v8 ignore next -- LADDER は非空のため base は必ず埋まる */
    const fallback = base ?? { x: request.headCenterX, y: request.headTopY, w: 0, h: 0 };
    this.grid.add(fallback);
    return {
      x: fallback.x,
      y: fallback.y + fallback.h,
      candidateIndex: 0,
      resolved: false,
    };
  }

  private rectFor(
    request: PlacementRequest,
    candidate: (typeof LADDER)[number],
    gap: number,
    headHeight: number,
  ): Rect {
    const x = request.headCenterX - request.width / 2 + candidate.shift * request.width;
    const y = candidate.above
      ? request.headTopY - gap - request.height * (1 + candidate.steps)
      : request.headTopY + headHeight + gap + request.height * candidate.steps;
    return { x, y, w: request.width, h: request.height };
  }
}
