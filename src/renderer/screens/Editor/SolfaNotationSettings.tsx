import type { ReactNode } from 'react';
import type { ProjectSettings } from '../../../shared/types/ProjectSettings';
import type { SettingOption } from '../../labels/scoreLabels';
import { MINOR_BASIS_OPTIONS, SYLLABLE_SYSTEM_OPTIONS } from '../../labels/scoreLabels';

/**
 * 階名の表記（音節体系・短調の基準）の切り替え（PRD F-3）
 *
 * 選んだ時点で `onChange` へ**設定全体**を渡す（`setSettings` の契約が `ProjectSettings` 全体のため、
 * 色・フォント等は現在値のまま引き継ぐ）。選択状態は `settings` から描く制御コンポーネントにし、
 * 未適用の選択を手元に持たない。IPC が失敗すれば App は古い設定のまま描き直すので、選択も元に戻る
 */

export interface SolfaNotationSettingsProps {
  settings: ProjectSettings;
  onChange: (settings: ProjectSettings) => void;
  disabled: boolean;
}

interface RadioGroupProps<T extends string> {
  legend: string;
  /** ラジオボタンの `name`（同じ画面の 2 つの組を区別する） */
  name: string;
  options: readonly SettingOption<T>[];
  value: T;
  onSelect: (value: T) => void;
  disabled: boolean;
  children?: ReactNode;
}

function RadioGroup<T extends string>({
  legend,
  name,
  options,
  value,
  onSelect,
  disabled,
  children,
}: RadioGroupProps<T>) {
  return (
    <fieldset disabled={disabled}>
      <legend>{legend}</legend>
      {options.map((option) => (
        <label key={option.value}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            // ラジオボタンは選択済みの項目を押し直しても change が発火しない。
            // 同じ値で解析をやり直す無駄な往復は起きない
            onChange={() => {
              onSelect(option.value);
            }}
          />
          {option.label}
        </label>
      ))}
      {children}
    </fieldset>
  );
}

export function SolfaNotationSettings({
  settings,
  onChange,
  disabled,
}: SolfaNotationSettingsProps) {
  return (
    <section>
      <h2>階名の表記</h2>
      <p>切り替えると、階名プレビューとこれから出力するPDFに反映されます。</p>
      <RadioGroup
        legend="書き方"
        name="syllableSystem"
        options={SYLLABLE_SYSTEM_OPTIONS}
        value={settings.syllableSystem}
        onSelect={(syllableSystem) => {
          onChange({ ...settings, syllableSystem });
        }}
        disabled={disabled}
      />
      <RadioGroup
        legend="短調の読み方"
        name="minorBasis"
        options={MINOR_BASIS_OPTIONS}
        value={settings.minorBasis}
        onSelect={(minorBasis) => {
          onChange({ ...settings, minorBasis });
        }}
        disabled={disabled}
      >
        {/*
          Audiveris は長短を出力せず、自動判定の調区間はすべて長調になる（機能設計書「実データの制約」）。
          長短を指定しないまま Do基準へ切り替えても階名は変わらないため、何をすれば効くかを案内する
        */}
        <p>
          Do基準は、確認画面で短調を選んだ区間に効きます。短調の曲は、確認画面の「調」の表で短調を選んでください。
        </p>
      </RadioGroup>
    </section>
  );
}
