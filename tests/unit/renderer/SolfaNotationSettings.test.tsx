import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SolfaNotationSettings } from '../../../src/renderer/screens/Editor/SolfaNotationSettings';
import type {
  MinorBasis,
  ProjectSettings,
  SyllableSystem,
} from '../../../src/shared/types/ProjectSettings';
import { project } from './fixtures';

const KODALY = 'コダーイ式（do re mi fa so la ti）';
const TONIC_SOLFA = 'Tonic sol-fa 略記（d r m f s l t）';
const LA_BASIS = 'La基準（短調の主音を la と読む）';
const DO_BASIS = 'Do基準（短調の主音を do と読む）';

/** 既定の props（各テストで必要な部分だけ上書きする） */
function setup(overrides: Partial<Parameters<typeof SolfaNotationSettings>[0]> = {}) {
  const props = {
    settings: project().settings,
    onChange: vi.fn<(settings: ProjectSettings) => void>(),
    disabled: false,
    ...overrides,
  };
  const { container } = render(<SolfaNotationSettings {...props} />);
  return { props, container };
}

const radio = (name: string) => screen.getByRole<HTMLInputElement>('radio', { name });

describe('SolfaNotationSettings', () => {
  it.each<[SyllableSystem, MinorBasis, string, string]>([
    ['kodaly', 'la', KODALY, LA_BASIS],
    ['kodaly', 'do', KODALY, DO_BASIS],
    ['tonicSolfa', 'la', TONIC_SOLFA, LA_BASIS],
    ['tonicSolfa', 'do', TONIC_SOLFA, DO_BASIS],
  ])(
    '%s × %s の設定では、その 2 つが選ばれた状態で表示する',
    (syllableSystem, minorBasis, checkedSystem, checkedBasis) => {
      setup({ settings: { ...project().settings, syllableSystem, minorBasis } });

      const checked = screen
        .getAllByRole<HTMLInputElement>('radio')
        .filter((input) => input.checked)
        .map((input) => input.labels?.[0]?.textContent);
      expect(checked).toEqual([checkedSystem, checkedBasis]);
    },
  );

  it.each<[string, Partial<ProjectSettings>]>([
    [TONIC_SOLFA, { syllableSystem: 'tonicSolfa' }],
    [DO_BASIS, { minorBasis: 'do' }],
  ])('「%s」を選ぶと、その項目だけを変えた設定全体を渡す', async (label, changed) => {
    const { props } = setup();

    await userEvent.click(radio(label));

    // 色・フォント等は現在値のまま（setSettings は設定全体を差し替える契約のため）
    expect(props.onChange).toHaveBeenCalledExactlyOnceWith({ ...props.settings, ...changed });
  });

  it('選択済みの項目を押し直しても渡さない（同じ値で解析をやり直さない）', async () => {
    const { props } = setup();

    await userEvent.click(radio(KODALY));
    await userEvent.click(radio(LA_BASIS));

    expect(props.onChange).not.toHaveBeenCalled();
  });

  it('処理中は選べない', async () => {
    const { props } = setup({ disabled: true });

    // fieldset の disabled は子の input の `disabled` 属性を変えないため、実効状態で見る
    for (const input of screen.getAllByRole<HTMLInputElement>('radio')) {
      expect(input.matches(':disabled')).toBe(true);
    }
    await userEvent.click(radio(TONIC_SOLFA));
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it('2 つの組をそれぞれ名前付きのグループにする', () => {
    setup();
    expect(screen.getByRole('group', { name: '書き方' })).toBeDefined();
    expect(screen.getByRole('group', { name: '短調の読み方' })).toBeDefined();
  });

  it('Do基準が効く条件と、そのためにすることを案内する', () => {
    setup();
    const group = screen.getByRole('group', { name: '短調の読み方' });
    expect(group.textContent).toContain('確認画面の「調」の表で短調を選んでください');
  });

  it('内部識別子を画面に出さない', () => {
    const { container } = setup();
    expect(container.textContent).not.toMatch(/kodaly|tonicSolfa|minorBasis|syllableSystem/);
  });
});
