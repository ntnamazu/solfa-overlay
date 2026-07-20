import { describe, expect, it } from 'vitest';
import {
  isTransformable,
  pxPerPt,
  toMediaBoxPoint,
  toPdfPoint,
} from '../../../../src/domain/render/coordinateTransform';
import type { PageInfo } from '../../../../src/shared/types/Project';

/** Victoria の実測値（.omr 2480×3507px / 元PDF 595.28×841.89pt ≒ 300dpi の A4） */
const VICTORIA_PAGE: PageInfo = {
  pageIndex: 1,
  sourcePageIndex: 0,
  widthPt: 595.28,
  heightPt: 841.89,
  omrImageWidthPx: 2480,
  omrImageHeightPx: 3507,
  interlinePx: 17,
};

const anchor = (x: number, y: number) => ({ pageIndex: 1, x, y });

describe('toPdfPoint', () => {
  it('Audiveris ページではなく元PDFページを指す', () => {
    // pageIndex=1 の注釈が sourcePageIndex=0 のページへ行く（Victoria の 1 sheet 2 ページ）
    expect(toPdfPoint(VICTORIA_PAGE, anchor(0, 0))?.sourcePageIndex).toBe(0);
  });

  it('画像の上端を PDF ページの上端へ写す（y 軸の反転）', () => {
    expect(toPdfPoint(VICTORIA_PAGE, anchor(0, 0))?.y).toBeCloseTo(841.89, 6);
  });

  it('画像の下端を PDF ページの下端（y=0）へ写す', () => {
    expect(toPdfPoint(VICTORIA_PAGE, anchor(0, 3507))?.y).toBeCloseTo(0, 6);
  });

  it('x は左原点のまま線形に縮尺する', () => {
    expect(toPdfPoint(VICTORIA_PAGE, anchor(2480, 0))?.x).toBeCloseTo(595.28, 6);
    expect(toPdfPoint(VICTORIA_PAGE, anchor(1240, 0))?.x).toBeCloseTo(297.64, 6);
  });

  it('縦横で縮尺が違うページでも軸ごとに正しく変換する', () => {
    // 横だけ 2 倍に引き伸ばされたページ（アスペクト比が一致しない実例の縮図）
    const stretched: PageInfo = {
      ...VICTORIA_PAGE,
      widthPt: 200,
      heightPt: 100,
      omrImageWidthPx: 100,
      omrImageHeightPx: 100,
    };
    const point = toPdfPoint(stretched, anchor(50, 25));
    expect(point?.x).toBeCloseTo(100, 6);
    expect(point?.y).toBeCloseTo(75, 6);
  });

  it('画像寸法が 0 のページは NaN を返さず null にする', () => {
    const broken: PageInfo = { ...VICTORIA_PAGE, omrImageWidthPx: 0 };
    expect(toPdfPoint(broken, anchor(10, 10))).toBeNull();
    expect(isTransformable(broken)).toBe(false);
  });

  it('ページ寸法が 0 や非有限でも null にする', () => {
    expect(toPdfPoint({ ...VICTORIA_PAGE, heightPt: 0 }, anchor(1, 1))).toBeNull();
    expect(toPdfPoint({ ...VICTORIA_PAGE, widthPt: Number.NaN }, anchor(1, 1))).toBeNull();
    expect(toPdfPoint({ ...VICTORIA_PAGE, omrImageHeightPx: Infinity }, anchor(1, 1))).toBeNull();
  });
});

describe('toMediaBoxPoint', () => {
  // MediaBox 600×800pt（未回転）。表示座標の 1 点を各回転で MediaBox 座標へ写す
  const W = 600;
  const H = 800;

  it('回転 0 は座標そのまま・rotate 0（通常ケースを素通しする）', () => {
    expect(toMediaBoxPoint(W, H, 0, 100, 700)).toEqual({ x: 100, y: 700, rotateDegrees: 0 });
  });

  it('回転 90 では表示座標を MediaBox 座標へ移し、テキストを 90 度回す', () => {
    // 表示原点(0,0) は CW90 で MediaBox 右下(W,0) へ来る
    expect(toMediaBoxPoint(W, H, 90, 0, 0)).toEqual({ x: 600, y: 0, rotateDegrees: 90 });
    expect(toMediaBoxPoint(W, H, 90, 100, 700)).toEqual({ x: -100, y: 100, rotateDegrees: 90 });
  });

  it('回転 180 は両軸を反転する', () => {
    expect(toMediaBoxPoint(W, H, 180, 100, 700)).toEqual({ x: 500, y: 100, rotateDegrees: 180 });
  });

  it('回転 270 では x/y を入れ替えて反転する', () => {
    expect(toMediaBoxPoint(W, H, 270, 100, 700)).toEqual({ x: 700, y: 700, rotateDegrees: 270 });
  });

  it('負や 360 超の角度も正規化する', () => {
    expect(toMediaBoxPoint(W, H, -270, 0, 0)).toEqual(toMediaBoxPoint(W, H, 90, 0, 0));
    expect(toMediaBoxPoint(W, H, 450, 100, 700)).toEqual(toMediaBoxPoint(W, H, 90, 100, 700));
  });
});

describe('pxPerPt', () => {
  it('横方向の縮尺を返す（8pt が実測の 33px 前後になる）', () => {
    const scale = pxPerPt(VICTORIA_PAGE);
    expect(scale).not.toBeNull();
    expect((scale ?? 0) * 8).toBeCloseTo(33.3, 1);
  });

  it('変換できないページでは null', () => {
    expect(pxPerPt({ ...VICTORIA_PAGE, widthPt: 0 })).toBeNull();
  });
});
