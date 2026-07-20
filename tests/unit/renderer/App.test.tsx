import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SolfaOverlayApi } from '../../../src/preload/api';
import type { IpcErrorKind } from '../../../src/shared/ipc/contract';
import { App } from '../../../src/renderer/App';
import type { OmrProgress } from '../../../src/shared/types/OmrProgress';
import { confirmationItem, keyRegion, project, snapshot } from './fixtures';

/**
 * 画面遷移とIPC結線のテスト
 *
 * 各画面の描画は個別のテストが担うため、ここは**どの操作でどの IPC を呼び、
 * どの画面へ移るか**に絞る
 */

type ProgressListener = (progress: OmrProgress) => void;

const ok = <T,>(value: T) => ({ ok: true as const, value });
const fail = (message: string, kind: IpcErrorKind = 'projectFile') => ({
  ok: false as const,
  error: { kind, message },
});

/** 既定は「すべて成功する」API。テストごとに必要な部分を上書きする */
function stubApi(overrides: Partial<SolfaOverlayApi> = {}) {
  const listeners: ProgressListener[] = [];
  const unsubscribe = vi.fn();
  const api = {
    getAppVersion: vi.fn().mockResolvedValue('0.1.0'),
    chooseSourcePdf: vi.fn().mockResolvedValue('/scores/song.pdf'),
    chooseProjectFile: vi.fn().mockResolvedValue('/scores/song.solfaproj'),
    chooseSavePath: vi.fn().mockResolvedValue('/scores/song.solfaproj'),
    chooseExportPdfPath: vi.fn().mockResolvedValue('/scores/song-solfa.pdf'),
    exportPdf: vi.fn().mockResolvedValue(
      ok({
        outPath: '/scores/song-solfa.pdf',
        drawnCount: 808,
        unresolvedPlacements: 0,
        renderIssues: [],
      }),
    ),
    importPdf: vi.fn().mockResolvedValue(ok(snapshot())),
    openProject: vi.fn().mockResolvedValue(ok(snapshot())),
    saveProject: vi.fn().mockResolvedValue(ok(project())),
    cancelOmr: vi.fn().mockResolvedValue(ok(null)),
    setStructureDecisions: vi.fn().mockResolvedValue(ok(snapshot())),
    setClefCorrections: vi.fn().mockResolvedValue(ok(snapshot())),
    setKeyRegionDecisions: vi.fn().mockResolvedValue(ok(snapshot())),
    setSettings: vi.fn().mockResolvedValue(ok(snapshot())),
    completeConfirmation: vi.fn().mockResolvedValue(ok(snapshot())),
    onOmrProgress: vi.fn((listener: ProgressListener) => {
      listeners.push(listener);
      return unsubscribe;
    }),
    ...overrides,
  } as unknown as SolfaOverlayApi;

  window.solfaOverlay = api;
  return { api, listeners, unsubscribe };
}

afterEach(() => {
  delete window.solfaOverlay;
});

/** Home → OMR → 構造確認 まで進める */
async function advanceToStructure() {
  await userEvent.click(await screen.findByRole('button', { name: 'PDFを取り込む' }));
  await screen.findByRole('heading', { name: '譜表構造の確認' });
}

describe('App', () => {
  it('起動時は Home を出す', () => {
    stubApi();
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Solfa Overlay' })).toBeDefined();
  });

  it('PDF を取り込むと進捗画面を経て構造確認へ進む', async () => {
    const { api } = stubApi();
    render(<App />);

    await advanceToStructure();
    expect(api.chooseSourcePdf).toHaveBeenCalled();
    expect(api.importPdf).toHaveBeenCalledWith('/scores/song.pdf');
  });

  it('PDF 選択をキャンセルしたら Home に留まる（エラーにしない）', async () => {
    const { api } = stubApi({ chooseSourcePdf: vi.fn().mockResolvedValue(null) });
    render(<App />);

    await userEvent.click(await screen.findByRole('button', { name: 'PDFを取り込む' }));
    expect(api.importPdf).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Solfa Overlay' })).toBeDefined();
  });

  it('進捗イベントを進捗画面へ反映する', async () => {
    let resolveImport: ((value: unknown) => void) | undefined;
    const { listeners } = stubApi({
      importPdf: vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveImport = resolve;
        }),
      ),
    });
    render(<App />);

    await userEvent.click(await screen.findByRole('button', { name: 'PDFを取り込む' }));
    await screen.findByRole('heading', { name: '楽譜を認識しています' });

    listeners.forEach((listener) =>
      listener({ phase: 'transcribing', sheet: 2, totalSheets: 20, message: '' }),
    );
    await waitFor(() => {
      expect(screen.getByText('2 / 20 ページ')).toBeDefined();
    });

    resolveImport?.(ok(snapshot()));
  });

  it('OMR に失敗したら Home へ戻し、理由を示す（進捗画面に閉じ込めない）', async () => {
    stubApi({ importPdf: vi.fn().mockResolvedValue(fail('Audiveris が異常終了しました', 'omr')) });
    render(<App />);

    await userEvent.click(await screen.findByRole('button', { name: 'PDFを取り込む' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Audiveris が異常終了しました');
    });
    expect(screen.getByRole('heading', { name: 'Solfa Overlay' })).toBeDefined();
  });

  it('進捗画面でキャンセルを依頼できる', async () => {
    const { api } = stubApi({
      importPdf: vi.fn().mockReturnValue(new Promise(() => {})),
    });
    render(<App />);

    await userEvent.click(await screen.findByRole('button', { name: 'PDFを取り込む' }));
    await userEvent.click(await screen.findByRole('button', { name: 'キャンセル' }));
    expect(api.cancelOmr).toHaveBeenCalled();
  });

  it('キャンセルに失敗したら再試行できる状態へ戻す', async () => {
    stubApi({
      importPdf: vi.fn().mockReturnValue(new Promise(() => {})),
      cancelOmr: vi.fn().mockResolvedValue(fail('キャンセルできませんでした', 'omr')),
    });
    render(<App />);

    await userEvent.click(await screen.findByRole('button', { name: 'PDFを取り込む' }));
    await userEvent.click(await screen.findByRole('button', { name: 'キャンセル' }));

    // 無効化したままだと、走り続けている Audiveris を止める手段がなくなる
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'キャンセル' }).hasAttribute('disabled')).toBe(
        false,
      );
    });
  });

  it('プロジェクトを開くと構造確認へ進む', async () => {
    const { api } = stubApi();
    render(<App />);

    await userEvent.click(await screen.findByRole('button', { name: 'プロジェクトを開く' }));
    await screen.findByRole('heading', { name: '譜表構造の確認' });
    expect(api.openProject).toHaveBeenCalledWith('/scores/song.solfaproj');
  });

  it('プロジェクトを開けなかったら Home に留まり理由を示す', async () => {
    stubApi({
      openProject: vi
        .fn()
        .mockResolvedValue(
          fail('新しいバージョンのアプリで作成されたファイルです', 'projectVersion'),
        ),
    });
    render(<App />);

    await userEvent.click(await screen.findByRole('button', { name: 'プロジェクトを開く' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('新しいバージョン');
    });
  });

  it('構造確認から音部記号・調の確認へ進む', async () => {
    stubApi();
    render(<App />);

    await advanceToStructure();
    await userEvent.click(screen.getByRole('button', { name: '音部記号・調の確認へ' }));
    expect(screen.getByRole('heading', { name: '音部記号と調の確認' })).toBeDefined();
  });

  it('音部記号の訂正を Main へ送り、返ってきた結果で画面を更新する', async () => {
    const corrected = snapshot({
      project: project({
        confirmation: {
          items: [confirmationItem({ corrected: 'TREBLE', mismatchCount: 0 })],
          completedAt: null,
        },
        keyRegions: [keyRegion()],
      }),
    });
    const { api } = stubApi({
      importPdf: vi.fn().mockResolvedValue(
        ok(
          snapshot({
            project: project({
              confirmation: { items: [confirmationItem()], completedAt: null },
              keyRegions: [keyRegion()],
            }),
          }),
        ),
      ),
      setClefCorrections: vi.fn().mockResolvedValue(ok(corrected)),
    });
    render(<App />);

    await advanceToStructure();
    await userEvent.click(screen.getByRole('button', { name: '音部記号・調の確認へ' }));
    await userEvent.selectOptions(screen.getByLabelText('P6 の音部記号（検出: ALTO）'), 'TREBLE');

    expect(api.setClefCorrections).toHaveBeenCalledWith({ 'clef-P6-ALTO': 'TREBLE' });
    // Main が返した結果をそのまま反映する（Renderer 側で状態を組み立て直さない）
    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull();
    });
  });

  it('承認すると保存先を尋ねて保存する', async () => {
    const { api } = stubApi();
    render(<App />);

    await advanceToStructure();
    await userEvent.click(screen.getByRole('button', { name: '音部記号・調の確認へ' }));
    await userEvent.click(screen.getByRole('button', { name: '確認を完了する' }));

    await waitFor(() => {
      expect(api.completeConfirmation).toHaveBeenCalled();
    });
    expect(api.chooseSavePath).toHaveBeenCalled();
    expect(api.saveProject).toHaveBeenCalledWith('/scores/song.solfaproj');
  });

  it('保存先の選択をキャンセルしたら保存せず、その旨を伝える', async () => {
    const { api } = stubApi({ chooseSavePath: vi.fn().mockResolvedValue(null) });
    render(<App />);

    await advanceToStructure();
    await userEvent.click(screen.getByRole('button', { name: '音部記号・調の確認へ' }));
    await userEvent.click(screen.getByRole('button', { name: '確認を完了する' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('保存していません');
    });
    // 保存先が決まらないまま黙って上書き保存を試みると、意図しないファイルを壊しかねない
    expect(api.saveProject).not.toHaveBeenCalled();
  });

  it('既に保存先が決まっていればダイアログを出さず上書きする', async () => {
    const saved = snapshot({ filePath: '/scores/song.solfaproj' });
    const { api } = stubApi({
      importPdf: vi.fn().mockResolvedValue(ok(saved)),
      completeConfirmation: vi.fn().mockResolvedValue(ok(saved)),
    });
    render(<App />);

    await advanceToStructure();
    await userEvent.click(screen.getByRole('button', { name: '音部記号・調の確認へ' }));
    await userEvent.click(screen.getByRole('button', { name: '確認を完了する' }));

    await waitFor(() => {
      expect(api.saveProject).toHaveBeenCalledWith(undefined);
    });
    // 毎回「名前を付けて保存」を出すと別名ファイルが増え、元のファイルが更新されない
    expect(api.chooseSavePath).not.toHaveBeenCalled();
  });

  it('保存に失敗したら理由を示す', async () => {
    stubApi({ saveProject: vi.fn().mockResolvedValue(fail('書き込めません', 'io')) });
    render(<App />);

    await advanceToStructure();
    await userEvent.click(screen.getByRole('button', { name: '音部記号・調の確認へ' }));
    await userEvent.click(screen.getByRole('button', { name: '確認を完了する' }));

    // 承認自体は成功しているため Editor へ進むが、保存の失敗は理由付きで表示し続ける
    // （Editor は自前で通知を描かないため、App が添えないと無言で握りつぶされる）
    await waitFor(() => {
      expect(screen.getByText('書き込めません')).toBeDefined();
    });
    expect(screen.getByRole('heading', { name: '階名の確認と出力' })).toBeDefined();
  });

  describe('Editor と PDF 出力', () => {
    /** 承認済みのスナップショット（Editor が出力可能な状態） */
    const approved = () =>
      snapshot({
        project: project({
          confirmation: { items: [confirmationItem()], completedAt: '2026-07-20T00:00:00.000Z' },
          score: { parts: [], systems: [], measures: [] },
        }),
        filePath: '/scores/song.solfaproj',
        preview: [{ partId: 'P1', partName: 'Soprano', measureIndex: 0, syllables: ['do', 're'] }],
      });

    /** Home → 構造確認 → 音部記号確認 → 承認 → Editor まで進める */
    async function advanceToEditor() {
      await advanceToStructure();
      await userEvent.click(screen.getByRole('button', { name: '音部記号・調の確認へ' }));
      await userEvent.click(screen.getByRole('button', { name: '確認を完了する' }));
      await screen.findByRole('heading', { name: '階名の確認と出力' });
    }

    it('承認すると Editor へ進む', async () => {
      stubApi({ completeConfirmation: vi.fn().mockResolvedValue(ok(approved())) });
      render(<App />);

      await advanceToEditor();
      expect(screen.getByText('do re')).toBeDefined();
    });

    it('出力ボタンで保存先を尋ね、選ばれたパスで出力する', async () => {
      const { api } = stubApi({ completeConfirmation: vi.fn().mockResolvedValue(ok(approved())) });
      render(<App />);

      await advanceToEditor();
      await userEvent.click(screen.getByRole('button', { name: '注釈付きPDFを出力' }));

      await waitFor(() => {
        expect(api.exportPdf).toHaveBeenCalledWith('/scores/song-solfa.pdf');
      });
      expect(screen.getByText(/808 件の階名を出力しました/)).toBeDefined();
    });

    it('保存先の選択をキャンセルしたら出力しない（エラーにもしない）', async () => {
      const { api } = stubApi({
        completeConfirmation: vi.fn().mockResolvedValue(ok(approved())),
        chooseExportPdfPath: vi.fn().mockResolvedValue(null),
      });
      render(<App />);

      await advanceToEditor();
      await userEvent.click(screen.getByRole('button', { name: '注釈付きPDFを出力' }));

      expect(api.exportPdf).not.toHaveBeenCalled();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('出力に失敗したら理由を表示する', async () => {
      stubApi({
        completeConfirmation: vi.fn().mockResolvedValue(ok(approved())),
        exportPdf: vi.fn().mockResolvedValue(fail('保存先に書き込めません', 'io')),
      });
      render(<App />);

      await advanceToEditor();
      await userEvent.click(screen.getByRole('button', { name: '注釈付きPDFを出力' }));

      await waitFor(() => {
        expect(screen.getByRole('alert').textContent).toBe('保存先に書き込めません');
      });
      // 成功したかのような表示を残さない
      expect(screen.queryByText(/件の階名を出力しました/)).toBeNull();
    });

    it('確認画面へ戻れる', async () => {
      stubApi({ completeConfirmation: vi.fn().mockResolvedValue(ok(approved())) });
      render(<App />);

      await advanceToEditor();
      await userEvent.click(screen.getByRole('button', { name: '確認画面へ戻る' }));

      expect(screen.getByRole('heading', { name: '音部記号と調の確認' })).toBeDefined();
    });
  });

  it('進捗の購読をアンマウント時に解除する（リスナーの積み上がりを防ぐ）', () => {
    const { unsubscribe } = stubApi();
    const { unmount } = render(<App />);
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('Electron 外では IPC を呼ばずプレビュー表示になる', () => {
    render(<App />);
    expect(screen.getByText(/ブラウザプレビュー/)).toBeDefined();
  });
});
