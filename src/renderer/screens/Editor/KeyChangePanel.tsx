import type { FormEvent, KeyboardEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { KeyMode } from '../../labels/scoreLabels';
import { KEY_OPTIONS } from '../../labels/scoreLabels';

/**
 * 転調点を指定・修正するパネル（F-6）
 *
 * 階名の編集パネル（`AnnotationEditPanel`）と同じく**画面の下端に固定**する。楽譜プレビューは
 * 縦に長く、区画の頭に置くと押した小節から見えなくなるため。選んでいる調だけを手元に持ち、
 * 確定した指定は `on*` で Editor へ渡す（調文脈そのものは Main が持つ）。
 * 対象の小節が変わったら作り直す前提（Editor が `key` を付ける）で、初期値は最初の描画でだけ決める
 */

/** 転調点の指定の対象（押した小節・区切りの印） */
export interface KeyChangeTarget {
  /** 通し小節番号（0始まり） */
  measureIndex: number;
  /** その小節で今有効な調の選択肢の値（`KEY_OPTIONS` の `value`。表に無ければ null） */
  currentValue: string | null;
  /** その小節で始まる区切りの由来（区切りの無い小節なら null） */
  existing: 'auto' | 'user' | null;
  /**
   * 「自動判定に戻す」で戻る先の調の表示名（例: `G 長調`）
   *
   * 自動判定の区切りを上書き・削除した小節でだけ値を持つ（戻せないときは null）
   */
  revertLabel: string | null;
}

export interface KeyChangePanelProps {
  target: KeyChangeTarget;
  busy: boolean;
  /** この小節から選んだ調で読む（挿入・上書き） */
  onApply: (key: { fifths: number; mode: KeyMode }) => void;
  /** この小節の区切りを取り除く */
  onRemove: () => void;
  /** 指定を取り消して自動判定の区切りに戻す */
  onRevert: () => void;
  onClose: () => void;
}

const MODE_GROUPS: readonly { mode: KeyMode; label: string }[] = [
  { mode: 'major', label: '長調' },
  { mode: 'minor', label: '短調' },
];

/** 対象が何なのか（どの操作ができるか）を 1 文で示す */
function describeTarget(target: KeyChangeTarget): string {
  const measure = `${target.measureIndex + 1} 小節目`;
  if (target.measureIndex === 0) {
    return '曲の始まりの調です。調を選び直してください。';
  }
  if (target.existing === null) {
    return target.revertLabel === null
      ? `${measure}から転調します。この小節から読む調を選んでください。`
      : `${measure}の自動判定の区切り（${target.revertLabel}）は削除しています。調を選んで転調するか、自動判定に戻してください。`;
  }
  const origin = target.existing === 'user' ? '指定済み' : '自動判定';
  return `${measure}からの調です（${origin}）。調を選び直すか、転調点を削除してください。`;
}

export function KeyChangePanel({
  target,
  busy,
  onApply,
  onRemove,
  onRevert,
  onClose,
}: KeyChangePanelProps) {
  const initial = target.currentValue ?? '';
  const [value, setValue] = useState(initial);
  const select = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    // 小節や印を押したらすぐ選べるようにする
    select.current?.focus();
  }, []);

  const selected = KEY_OPTIONS.find((option) => option.value === value);
  // 今と同じ調では何も変わらない（区切りの無い小節なら転調点も増えない）
  const submittable = selected !== undefined && value !== initial;
  const isNew = target.existing === null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!submittable || busy) {
      return;
    }
    onApply({ fifths: selected.fifths, mode: selected.mode });
  };

  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        padding: '8px 16px',
        background: '#ffffff',
        borderTop: '1px solid #cccccc',
        boxShadow: '0 -2px 6px rgba(0, 0, 0, 0.15)',
        zIndex: 10,
      }}
    >
      <form aria-label="転調点の指定" onSubmit={submit} onKeyDown={closeOnEscape}>
        <p>{describeTarget(target)}</p>
        <label>
          調
          <select
            ref={select}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
            }}
            disabled={busy}
          >
            {/* 現在の調が表に無いとき（通常は起きない）だけ、未選択の行を置く */}
            {target.currentValue === null && <option value="">選んでください</option>}
            {MODE_GROUPS.map((group) => (
              <optgroup key={group.mode} label={group.label}>
                {KEY_OPTIONS.filter((option) => option.mode === group.mode).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <button type="submit" disabled={busy || !submittable}>
          {isNew ? 'ここから転調' : '調を変える'}
        </button>
        {target.revertLabel !== null && (
          <button type="button" onClick={onRevert} disabled={busy}>
            自動判定に戻す（{target.revertLabel}）
          </button>
        )}
        {!isNew && target.measureIndex > 0 && (
          <button type="button" onClick={onRemove} disabled={busy}>
            転調点を削除
          </button>
        )}
        <button type="button" onClick={onClose}>
          閉じる
        </button>
        {/* mergeAdjacent で前の区間に統合されるため、選んでも区切りが残らないことを先に伝える */}
        <p>前の区間と同じ調を選ぶと、この転調点はなくなります。</p>
      </form>
    </div>
  );
}
