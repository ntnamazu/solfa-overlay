import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  PdfDocumentHandle,
  PdfLoader,
  PdfRenderTask,
} from '../../../src/renderer/viewer/pdfDocument';
import { ScoreViewer } from '../../../src/renderer/viewer/ScoreViewer';
import type { ScoreViewerProps } from '../../../src/renderer/viewer/ScoreViewer';
import type { ScorePreview, ScorePreviewPage } from '../../../src/shared/types/ScorePreview';

/**
 * 楽譜プレビューの表示分岐・遅延描画・ジャンプのテスト
 *
 * jsdom には canvas も worker も無いため、PDF.js の代わりに擬似ローダーを注入する。
 * 検証するのは「どのページに何を重ねるか」「いつ描くか」であり、PDF.js の描画そのものではない
 */

const A4 = { widthPt: 595.28, heightPt: 841.89 };

/** 描画の呼び出しを記録する擬似文書 */
function fakeDocument(pageCount: number) {
  const renders: number[] = [];
  const cancels: number[] = [];
  const destroy = vi.fn();
  const document: PdfDocumentHandle = {
    pageSizes: Array.from({ length: pageCount }, () => A4),
    renderPage: vi.fn((pageIndex: number): PdfRenderTask => {
      renders.push(pageIndex);
      return {
        promise: Promise.resolve(),
        cancel: () => {
          cancels.push(pageIndex);
        },
      };
    }),
    destroy,
  };
  return { document, renders, cancels, destroy };
}

const page = (overrides: Partial<ScorePreviewPage> = {}): ScorePreviewPage => ({
  sourcePageIndex: 0,
  widthPt: A4.widthPt,
  heightPt: A4.heightPt,
  annotations: [],
  skippedMeasures: [],
  placementWarnings: [],
  ...overrides,
});

const preview = (pages: ScorePreviewPage[]): ScorePreview => ({
  style: {
    fontFamily: 'serif',
    fontSizePt: 8,
    diatonicColor: '#8b0000',
    chromaticColor: '#6a0dad',
  },
  pages,
});

const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

function setup(overrides: Partial<ScoreViewerProps> = {}, pageCount = 2) {
  const fake = fakeDocument(pageCount);
  const loadPdf = vi.fn<PdfLoader>().mockResolvedValue(fake.document);
  const props: ScoreViewerProps = {
    sourcePdf: BYTES,
    sourcePdfError: null,
    preview: preview([]),
    focus: null,
    loadPdf,
    ...overrides,
  };
  const view = render(<ScoreViewer {...props} />);
  return { ...fake, loadPdf, props, view };
}

const originalScrollIntoView = Element.prototype.scrollIntoView;

afterEach(() => {
  vi.unstubAllGlobals();
  // jsdom には無いメソッドをテストで足すため、他のテストへ持ち越さない
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

describe('ScoreViewer: 読み込み', () => {
  it('元PDF の全ページを並べ、ページ番号を 1 始まりで示す', async () => {
    const { loadPdf } = setup({}, 3);

    expect(await screen.findByText('3 ページ')).toBeDefined();
    expect(screen.getByText('1 ページ')).toBeDefined();
    expect(loadPdf).toHaveBeenCalledWith(BYTES);
  });

  it('元PDF を取得するまでは読み込み中と示す', () => {
    setup({ sourcePdf: null });
    expect(screen.getByText('楽譜を読み込んでいます…')).toBeDefined();
  });

  it('元PDF を取得できなかったら理由を示す', () => {
    setup({ sourcePdf: null, sourcePdfError: 'プロジェクトが開かれていません' });
    expect(screen.getByRole('alert').textContent).toBe(
      '楽譜を表示できませんでした（プロジェクトが開かれていません）。',
    );
  });

  it('PDF として読めなければ理由を示す（画面全体は落とさない）', async () => {
    setup({ loadPdf: vi.fn<PdfLoader>().mockRejectedValue(new Error('Invalid PDF structure')) });
    expect((await screen.findByRole('alert')).textContent).toContain('Invalid PDF structure');
  });

  it('画面から外れたら PDF の資源を解放する', async () => {
    const { destroy, view } = setup();
    await screen.findByText('1 ページ');
    view.unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('読み込み中に外れたら、読み終わった文書をすぐ解放する（画面へ反映しない）', async () => {
    const fake = fakeDocument(1);
    let resolve: (document: PdfDocumentHandle) => void = () => {};
    const loadPdf = vi.fn<PdfLoader>(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const view = render(
      <ScoreViewer
        sourcePdf={BYTES}
        sourcePdfError={null}
        preview={preview([])}
        focus={null}
        loadPdf={loadPdf}
      />,
    );
    view.unmount();
    await act(async () => {
      resolve(fake.document);
      await Promise.resolve();
    });
    expect(fake.destroy).toHaveBeenCalledTimes(1);
  });

  it('ページの描画に失敗したら、そのページに理由を示す', async () => {
    const fake = fakeDocument(1);
    fake.document.renderPage = () => ({
      promise: Promise.reject(new Error('broken image')),
      cancel: () => {},
    });
    setup({ loadPdf: vi.fn<PdfLoader>().mockResolvedValue(fake.document) });
    expect((await screen.findByRole('alert')).textContent).toBe(
      'このページを表示できませんでした。',
    );
  });

  it('描画のキャンセルは失敗として扱わない', async () => {
    const fake = fakeDocument(1);
    const cancelled = Object.assign(new Error('cancelled'), {
      name: 'RenderingCancelledException',
    });
    fake.document.renderPage = () => ({ promise: Promise.reject(cancelled), cancel: () => {} });
    setup({ loadPdf: vi.fn<PdfLoader>().mockResolvedValue(fake.document) });
    await screen.findByText('1 ページ');
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('ScoreViewer: 重ね描き', () => {
  const annotated = preview([
    page({
      sourcePageIndex: 1,
      annotations: [
        {
          id: 'a1',
          x: 10,
          y: 20,
          text: 'do',
          chromatic: false,
          origin: 'auto',
          textOverridden: false,
        },
        {
          id: 'a2',
          x: 30,
          y: 20,
          text: 'fi',
          chromatic: true,
          origin: 'auto',
          textOverridden: false,
        },
      ],
    }),
  ]);

  it('Main が確定させた位置・文字で、対応する元PDFページに重ねる', async () => {
    setup({ preview: annotated });

    const svg = await screen.findByRole('img', { name: '2 ページの階名' });
    const texts = [...svg.querySelectorAll('text')];
    expect(texts.map((text) => text.textContent)).toEqual(['do', 'fi']);
    expect(texts[0]?.getAttribute('x')).toBe('10');
    expect(texts[0]?.getAttribute('y')).toBe('20');
    // 重ねるものが無いページには SVG を置かない
    expect(screen.queryByRole('img', { name: '1 ページの階名' })).toBeNull();
  });

  it('SVG の座標系をページのポイント寸法にそろえる', async () => {
    setup({ preview: annotated });
    const svg = await screen.findByRole('img', { name: '2 ページの階名' });
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${A4.widthPt} ${A4.heightPt}`);
  });

  it('幹音と変化音を色と太字で区別し、書体と文字サイズを設定どおりにする', async () => {
    setup({ preview: annotated });
    const svg = await screen.findByRole('img', { name: '2 ページの階名' });
    const [diatonic, chromatic] = [...svg.querySelectorAll('text')];

    expect(diatonic?.getAttribute('fill')).toBe('#8b0000');
    expect(diatonic?.getAttribute('font-weight')).toBe('normal');
    expect(chromatic?.getAttribute('fill')).toBe('#6a0dad');
    expect(chromatic?.getAttribute('font-weight')).toBe('bold');
    expect(diatonic?.getAttribute('font-family')).toBe('serif');
    expect(diatonic?.getAttribute('font-size')).toBe('8');
  });

  it('スキップ小節を黄色の枠で囲む', async () => {
    setup({
      preview: preview([
        page({
          skippedMeasures: [{ partId: 'P1', measureIndex: 4, x: 1, y: 2, width: 3, height: 4 }],
        }),
      ]),
    });
    const svg = await screen.findByRole('img', { name: '1 ページの階名' });
    const rect = svg.querySelector('rect[data-region="P1:4"]');
    expect(rect?.getAttribute('fill')).toBe('#ffeb3b');
    expect(rect?.getAttribute('width')).toBe('3');
    expect(rect?.textContent).toBe('階名が付かなかった小節');
  });

  it('配置を調整できなかった注釈の位置に警告の印を置く', async () => {
    setup({
      preview: preview([page({ placementWarnings: [{ annotationId: 'a1', x: 10, y: 20 }] })]),
    });
    const svg = await screen.findByRole('img', { name: '1 ページの階名' });
    expect(svg.querySelector('[data-warning="a1"]')?.textContent).toContain(
      'まわりの記号と重なっている階名',
    );
  });
});

describe('ScoreViewer: 遅延描画', () => {
  /** IntersectionObserver を差し替え、どのページが画面の近くにあるかをテストから決める */
  function stubObserver() {
    const observers: { callback: IntersectionObserverCallback; elements: Element[] }[] = [];
    class FakeObserver {
      private readonly entry: { callback: IntersectionObserverCallback; elements: Element[] };
      constructor(callback: IntersectionObserverCallback) {
        this.entry = { callback, elements: [] };
        observers.push(this.entry);
      }
      observe(element: Element) {
        this.entry.elements.push(element);
      }
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    /** `index` 番目のページを近づける／遠ざける */
    const setNear = (index: number, near: boolean) => {
      const observer = observers[index];
      act(() => {
        observer?.callback(
          observer.elements.map((target) => ({ target, isIntersecting: near })) as never,
          observer as never,
        );
      });
    };
    return { setNear };
  }

  const manyAnnotations = preview(
    [0, 1, 2].map((index) =>
      page({
        sourcePageIndex: index,
        annotations: [
          {
            id: `a${index}`,
            x: 1,
            y: 1,
            text: `p${index}`,
            chromatic: false,
            origin: 'auto',
            textOverridden: false,
          },
        ],
      }),
    ),
  );

  it('画面の近くにあるページだけキャンバスと階名を描く', async () => {
    const { setNear } = stubObserver();
    const { renders } = setup({ preview: manyAnnotations }, 3);
    await screen.findByText('3 ページ');

    // 初期状態ではどのページも描かない（DOM 要素数を全音符数に比例させない）
    expect(renders).toEqual([]);
    expect(screen.queryByText('p0')).toBeNull();

    setNear(1, true);
    expect(renders).toEqual([1]);
    expect(screen.getByText('p1')).toBeDefined();
    expect(screen.queryByText('p0')).toBeNull();
    expect(screen.queryByText('p2')).toBeNull();
  });

  it('画面から離れたページは描画を止め、階名を外す', async () => {
    const { setNear } = stubObserver();
    const { cancels } = setup({ preview: manyAnnotations }, 3);
    await screen.findByText('3 ページ');

    setNear(0, true);
    setNear(0, false);
    expect(cancels).toEqual([0]);
    expect(screen.queryByText('p0')).toBeNull();
  });

  it('スキップ小節の枠は遠いページでも描く（ジャンプ先として常に存在させる）', async () => {
    stubObserver();
    setup(
      {
        preview: preview([
          page({
            sourcePageIndex: 2,
            skippedMeasures: [{ partId: 'P1', measureIndex: 9, x: 1, y: 2, width: 3, height: 4 }],
          }),
        ]),
      },
      3,
    );
    await screen.findByText('3 ページ');
    expect(document.querySelector('rect[data-region="P1:9"]')).not.toBeNull();
  });
});

describe('ScoreViewer: 表示幅の変化', () => {
  it('ページの表示幅が変わったら、その幅に合う倍率で描き直す', async () => {
    const callbacks: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          callbacks.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    const fake = fakeDocument(1);
    setup({ loadPdf: vi.fn<PdfLoader>().mockResolvedValue(fake.document) });
    await screen.findByText('1 ページ');
    const frame = document.querySelector('figure > div') as HTMLElement;
    Object.defineProperty(frame, 'clientWidth', { configurable: true, value: 1190.56 });

    act(() => {
      callbacks[0]?.([], {} as ResizeObserver);
    });

    const calls = vi.mocked(fake.document.renderPage).mock.calls;
    expect(calls).toHaveLength(2);
    // 表示幅 1191px（丸め）÷ ページ幅 595.28pt ≒ 2 倍
    expect(calls[1]?.[2]).toBeCloseTo((1191 / A4.widthPt) * (window.devicePixelRatio || 1), 6);
  });
});

describe('ScoreViewer: ジャンプ', () => {
  const withSkipped = preview([
    page({
      sourcePageIndex: 1,
      skippedMeasures: [
        { partId: 'P1', measureIndex: 4, x: 1, y: 2, width: 3, height: 4 },
        { partId: 'P2', measureIndex: 4, x: 1, y: 8, width: 3, height: 4 },
      ],
    }),
  ]);

  it('指定された小節の枠までスクロールし、強調表示する', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { props, view } = setup({ preview: withSkipped });
    await screen.findByText('2 ページ');

    view.rerender(<ScoreViewer {...props} focus={{ partId: 'P2', measureIndex: 4, seq: 1 }} />);

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    });
    const target = document.querySelector('rect[data-region="P2:4"]');
    expect(scrollIntoView.mock.contexts[0]).toBe(target);
    expect(target?.getAttribute('stroke')).toBe('#e65100');
    expect(document.querySelector('rect[data-region="P1:4"]')?.getAttribute('stroke')).toBe(
      '#f9a825',
    );
  });

  it('同じ小節を続けて指定してもスクロールし直す', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { props, view } = setup({ preview: withSkipped });
    await screen.findByText('2 ページ');

    view.rerender(<ScoreViewer {...props} focus={{ partId: 'P1', measureIndex: 4, seq: 1 }} />);
    view.rerender(<ScoreViewer {...props} focus={{ partId: 'P1', measureIndex: 4, seq: 2 }} />);

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledTimes(2);
    });
  });
});

describe('ScoreViewer: 編集の対象を選ぶ', () => {
  const annotation = {
    id: 'a1',
    x: 10,
    y: 20,
    text: 'do',
    chromatic: false,
    origin: 'auto' as const,
    textOverridden: false,
  };
  const withAnnotation = preview([
    page({
      sourcePageIndex: 1,
      annotations: [annotation],
      skippedMeasures: [{ partId: 'P1', measureIndex: 4, x: 100, y: 100, width: 50, height: 40 }],
      placementWarnings: [{ annotationId: 'a1', x: 10, y: 20 }],
    }),
  ]);

  /** SVG の表示寸法を決める（jsdom はレイアウトしないため、押した位置の換算に要る） */
  function layOut(svg: Element, width: number, height: number) {
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 50,
      width,
      height,
      right: 10 + width,
      bottom: 50 + height,
      x: 10,
      y: 50,
      toJSON: () => ({}),
    });
  }

  it('階名を押すと、その階名と元PDFのページを知らせる', async () => {
    const onPick = vi.fn();
    setup({ preview: withAnnotation, onPick });

    fireEvent.click(await screen.findByText('do'));

    expect(onPick).toHaveBeenCalledExactlyOnceWith({
      kind: 'annotation',
      sourcePageIndex: 1,
      annotation,
    });
  });

  it('配置警告の印を押しても、その階名を選ぶ', async () => {
    const onPick = vi.fn();
    setup({ preview: withAnnotation, onPick });
    await screen.findByText('do');

    fireEvent.click(document.querySelector('[data-warning="a1"] circle') as Element);

    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ kind: 'annotation' }));
  });

  it('空いた位置（スキップ小節の枠の中を含む）を押すと、ページのポイント座標を知らせる', async () => {
    const onPick = vi.fn();
    setup({ preview: withAnnotation, onPick });
    const svg = await screen.findByRole('img', { name: '2 ページの階名' });
    // 表示幅をページのポイント寸法のちょうど半分にする（1 px = 2 pt）
    layOut(svg, A4.widthPt / 2, A4.heightPt / 2);

    fireEvent.click(svg.querySelector('rect[data-region="P1:4"]') as Element, {
      clientX: 10 + 60,
      clientY: 50 + 55,
    });

    expect(onPick).toHaveBeenCalledOnce();
    const pick = onPick.mock.calls[0]?.[0];
    expect(pick).toMatchObject({ kind: 'point', sourcePageIndex: 1 });
    expect(pick.x).toBeCloseTo(120, 6);
    expect(pick.y).toBeCloseTo(110, 6);
  });

  it('編集できるときは、重ねるものが無いページにも書き足せる', async () => {
    const onPick = vi.fn();
    setup({ preview: withAnnotation, onPick });
    const svg = await screen.findByRole('img', { name: '1 ページの階名' });
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${A4.widthPt} ${A4.heightPt}`);
    layOut(svg, A4.widthPt, A4.heightPt);

    fireEvent.click(svg, { clientX: 10 + 30, clientY: 50 + 40 });

    expect(onPick).toHaveBeenCalledWith({ kind: 'point', sourcePageIndex: 0, x: 30, y: 40 });
  });

  it('レイアウト前（表示寸法 0）の押下は位置を決められないため知らせない', async () => {
    const onPick = vi.fn();
    setup({ preview: withAnnotation, onPick });
    const svg = await screen.findByRole('img', { name: '1 ページの階名' });

    fireEvent.click(svg, { clientX: 1, clientY: 1 });

    expect(onPick).not.toHaveBeenCalled();
  });

  it('選択中の階名を縁取りと下線で示し、書き足す位置に印を置く', async () => {
    setup({
      preview: withAnnotation,
      onPick: vi.fn(),
      selectedAnnotationId: 'a1',
      pendingPoint: { sourcePageIndex: 0, x: 30, y: 40 },
    });

    const text = await screen.findByText('do');
    expect(text.getAttribute('text-decoration')).toBe('underline');
    expect(text.getAttribute('stroke')).toBe('#1565c0');
    // 文字の色は出力PDFと同じまま
    expect(text.getAttribute('fill')).toBe('#8b0000');
    const marker = screen
      .getByRole('img', { name: '1 ページの階名' })
      .querySelector('[data-pending-point]');
    expect(marker?.getAttribute('transform')).toBe('translate(30 40)');
    // 書き足す位置の印は選んだページにだけ置く
    expect(
      screen.getByRole('img', { name: '2 ページの階名' }).querySelector('[data-pending-point]'),
    ).toBeNull();
  });

  it('onPick を渡さなければ読み取り専用（押しても何も起きない）', async () => {
    setup({ preview: withAnnotation });
    const text = await screen.findByText('do');
    expect(text.getAttribute('style')).toBeNull();
    // 重ねるものが無いページには SVG を置かない（従来どおり）
    expect(screen.queryByRole('img', { name: '1 ページの階名' })).toBeNull();
  });
});
