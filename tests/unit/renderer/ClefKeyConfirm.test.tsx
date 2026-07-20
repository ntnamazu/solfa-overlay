import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ClefKeyConfirm } from '../../../src/renderer/screens/ClefKeyConfirm/ClefKeyConfirm';
import { confirmationItem, keyRegion } from './fixtures';

/** 既定の props（各テストで必要な部分だけ上書きする） */
function setup(overrides: Partial<Parameters<typeof ClefKeyConfirm>[0]> = {}) {
  const props = {
    items: [confirmationItem()],
    keyRegions: [keyRegion()],
    keyRegionDecisions: [],
    onCorrectClef: vi.fn(),
    onDecideKeyRegions: vi.fn(),
    onApprove: vi.fn(),
    busy: false,
    ...overrides,
  };
  render(<ClefKeyConfirm {...props} />);
  return props;
}

describe('ClefKeyConfirm', () => {
  it('音部記号と調を別々の表で示す（譜表の性質と小節区間の性質を混ぜない）', () => {
    setup();
    expect(screen.getByRole('heading', { name: '音部記号' })).toBeDefined();
    expect(screen.getByRole('heading', { name: '調' })).toBeDefined();
  });

  it('グループの対象段数と不一致件数を出す（どの行を直すべきか判断できるように）', () => {
    setup({
      items: [
        confirmationItem({
          staffRefs: Array.from({ length: 35 }, (_, index) => ({
            pageIndex: index,
            systemIndex: 0,
            staffIndex: 0,
            partId: 'P6',
          })),
        }),
      ],
    });

    expect(screen.getByText('35')).toBeDefined();
    expect(screen.getByText('402')).toBeDefined();
  });

  it('音部記号を訂正すると項目 id と訂正値を通知する', async () => {
    const props = setup();
    await userEvent.selectOptions(screen.getByLabelText('P6 の音部記号（検出: ALTO）'), 'TREBLE');
    expect(props.onCorrectClef).toHaveBeenCalledWith({ 'clef-P6-ALTO': 'TREBLE' });
  });

  it('「訂正しない」を選ぶと訂正を取り消す（null を送る）', async () => {
    const props = setup({ items: [confirmationItem({ corrected: 'TREBLE' })] });
    await userEvent.selectOptions(screen.getByLabelText('P6 の音部記号（検出: ALTO）'), '');
    expect(props.onCorrectClef).toHaveBeenCalledWith({ 'clef-P6-ALTO': null });
  });

  it('同義の別名（G_CLEF / F_CLEF）は選択肢に出さない', () => {
    setup();
    const options = screen
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value);
    expect(options).not.toContain('G_CLEF');
    expect(options).not.toContain('F_CLEF');
    expect(options).toContain('TREBLE');
  });

  it('旋法を短調に変えると開始小節を伴う判断を通知する', async () => {
    const props = setup({ keyRegions: [keyRegion({ start: { measureIndex: 12, offset: 0 } })] });
    await userEvent.selectOptions(screen.getByLabelText('13小節目からの旋法'), 'minor');
    expect(props.onDecideKeyRegions).toHaveBeenCalledWith([{ measureIndex: 12, mode: 'minor' }]);
  });

  it('同じ区間を指定し直しても判断が重複しない', async () => {
    const props = setup({
      keyRegions: [keyRegion()],
      keyRegionDecisions: [{ measureIndex: 0, mode: 'minor' }],
    });
    await userEvent.selectOptions(screen.getByLabelText('1小節目からの旋法'), 'major');
    expect(props.onDecideKeyRegions).toHaveBeenCalledWith([{ measureIndex: 0, mode: 'major' }]);
  });

  it('自動判定と指定済みを区別して示す', () => {
    setup({
      keyRegions: [
        keyRegion({ id: 'a', source: 'auto' }),
        keyRegion({ id: 'b', source: 'user', start: { measureIndex: 4, offset: 0 } }),
      ],
    });
    expect(screen.getByText('自動判定')).toBeDefined();
    expect(screen.getByText('指定済み')).toBeDefined();
  });

  it('不一致が残る行を数えて示すが、承認は妨げない（部分失敗で作業を止めない）', async () => {
    const props = setup();
    expect(screen.getByRole('status').textContent).toContain('1 件');

    await userEvent.click(screen.getByRole('button', { name: '確認を完了する' }));
    expect(props.onApprove).toHaveBeenCalled();
  });

  it('不一致 0 件の行は確認対象に数えない（全行が警告になると導線が成立しない）', () => {
    setup({ items: [confirmationItem({ mismatchCount: 0 })] });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('訂正済みの行は確認対象から外れる', () => {
    setup({ items: [confirmationItem({ corrected: 'TREBLE' })] });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('処理中は操作を受け付けない（多重送信で解析が競合しないように）', () => {
    setup({ busy: true });
    expect(screen.getByRole('button', { name: '確認を完了する' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByLabelText('P6 の音部記号（検出: ALTO）').hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('パート不明の項目でも表示・操作できる', () => {
    setup({ items: [confirmationItem({ partId: null, detected: 'UNKNOWN' })] });
    expect(screen.getByText('（不明）')).toBeDefined();
    expect(screen.getByLabelText('不明なパート の音部記号（検出: UNKNOWN）')).toBeDefined();
  });
});
