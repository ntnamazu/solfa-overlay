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
  it('見出しの直後に「今すべきこと」を 1 文置く', () => {
    setup();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.nextElementSibling?.textContent).toContain('楽譜と見比べて');
  });

  it('内部の語彙（譜表・システム）を画面に出さない', () => {
    setup({
      issues: [
        measureCountIssue,
        {
          kind: 'inconsistentSystemStaffCount',
          movementIndex: 0,
          pageIndex: 2,
          staffCounts: [1, 4],
        },
      ],
    });
    const text = screen.getByRole('main').textContent ?? '';
    expect(text).not.toContain('譜表');
    expect(text).not.toContain('システム');
  });

  it('問題がなければ「このまま進めます」と言い切り、先へ進める', async () => {
    const props = setup({ issues: [] });
    expect(screen.getByText(/このまま進めます/)).toBeDefined();
    expect(screen.getByText(/そのまま次へ進んでください/)).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: '音部記号と調の確認へ' }));
    expect(props.onNext).toHaveBeenCalled();
  });

  it('段の小節数のズレは位置と両方の値を示す', () => {
    setup();
    expect(screen.getByText(/5ページ 2段目の小節数が合いません/)).toBeDefined();
    expect(screen.getByText(/元の楽譜 5 小節 \/ 読み取り 4 小節/)).toBeDefined();
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

  it('直せない問題は折りたたんだメモに送り、入力欄を出さない（直せないのに触らせない）', () => {
    setup({
      issues: [
        {
          kind: 'inconsistentSystemStaffCount',
          movementIndex: 0,
          pageIndex: 2,
          staffCounts: [1, 1, 1, 1, 4, 4],
        },
      ],
    });

    expect(screen.getByText(/直す必要のあるところは見つかりませんでした/)).toBeDefined();
    expect(screen.queryByRole('spinbutton')).toBeNull();
    expect(screen.getByText(/読み取りで気になった点（1 件・入力欄では直せません）/)).toBeDefined();
  });

  it('直せる項目が無くても、報告だけの問題があれば「目を通して」と促す', () => {
    setup({
      issues: [{ kind: 'pageCorrespondenceMismatch', bookPageCount: 20, artifactPageCount: 18 }],
    });
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.nextElementSibling?.textContent).toContain('目を通してから次へ進んでください');
    expect(heading.nextElementSibling?.textContent).not.toContain('そのまま次へ進んでください');
  });

  it('段ごとのパート数の不揃いはインチピットに言及し、進んでよいことまで書く', () => {
    setup({
      issues: [
        {
          kind: 'inconsistentSystemStaffCount',
          movementIndex: 0,
          pageIndex: 2,
          staffCounts: [1, 1, 1, 1, 4, 4],
        },
      ],
    });
    const text = screen.getByRole('listitem').textContent ?? '';
    expect(text).toContain('3ページ目');
    expect(text).toContain('1 / 1 / 1 / 1 / 4 / 4 パート');
    expect(text).toContain('インチピット');
    expect(text).toContain('そのまま進めて問題ありません');
  });

  it('インチピットの形でないパート数のズレに「そのまま進めてよい」と書かない', () => {
    // (8, 9) は 1 パートずれ＝段の検出失敗。インチピットの説明を当てると害になる
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
    const text = screen.getByRole('listitem').textContent ?? '';
    expect(text).toContain('8 / 9 パート');
    expect(text).not.toContain('インチピット');
    expect(text).not.toContain('そのまま進めて問題ありません');
    expect(text).toContain('段の区切りを読み違えている可能性');
  });

  it('直せる項目と読み取りのメモを分けて示す', () => {
    setup({
      issues: [
        measureCountIssue,
        { kind: 'pageCorrespondenceMismatch', bookPageCount: 20, artifactPageCount: 18 },
      ],
    });

    expect(screen.getByRole('heading', { name: '直すところ（1 件）' })).toBeDefined();
    expect(screen.getAllByRole('row')).toHaveLength(2); // ヘッダ + 訂正できる 1 件のみ
    expect(screen.getByText(/ページの対応が取れません/)).toBeDefined();
  });

  it.each([
    [
      { kind: 'movementCountMismatch', omrMovementCount: 2, musicXmlCount: 1 } as StructureIssue,
      /曲の分かれ方/,
    ],
    [
      {
        kind: 'pageCountMismatch',
        movementIndex: 0,
        omrPageCount: 20,
        xmlPageCount: 19,
      } as StructureIssue,
      /ページ数が合いません/,
    ],
    [
      {
        kind: 'systemCountMismatch',
        movementIndex: 0,
        pageIndex: 1,
        omrSystemCount: 4,
        xmlSystemCount: 3,
      } as StructureIssue,
      /段数が合いません/,
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
      screen.getByRole('button', { name: '音部記号と調の確認へ' }).hasAttribute('disabled'),
    ).toBe(true);
  });
});
