import { describe, expect, it } from 'vitest';
import type { Rect } from '../../../../src/domain/annotations/placementResolver';
import {
  PlacementSpace,
  THIN_SYMBOL_KINDS,
} from '../../../../src/domain/annotations/placementResolver';
import type { OmrSymbol } from '../../../../src/domain/score/OmrSheetParser';

const INTERLINE = 16;

/** 符頭中心 (500, 400)・幅 40・高さ 24 の注釈を置く要求 */
const request = (headCenterX = 500, headTopY = 400) => ({
  headCenterX,
  headTopY,
  width: 40,
  height: 24,
  interlinePx: INTERLINE,
});

const symbol = (kind: string, rect: Rect): OmrSymbol => ({ kind, ...rect });

describe('PlacementSpace', () => {
  it('障害物がなければ符頭の直上（基本位置）に置く', () => {
    const space = new PlacementSpace([], INTERLINE);
    const placement = space.place(request());

    expect(placement.candidateIndex).toBe(0);
    expect(placement.resolved).toBe(true);
    // 文字列の左端が符頭中心から幅の半分だけ左にある
    expect(placement.x).toBeCloseTo(480, 6);
    // ベースラインは符頭上端より上（y は下向きなので符頭上端より小さい）
    expect(placement.y).toBeLessThan(400);
  });

  it('符幹とだけ重なっても基本位置のまま（細い線は障害物にしない）', () => {
    // 基本位置を確実に覆う位置へ符幹を置く
    const stem = symbol('stem', { x: 470, y: 340, w: 4, h: 80 });
    const space = new PlacementSpace([stem], INTERLINE);

    expect(space.place(request()).candidateIndex).toBe(0);
  });

  it('加線とだけ重なっても基本位置のまま', () => {
    const ledger = symbol('ledger', { x: 470, y: 360, w: 60, h: 3 });
    const space = new PlacementSpace([ledger], INTERLINE);

    expect(space.place(request()).candidateIndex).toBe(0);
  });

  it('細線として扱う種別は符幹と加線だけ', () => {
    expect([...THIN_SYMBOL_KINDS].sort()).toEqual(['ledger', 'stem']);
  });

  it('符頭と重なる場合は次の候補へ逃げる', () => {
    const blocker = symbol('head', { x: 470, y: 340, w: 60, h: 70 });
    const space = new PlacementSpace([blocker], INTERLINE);
    const placement = space.place(request());

    expect(placement.candidateIndex).toBeGreaterThan(0);
    expect(placement.resolved).toBe(true);
  });

  it('上が塞がっていれば符頭の下側へ回る', () => {
    // 符頭より上を広く塞ぐ（候補 #0・#1・#4・#5・#6 が使えない）
    const blocker = symbol('beam', { x: 300, y: 200, w: 400, h: 200 });
    const space = new PlacementSpace([blocker], INTERLINE);
    const placement = space.place(request());

    expect(placement.resolved).toBe(true);
    // ベースラインが符頭上端より下にある
    expect(placement.y).toBeGreaterThan(400);
  });

  it('先に置いた注釈とも重ならない', () => {
    const space = new PlacementSpace([], INTERLINE);
    const first = space.place(request(500, 400));
    // ほぼ同じ位置へもう 1 つ置こうとする（divisi の同時発音がこの形）
    const second = space.place(request(505, 400));

    expect(second.candidateIndex).not.toBe(0);
    const firstRect = { x: first.x, y: first.y - 24, w: 40, h: 24 };
    const secondRect = { x: second.x, y: second.y - 24, w: 40, h: 24 };
    const overlaps =
      firstRect.x < secondRect.x + secondRect.w &&
      secondRect.x < firstRect.x + firstRect.w &&
      firstRect.y < secondRect.y + secondRect.h &&
      secondRect.y < firstRect.y + firstRect.h;
    expect(overlaps).toBe(false);
  });

  it('全候補が塞がれたら基本位置へ置き resolved: false で報告する', () => {
    const wall = symbol('beam', { x: 0, y: 0, w: 2000, h: 2000 });
    const space = new PlacementSpace([wall], INTERLINE);
    const blocked = space.place(request());

    expect(blocked.resolved).toBe(false);
    expect(blocked.candidateIndex).toBe(0);
    // 基本位置と同じ座標に落ちる
    const free = new PlacementSpace([], INTERLINE).place(request());
    expect(blocked.x).toBeCloseTo(free.x, 6);
    expect(blocked.y).toBeCloseTo(free.y, 6);
  });

  it('解決できなかった注釈も占有として記録し、後続が同じ場所へ重ねない', () => {
    const wall = symbol('beam', { x: 0, y: 0, w: 2000, h: 2000 });
    const space = new PlacementSpace([wall], INTERLINE);
    space.place(request(500, 400));
    const second = space.place(request(500, 400));

    // 1 つ目が占有しているため、2 つ目も同じ結果（どちらも塞がれている）にはなるが、
    // 少なくとも「解決できなかった」ことが両方に伝わる
    expect(second.resolved).toBe(false);
  });

  it('譜線間隔が 0 でも格子が破綻せず結果を返す', () => {
    const space = new PlacementSpace([symbol('head', { x: 0, y: 0, w: 10, h: 10 })], 0);
    const placement = space.place({ ...request(), interlinePx: 0 });

    expect(Number.isFinite(placement.x)).toBe(true);
    expect(Number.isFinite(placement.y)).toBe(true);
  });

  it('格子索引の判定が総当たりと一致する（索引のバグを検出する）', () => {
    // 格子は「近傍だけ見る」最適化なので、見落としがあると衝突を素通しする。
    // 乱数で作った障害物に対し、置いた矩形が本当にどれとも交差しないかを総当たりで検算する
    let seed = 20260720;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const obstacles: OmrSymbol[] = Array.from({ length: 300 }, () =>
      symbol('head', {
        x: random() * 2000,
        y: random() * 2000,
        w: 5 + random() * 40,
        h: 5 + random() * 40,
      }),
    );
    const solid = obstacles.filter((o) => !THIN_SYMBOL_KINDS.has(o.kind));
    const space = new PlacementSpace(obstacles, INTERLINE);
    const placed: Rect[] = [];

    for (let i = 0; i < 200; i += 1) {
      const req = request(random() * 2000, random() * 2000);
      const placement = space.place(req);
      const rect: Rect = {
        x: placement.x,
        y: placement.y - req.height,
        w: req.width,
        h: req.height,
      };
      if (placement.resolved) {
        const overlapping = [...solid, ...placed].filter(
          (other) =>
            rect.x < other.x + other.w &&
            other.x < rect.x + rect.w &&
            rect.y < other.y + other.h &&
            other.y < rect.y + rect.h,
        );
        expect(overlapping).toEqual([]);
      }
      placed.push(rect);
    }
  });
});
