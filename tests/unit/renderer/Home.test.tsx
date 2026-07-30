import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Home } from '../../../src/renderer/screens/Home/Home';
import type { SolfaOverlayApi } from '../../../src/preload/api';

/** preload API を差し込む（未設定なら Electron 外での起動を再現する） */
function stubApi(overrides: Partial<SolfaOverlayApi> = {}): void {
  window.solfaOverlay = {
    getAppVersion: vi.fn().mockResolvedValue('0.1.0'),
    ...overrides,
  } as unknown as SolfaOverlayApi;
}

afterEach(() => {
  delete window.solfaOverlay;
});

function setup(overrides: Partial<Parameters<typeof Home>[0]> = {}) {
  const props = {
    onImportPdf: vi.fn(),
    onOpenProject: vi.fn(),
    errorMessage: null,
    busy: false,
    ...overrides,
  };
  render(<Home {...props} />);
  return props;
}

describe('Home', () => {
  it('見出しの直後に「今すべきこと」を 1 文置く', () => {
    stubApi();
    setup();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.nextElementSibling?.textContent).toContain('まず楽譜のPDFを取り込んで');
  });

  it('操作できない環境では、存在しないボタンを案内しない', () => {
    setup(); // api なし＝ブラウザプレビュー
    expect(screen.queryByText(/まず楽譜のPDFを取り込んで/)).toBeNull();
  });

  it('Electron 外ではプレビュー表示にし、操作を出さない（押しても何も起きない導線を作らない）', () => {
    setup();
    expect(screen.getByText(/ブラウザプレビュー/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'PDFを取り込む' })).toBeNull();
  });

  it('バージョンを取得して表示する', async () => {
    stubApi();
    setup();
    await waitFor(() => {
      expect(screen.getByText('バージョン: 0.1.0')).toBeDefined();
    });
  });

  it('バージョン取得に失敗しても「取得中」で固まらない', async () => {
    stubApi({ getAppVersion: vi.fn().mockRejectedValue(new Error('失敗')) });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setup();
    await waitFor(() => {
      expect(screen.getByText('バージョン: 取得失敗')).toBeDefined();
    });
  });

  it('2 つの入口を提供する', async () => {
    stubApi();
    const props = setup();

    await userEvent.click(screen.getByRole('button', { name: 'PDFを取り込む' }));
    expect(props.onImportPdf).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'プロジェクトを開く' }));
    expect(props.onOpenProject).toHaveBeenCalled();
  });

  it('直前の失敗を警告として示す', () => {
    stubApi();
    setup({ errorMessage: 'プロジェクトファイルが壊れています' });
    expect(screen.getByRole('alert').textContent).toBe('プロジェクトファイルが壊れています');
  });

  it('処理中は入口を塞ぐ', () => {
    stubApi();
    setup({ busy: true });
    expect(screen.getByRole('button', { name: 'PDFを取り込む' }).hasAttribute('disabled')).toBe(
      true,
    );
  });
});
