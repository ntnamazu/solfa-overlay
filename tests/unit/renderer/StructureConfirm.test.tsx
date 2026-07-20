import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StructureConfirm } from '../../../src/renderer/screens/StructureConfirm/StructureConfirm';
import type { StructureIssue } from '../../../src/shared/types/Issues';

const measureCountIssue: StructureIssue = {
  kind: 'systemMeasureCountMismatch',
  movementIndex: 0,
  pageIndex: 4,
  systemIndex: 1,
  omrStackCount: 5,
  xmlMeasureCount: 4,
};

function setup(overrides: Partial<Parameters<typeof StructureConfirm>[0]> = {}) {
  const props = {
    issues: [measureCountIssue],
    decisions: [],
    onApply: vi.fn(),
    onNext: vi.fn(),
    busy: false,
    ...overrides,
  };
  render(<StructureConfirm {...props} />);
  return props;
}

describe('StructureConfirm', () => {
  it('問題がなければその旨を示し、先へ進める', async () => {
    const props = setup({ issues: [] });
    expect(screen.getByText('構造の問題は見つかりませんでした。')).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: '音部記号・調の確認へ' }));
    expect(props.onNext).toHaveBeenCalled();
  });

  it('段の小節数のズレは位置と両方の値を示す', () => {
    setup();
    expect(screen.getByText(/5ページ 2段目の小節数が食い違います/)).toBeDefined();
    expect(screen.getByText(/楽譜 5 \/ 出力 4/)).toBeDefined();
  });

  it('小節数を入力して離れると判断を通知する', async () => {
    const props = setup();
    const input = screen.getByLabelText('5ページ 2段目の小節数');

    await userEvent.clear(input);
    await userEvent.type(input, '5');
    await userEvent.tab();

    expect(props.onApply).toHaveBeenCalledWith([
      { kind: 'systemMeasureCount', pageIndex: 4, systemIndex: 1, measureCount: 5 },
    ]);
  });

  it('空欄のまま離れても判断を作らない（0 として適用すると段が丸ごと消える）', async () => {
    const props = setup();
    const input = screen.getByLabelText('5ページ 2段目の小節数');

    await userEvent.clear(input);
    await userEvent.tab();

    expect(props.onApply).not.toHaveBeenCalled();
  });

  it('同じ段を指定し直しても判断が重複しない', async () => {
    const props = setup({
      decisions: [{ kind: 'systemMeasureCount', pageIndex: 4, systemIndex: 1, measureCount: 5 }],
    });
    const input = screen.getByLabelText('5ページ 2段目の小節数');

    await userEvent.clear(input);
    await userEvent.type(input, '6');
    await userEvent.tab();

    expect(props.onApply).toHaveBeenCalledWith([
      { kind: 'systemMeasureCount', pageIndex: 4, systemIndex: 1, measureCount: 6 },
    ]);
  });

  it('他の段への判断は保持したまま追加する', async () => {
    const other = {
      kind: 'systemMeasureCount' as const,
      pageIndex: 9,
      systemIndex: 1,
      measureCount: 3,
    };
    const props = setup({ decisions: [other] });
    const input = screen.getByLabelText('5ページ 2段目の小節数');

    await userEvent.clear(input);
    await userEvent.type(input, '5');
    await userEvent.tab();

    expect(props.onApply).toHaveBeenCalledWith([
      other,
      { kind: 'systemMeasureCount', pageIndex: 4, systemIndex: 1, measureCount: 5 },
    ]);
  });

  it('既存の判断があればその値を初期表示する', () => {
    setup({
      decisions: [{ kind: 'systemMeasureCount', pageIndex: 4, systemIndex: 1, measureCount: 7 }],
    });
    expect((screen.getByLabelText('5ページ 2段目の小節数') as HTMLInputElement).value).toBe('7');
  });

  it('直せない問題には入力欄を出さない（直せないのに触らせない）', () => {
    setup({
      issues: [
        {
          kind: 'inconsistentSystemStaffCount',
          movementIndex: 0,
          pageIndex: 2,
          staffCounts: [8, 9],
        },
      ],
    });
    expect(screen.getByText(/3ページ目で段ごとの譜表数が不揃いです（8, 9）/)).toBeDefined();
    expect(screen.queryByRole('spinbutton')).toBeNull();
  });

  it.each([
    [
      { kind: 'movementCountMismatch', omrMovementCount: 2, musicXmlCount: 1 } as StructureIssue,
      /曲の分割数/,
    ],
    [
      {
        kind: 'pageCountMismatch',
        movementIndex: 0,
        omrPageCount: 20,
        xmlPageCount: 19,
      } as StructureIssue,
      /ページ数/,
    ],
    [
      {
        kind: 'systemCountMismatch',
        movementIndex: 0,
        pageIndex: 1,
        omrSystemCount: 4,
        xmlSystemCount: 3,
      } as StructureIssue,
      /段数/,
    ],
    [
      {
        kind: 'pageCorrespondenceMismatch',
        bookPageCount: 20,
        artifactPageCount: 18,
      } as StructureIssue,
      /ページの対応/,
    ],
  ])('どの問題種別でも日本語の説明を出す', (issue, pattern) => {
    setup({ issues: [issue] });
    expect(screen.getByText(pattern)).toBeDefined();
  });

  it('issue が 1 件解消しても、入力値が別の段へ引き継がれない', async () => {
    const second: StructureIssue = {
      kind: 'systemMeasureCountMismatch',
      movementIndex: 0,
      pageIndex: 9,
      systemIndex: 1,
      omrStackCount: 7,
      xmlMeasureCount: 6,
    };
    const props = {
      issues: [measureCountIssue, second],
      decisions: [],
      onApply: vi.fn(),
      onNext: vi.fn(),
      busy: false,
    };
    // アンマウントすると入力中の状態も消えて検証にならないため、同じインスタンスを再描画する
    const { rerender } = render(<StructureConfirm {...props} />);

    // 1 件目に入力する（まだ適用はしない）
    const first = screen.getByLabelText('5ページ 2段目の小節数');
    await userEvent.clear(first);
    await userEvent.type(first, '5');

    // 訂正が効いて 1 件目が解消し、2 件目だけが残った状態になる
    rerender(<StructureConfirm {...props} issues={[second]} />);

    // 添字をキーにしていると、2 件目の行に 1 件目へ入力した "5" が残る
    expect((screen.getByLabelText('10ページ 2段目の小節数') as HTMLInputElement).value).toBe('6');
  });

  it('処理中は操作を受け付けない', () => {
    setup({ busy: true });
    expect(screen.getByLabelText('5ページ 2段目の小節数').hasAttribute('disabled')).toBe(true);
    expect(
      screen.getByRole('button', { name: '音部記号・調の確認へ' }).hasAttribute('disabled'),
    ).toBe(true);
  });
});
