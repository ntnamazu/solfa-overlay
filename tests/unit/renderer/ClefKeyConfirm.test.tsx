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
  it('音部記号と調を別々の表で示す（パートの性質と小節区間の性質を混ぜない）', () => {
    setup();
    expect(screen.getByRole('heading', { name: '音部記号' })).toBeDefined();
    expect(screen.getByRole('heading', { name: '調' })).toBeDefined();
  });

  it('見出しの直後に「今すべきこと」を 1 文置く', () => {
    setup();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.nextElementSibling?.textContent).toContain('選び直してください');
  });

  it('内部識別子を画面に出さない（説明書なしで読めることが要件）', () => {
    setup({
      items: [
        confirmationItem({ partId: 'P6', detected: 'ALTO' }),
        confirmationItem({ id: 'clef-P7-TREBLE_DOWN_8', partId: 'P7', detected: 'TREBLE_DOWN_8' }),
        confirmationItem({ id: 'clef-P8-UNKNOWN', partId: 'P8', detected: 'UNKNOWN' }),
      ],
    });
    const text = screen.getByRole('main').textContent ?? '';
    for (const internal of ['P6', 'P7', 'P8', 'ALTO', 'TREBLE_DOWN_8', 'UNKNOWN']) {
      expect(text).not.toContain(internal);
    }
  });

  it('パートを「上から N 番目」で示し、音部記号を日本語で示す', () => {
    setup();
    expect(screen.getByText('上から6番目のパート')).toBeDefined();
    expect(screen.getByRole('cell', { name: 'アルト記号（ハ音記号・第3線）' })).toBeDefined();
  });

  it('訂正の選択肢も日本語で示す', () => {
    setup();
    const options = screen
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).textContent);
    expect(options).toContain('ト音記号');
    expect(options).toContain('オクターヴ下ト音記号（テノールで頻出）');
  });

  it('1 行が及ぶ範囲を曲全体の段数とともに示す（多いのか少ないのか判断できるように）', () => {
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

    expect(screen.getByText('全 35 段のうち 35 段')).toBeDefined();
    expect(screen.getByText('402 音')).toBeDefined();
  });

  it('食い違い 0 件は数字を出さない（目が要確認の行へ向くように）', () => {
    setup({ items: [confirmationItem({ mismatchCount: 0 })] });
    expect(screen.getByText('—')).toBeDefined();
  });

  it('音部記号を訂正すると項目 id と訂正値を通知する', async () => {
    const props = setup();
    await userEvent.selectOptions(
      screen.getByLabelText(
        '上から6番目のパートの音部記号（読み取り: アルト記号（ハ音記号・第3線））',
      ),
      'TREBLE',
    );
    expect(props.onCorrectClef).toHaveBeenCalledWith({ 'clef-P6-ALTO': 'TREBLE' });
  });

  it('「読み取ったままにする」を選ぶと訂正を取り消す（null を送る）', async () => {
    const props = setup({ items: [confirmationItem({ corrected: 'TREBLE' })] });
    await userEvent.selectOptions(
      screen.getByLabelText(
        '上から6番目のパートの音部記号（読み取り: アルト記号（ハ音記号・第3線））',
      ),
      '',
    );
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

  it('確認が必要な行はどこを見ればよいかまで言い切る', () => {
    setup();
    expect(screen.getByRole('status').textContent).toContain('⚠ が付いた 1 行だけ');
  });

  it('確認が必要な行がなければ、そのまま進めてよいと言い切る', () => {
    setup({ items: [confirmationItem({ mismatchCount: 0 })] });
    expect(screen.getByRole('status').textContent).toContain('このまま進めて大丈夫です');
  });

  it('サマリはライブリージョンとして常に置く（訂正で消すと成功が読み上げられない）', () => {
    const { rerender } = render(
      <ClefKeyConfirm
        items={[confirmationItem()]}
        keyRegions={[]}
        keyRegionDecisions={[]}
        onCorrectClef={vi.fn()}
        onDecideKeyRegions={vi.fn()}
        onApprove={vi.fn()}
        busy={false}
      />,
    );
    const before = screen.getByRole('status');

    rerender(
      <ClefKeyConfirm
        items={[confirmationItem({ corrected: 'TREBLE' })]}
        keyRegions={[]}
        keyRegionDecisions={[]}
        onCorrectClef={vi.fn()}
        onDecideKeyRegions={vi.fn()}
        onApprove={vi.fn()}
        busy={false}
      />,
    );

    // 同じ要素が残ったまま文言だけが差し替わる（要素ごと消えると読み上げが起きない）
    expect(screen.getByRole('status')).toBe(before);
    expect(before.textContent).toContain('このまま進めて大丈夫です');
  });

  it('確認項目が 1 件もなければ、正しさを保証せず読み取り失敗の可能性を伝える', () => {
    setup({ items: [] });
    expect(screen.getByRole('status').textContent).toContain('読み取りに失敗している可能性');
  });

  it('確認が残っていても承認は妨げない（部分失敗で作業を止めない）', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: '確認を完了する' }));
    expect(props.onApprove).toHaveBeenCalled();
  });

  it('訂正済みの行は確認対象から外れる', () => {
    setup({ items: [confirmationItem({ corrected: 'TREBLE' })] });
    expect(screen.getByRole('status').textContent).not.toContain('⚠ が付いた');
    expect(screen.getByRole('cell', { name: '訂正済み' })).toBeDefined();
  });

  it('未対応の音部記号も未検査として数える（検算が走らないのは UNKNOWN だけではない）', () => {
    setup({ items: [confirmationItem({ detected: 'PERCUSSION', mismatchCount: 0 })] });
    expect(screen.getByRole('cell', { name: '⚠ 未検査' })).toBeDefined();
    expect(screen.getByRole('status').textContent).toContain('1 行だけ');
  });

  it('1 段に複数の譜表を持つパートでも段数が分母を超えない（大譜表）', () => {
    setup({
      items: [
        confirmationItem({
          staffRefs: [
            { pageIndex: 0, systemIndex: 0, staffIndex: 0, partId: 'P6' },
            { pageIndex: 0, systemIndex: 0, staffIndex: 1, partId: 'P6' },
          ],
        }),
      ],
    });
    expect(screen.getByText('全 1 段のうち 1 段')).toBeDefined();
  });

  it('読み取れなかった行は「未検査」として確認対象に数える（0 件は問題なしではない）', () => {
    setup({ items: [confirmationItem({ detected: 'UNKNOWN', mismatchCount: 0 })] });

    expect(screen.getByRole('cell', { name: '⚠ 未検査' })).toBeDefined();
    expect(screen.getByRole('status').textContent).toContain('1 行だけ');
    // 訂正に効果があること（照合できるようになること）を書かないと動機が伝わらない
    expect(screen.getByText(/照合できるようになります/)).toBeDefined();
  });

  it('不一致のある行には要確認のバッジを付ける', () => {
    setup();
    expect(screen.getByRole('cell', { name: '⚠ 要確認' })).toBeDefined();
  });

  it('処理中は操作を受け付けない（多重送信で解析が競合しないように）', () => {
    setup({ busy: true });
    expect(screen.getByRole('button', { name: '確認を完了する' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(
      screen
        .getByLabelText('上から6番目のパートの音部記号（読み取り: アルト記号（ハ音記号・第3線））')
        .hasAttribute('disabled'),
    ).toBe(true);
  });

  it('パート不明の項目でも表示・操作できる', () => {
    setup({ items: [confirmationItem({ partId: null, detected: 'UNKNOWN' })] });
    expect(screen.getByText('パート不明')).toBeDefined();
    expect(
      screen.getByLabelText('パート不明の音部記号（読み取り: 読み取れませんでした）'),
    ).toBeDefined();
  });
});
