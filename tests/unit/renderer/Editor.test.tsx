import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Editor } from '../../../src/renderer/screens/Editor/Editor';
import type { PdfDocumentHandle, PdfLoader } from '../../../src/renderer/viewer/pdfDocument';
import type { ScoreModel } from '../../../src/shared/types/ScoreModel';
import type { ScorePreview } from '../../../src/shared/types/ScorePreview';
import { project, snapshot } from './fixtures';

const APPROVED = '2026-07-20T00:00:00.000Z';

const score = (overrides: Partial<ScoreModel> = {}): ScoreModel => ({
  parts: [{ id: 'P1', name: 'Soprano', staves: [] }],
  systems: [],
  measures: [],
  ...overrides,
});

/** 既定の props（各テストで必要な部分だけ上書きする） */
function setup(overrides: Partial<Parameters<typeof Editor>[0]> = {}) {
  const props = {
    project: project({
      score: score(),
      confirmation: { items: [], completedAt: APPROVED },
    }),
    preview: [
      { partId: 'P1', partName: 'Soprano', measureIndex: 0, syllables: ['do', 're', 'mi'] },
    ],
    scorePreview: snapshot().scorePreview,
    sourcePdf: null as Uint8Array | null,
    sourcePdfError: null as string | null,
    pageIssues: [],
    annotationIssues: [],
    unmatchedCorrections: [],
    exportSummary: null,
    onExportPdf: vi.fn(),
    onChangeSettings: vi.fn(),
    onBackToConfirm: vi.fn(),
    busy: false,
    ...overrides,
  };
  render(<Editor {...props} />);
  return props;
}

describe('Editor', () => {
  it('見出しの直後に「今すべきこと」を 1 文置く', () => {
    setup();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.nextElementSibling?.textContent).toContain('注釈付きPDFを出力');
  });

  it('階名プレビューをパート・小節・階名列で示す', () => {
    setup();

    expect(screen.getByText('Soprano')).toBeDefined();
    expect(screen.getByText('do re mi')).toBeDefined();
    // 小節番号は 1 始まりで表示する（内部は 0 始まり）
    expect(screen.getByRole('cell', { name: '1' })).toBeDefined();
  });

  it('楽譜プレビュー区画を置き、元PDF の取得を待つ間は読み込み中と示す', () => {
    setup();
    expect(screen.getByRole('heading', { name: '楽譜プレビュー' })).toBeDefined();
    expect(screen.getByText('楽譜を読み込んでいます…')).toBeDefined();
  });

  describe('区画の並び', () => {
    /** 見出し（h2）とボタンを文書順に並べた一覧 */
    function landmarks(): string[] {
      return [...document.querySelectorAll('h2, main > button')].map(
        (element) => element.textContent ?? '',
      );
    }

    it('楽譜プレビューを最後に置く（全ページを縦に並べるため、後ろの区画が隠れる）', () => {
      setup({
        project: project({
          score: score({
            measures: [{ partId: 'P1', index: 0, status: 'skipped', notes: [] }],
          }),
          confirmation: { items: [], completedAt: APPROVED },
        }),
      });
      const order = landmarks();
      expect(order[order.length - 1]).toBe('楽譜プレビュー');
    });

    it('スキップ小節の一覧・PDF出力・確認画面へ戻るはプレビューより上に置く', () => {
      setup({
        project: project({
          score: score({
            measures: [{ partId: 'P1', index: 0, status: 'skipped', notes: [] }],
          }),
          confirmation: { items: [], completedAt: APPROVED },
        }),
        annotationIssues: [{ kind: 'placementUnresolved', annotationId: 'solfa-n1', pageIndex: 0 }],
      });
      const order = landmarks();
      const preview = order.indexOf('楽譜プレビュー');
      for (const label of [
        '階名が付かなかった小節（1 件）',
        '配置を調整できなかった注釈（1 件）',
        'PDF出力',
        '確認画面へ戻る',
      ]) {
        expect(order.indexOf(label), label).toBeGreaterThanOrEqual(0);
        expect(order.indexOf(label), label).toBeLessThan(preview);
      }
    });
  });

  it('元PDF を取得できなければ楽譜プレビュー区画に理由を示す', () => {
    setup({ sourcePdfError: '読み込めません' });
    expect(screen.getByText('楽譜を表示できませんでした（読み込めません）。')).toBeDefined();
  });

  it('プレビューが空なら理由を明示する（無言の空表にしない）', () => {
    setup({ preview: [] });
    expect(screen.getByText('表示できる階名がありません。')).toBeDefined();
  });

  it('注釈数と音符数を概要に出す', () => {
    setup({
      project: project({
        score: score({
          measures: [
            {
              partId: 'P1',
              index: 0,
              status: 'matched',
              notes: [
                {
                  id: 'n1',
                  partId: 'P1',
                  measureIndex: 0,
                  pitch: { step: 'C', alter: 0, octave: 4 },
                  head: { pageIndex: 0, x: 0, y: 0 },
                  solfa: { degree: 1, alteration: 0 },
                },
              ],
            },
          ],
        }),
        annotations: [
          {
            id: 'solfa-n1',
            layer: 'solfa',
            anchor: { pageIndex: 0, x: 0, y: 0 },
            noteId: 'n1',
            text: null,
            origin: 'auto',
            deleted: false,
          },
        ],
        confirmation: { items: [], completedAt: APPROVED },
      }),
    });

    expect(screen.getByText('照合できた音符: 1')).toBeDefined();
    expect(screen.getByText('注釈: 1')).toBeDefined();
  });

  describe('階名の表記', () => {
    it('楽譜プレビューの直前に置く（切り替えた結果がすぐ下で見える）', () => {
      setup();
      const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
      expect(headings.indexOf('階名の表記')).toBe(headings.indexOf('楽譜プレビュー') - 1);
    });

    it('プロジェクトの設定を選択状態で表示し、切り替えを設定全体で渡す', async () => {
      const props = setup();
      const tonicSolfa = screen.getByRole('radio', { name: 'Tonic sol-fa 略記（d r m f s l t）' });

      expect(
        screen.getByRole<HTMLInputElement>('radio', { name: 'コダーイ式（do re mi fa so la ti）' })
          .checked,
      ).toBe(true);
      await userEvent.click(tonicSolfa);
      expect(props.onChangeSettings).toHaveBeenCalledExactlyOnceWith({
        ...props.project.settings,
        syllableSystem: 'tonicSolfa',
      });
    });

    it('処理中は切り替えられない', async () => {
      const props = setup({ busy: true });
      await userEvent.click(
        screen.getByRole('radio', { name: 'Do基準（短調の主音を do と読む）' }),
      );
      expect(props.onChangeSettings).not.toHaveBeenCalled();
    });
  });

  describe('PDF出力', () => {
    it('承認済みなら出力ボタンを押せる', async () => {
      const props = setup();
      const button = screen.getByRole('button', { name: '注釈付きPDFを出力' });

      expect(button.hasAttribute('disabled')).toBe(false);
      await userEvent.click(button);
      expect(props.onExportPdf).toHaveBeenCalled();
    });

    it('承認前は出力できず、理由を表示する', () => {
      setup({
        project: project({ score: score(), confirmation: { items: [], completedAt: null } }),
      });

      expect(
        screen.getByRole('button', { name: '注釈付きPDFを出力' }).hasAttribute('disabled'),
      ).toBe(true);
      expect(screen.getByRole('alert').textContent).toContain('確認が完了していない');
    });

    it('処理中は出力ボタンを押せない', () => {
      setup({ busy: true });
      expect(
        screen.getByRole('button', { name: '注釈付きPDFを出力' }).hasAttribute('disabled'),
      ).toBe(true);
    });

    it('出力に成功したら保存先と件数を示す', () => {
      setup({
        exportSummary: {
          outPath: '/home/me/score-solfa.pdf',
          drawnCount: 808,
          unresolvedPlacements: 0,
          renderIssues: [],
        },
      });

      expect(screen.getByText(/\/home\/me\/score-solfa\.pdf/)).toBeDefined();
      expect(screen.getByText(/808 件の階名を出力しました/)).toBeDefined();
    });

    it('出力時に注意事項があれば件数を添える', () => {
      setup({
        exportSummary: {
          outPath: '/out.pdf',
          drawnCount: 10,
          unresolvedPlacements: 2,
          renderIssues: [{ kind: 'characterSubstituted', from: '♭', to: 'b', count: 3 }],
        },
      });

      expect(screen.getByText(/1 件の注意事項があります/)).toBeDefined();
    });
  });

  describe('問題の提示', () => {
    it('スキップ小節を一覧にする', () => {
      setup({
        project: project({
          score: score({
            measures: [{ partId: 'P1', index: 4, status: 'skipped', notes: [] }],
          }),
          confirmation: { items: [], completedAt: APPROVED },
        }),
      });

      expect(screen.getByRole('heading', { name: /階名が付かなかった小節（1 件）/ })).toBeDefined();
      // プレビュー表と同じ呼び方をする（違う名前だと行同士を対応付けられない）
      const texts = screen.getAllByRole('listitem').map((item) => item.textContent);
      expect(texts.some((text) => text?.startsWith('Sopranoの 5 小節目'))).toBe(true);
    });

    it('楽譜上の位置が分からない小節も一覧から消さず、押せない行として理由を添える', () => {
      setup({
        project: project({
          score: score({
            measures: [{ partId: 'P1', index: 4, status: 'skipped', notes: [] }],
          }),
          confirmation: { items: [], completedAt: APPROVED },
        }),
      });

      expect(screen.getByText('Sopranoの 5 小節目（楽譜上の位置を特定できません）')).toBeDefined();
      expect(screen.queryByRole('button', { name: 'Sopranoの 5 小節目' })).toBeNull();
    });

    it('楽譜上の位置が分かる小節は、押すとその位置へ移動する', async () => {
      const scrollIntoView = vi.fn();
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = scrollIntoView;
      const document_: PdfDocumentHandle = {
        pageSizes: [{ widthPt: 595, heightPt: 842 }],
        renderPage: () => ({ promise: Promise.resolve(), cancel: () => {} }),
        destroy: () => {},
      };
      const located: ScorePreview = {
        ...snapshot().scorePreview,
        pages: [
          {
            sourcePageIndex: 0,
            widthPt: 595,
            heightPt: 842,
            annotations: [],
            skippedMeasures: [{ partId: 'P1', measureIndex: 4, x: 1, y: 2, width: 3, height: 4 }],
            placementWarnings: [],
          },
        ],
      };
      try {
        setup({
          project: project({
            score: score({
              measures: [{ partId: 'P1', index: 4, status: 'skipped', notes: [] }],
            }),
            confirmation: { items: [], completedAt: APPROVED },
          }),
          scorePreview: located,
          sourcePdf: new Uint8Array([1]),
          loadPdf: vi.fn<PdfLoader>().mockResolvedValue(document_),
        });
        await screen.findByText('1 ページ');

        await userEvent.click(screen.getByRole('button', { name: 'Sopranoの 5 小節目' }));

        expect(scrollIntoView).toHaveBeenCalledTimes(1);
        expect(scrollIntoView.mock.contexts[0]).toBe(
          document.querySelector('rect[data-region="P1:4"]'),
        );
      } finally {
        Element.prototype.scrollIntoView = original;
      }
    });

    it('パート名のない楽譜でも内部 ID を出さない', () => {
      // MusicXmlParser は <part-name> が無いと name に partId をそのまま入れる
      setup({
        project: project({
          score: score({
            parts: [{ id: 'P1', name: 'P1', staves: [] }],
            measures: [{ partId: 'P1', index: 4, status: 'skipped', notes: [] }],
          }),
          confirmation: { items: [], completedAt: APPROVED },
        }),
        preview: [{ partId: 'P1', partName: 'P1', measureIndex: 0, syllables: ['do'] }],
      });

      expect(screen.getByRole('main').textContent).not.toContain('P1');
      expect(screen.getAllByText(/上から1番目のパート/).length).toBeGreaterThan(0);
    });

    it('配置を調整できなかった注釈の件数を示す', () => {
      setup({
        annotationIssues: [
          { kind: 'placementUnresolved', annotationId: 'solfa-n1', pageIndex: 0 },
          { kind: 'placementUnresolved', annotationId: 'solfa-n2', pageIndex: 1 },
        ],
      });

      expect(
        screen.getByRole('heading', { name: /配置を調整できなかった注釈（2 件）/ }),
      ).toBeDefined();
    });

    it('孤立注釈は出力されないことを伝える', () => {
      setup({ annotationIssues: [{ kind: 'orphanAnnotation', annotationId: 'solfa-old' }] });

      expect(
        screen.getByRole('heading', { name: /対応する音符が見つからない注釈（1 件）/ }),
      ).toBeDefined();
      expect(screen.getByText(/これらの注釈は出力されません/)).toBeDefined();
    });

    it('元PDFが読めない場合は出力できないことまで伝える', () => {
      setup({ pageIssues: [{ kind: 'sourcePdfUnreadable', message: 'No PDF header found' }] });

      expect(screen.getByText(/元PDFを読み込めませんでした/)).toBeDefined();
      expect(screen.getByText(/PDF出力はできません/)).toBeDefined();
    });

    it('ページ対応の欠落を具体的なページ番号で示す', () => {
      setup({
        pageIssues: [{ kind: 'sourcePageMissing', pageIndex: 2, sourcePageNumber: 4 }],
      });

      expect(screen.getByText('3ページ目に対応する元PDFのページ（4）がありません')).toBeDefined();
    });

    it('適用されなかった訂正を表示する（Phase 4 からの申し送り）', () => {
      setup({
        unmatchedCorrections: [
          { kind: 'clef', itemId: 'clef-P6-ALTO' },
          { kind: 'structure', pageIndex: 1, systemIndex: 2 },
        ],
      });

      expect(screen.getByRole('heading', { name: /適用されなかった訂正（2 件）/ })).toBeDefined();
      expect(screen.getByText(/音部記号の訂正「clef-P6-ALTO」/)).toBeDefined();
      expect(screen.getByText(/2ページ 3段目への訂正/)).toBeDefined();
    });

    it('問題がなければ該当する見出しを出さない', () => {
      setup();

      expect(screen.queryByRole('heading', { name: /階名が付かなかった小節/ })).toBeNull();
      expect(screen.queryByRole('heading', { name: /適用されなかった訂正/ })).toBeNull();
      expect(screen.queryByRole('heading', { name: /ページの問題/ })).toBeNull();
    });
  });

  it('確認画面へ戻れる', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: '確認画面へ戻る' }));
    expect(props.onBackToConfirm).toHaveBeenCalled();
  });
});
