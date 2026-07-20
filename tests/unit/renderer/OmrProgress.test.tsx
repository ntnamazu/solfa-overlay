import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OmrProgress } from '../../../src/renderer/screens/OmrProgress/OmrProgress';
import type { OmrProgress as OmrProgressData } from '../../../src/shared/types/OmrProgress';

const progressOf = (overrides: Partial<OmrProgressData> = {}): OmrProgressData => ({
  phase: 'transcribing',
  sheet: 3,
  totalSheets: 20,
  message: '',
  ...overrides,
});

function setup(overrides: Partial<Parameters<typeof OmrProgress>[0]> = {}) {
  const props = {
    progress: progressOf(),
    onCancel: vi.fn(),
    canceling: false,
    ...overrides,
  };
  render(<OmrProgress {...props} />);
  return props;
}

describe('OmrProgress', () => {
  it.each([
    ['starting', 'Audiveris を起動しています…'],
    ['loading', 'PDF を読み込んでいます…'],
    ['transcribing', '楽譜を認識しています…'],
    ['exporting', '認識結果を書き出しています…'],
    ['completed', '認識が完了しました'],
  ] as const)('%s の局面を日本語で示す', (phase, label) => {
    setup({ progress: progressOf({ phase }) });
    expect(screen.getByText(label)).toBeDefined();
  });

  it('進捗が届く前でも起動中として表示する（無言の空画面を出さない）', () => {
    setup({ progress: null });
    expect(screen.getByText('Audiveris を起動しています…')).toBeDefined();
  });

  it('ページ番号と総数を示す', () => {
    setup();
    expect(screen.getByText('3 / 20 ページ')).toBeDefined();
    expect((screen.getByLabelText('認識の進捗') as HTMLProgressElement).value).toBe(3);
  });

  it('総数が不明ならページ番号だけを示し、進捗バーは出さない（偽の割合を見せない）', () => {
    setup({ progress: progressOf({ totalSheets: null }) });
    expect(screen.getByText('3 ページ目')).toBeDefined();
    expect(screen.queryByLabelText('認識の進捗')).toBeNull();
  });

  it('ページが特定できなければページ表示自体を出さない', () => {
    setup({ progress: progressOf({ sheet: null }) });
    expect(screen.queryByLabelText('認識の進捗')).toBeNull();
    expect(screen.queryByText(/ページ/)).toBeNull();
  });

  it('キャンセルを通知する', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(props.onCancel).toHaveBeenCalled();
  });

  it('キャンセル中は再押下できない（重複した kill を送らない）', () => {
    setup({ canceling: true });
    const button = screen.getByRole('button', { name: 'キャンセルしています…' });
    expect(button.hasAttribute('disabled')).toBe(true);
  });
});
