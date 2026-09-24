import type { FormEvent, KeyboardEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { MANUAL_TEXT_MAX_LENGTH } from '../../../shared/constants/MANUAL_TEXT_MAX_LENGTH';
import type { ScorePreviewAnnotation } from '../../../shared/types/ScorePreview';

/**
 * 楽譜の上で選んだ階名・位置を編集するパネル（F-5）
 *
 * 楽譜プレビューは縦に長く、区画の頭に置くと押した位置から見えなくなるため、**画面の下端に固定**する。
 * 入力中の文字だけを手元に持ち、確定した編集は `on*` で Editor へ渡す（注釈そのものは Main が持つ）。
 * 対象が変わったら作り直す前提（Editor が `key` を付ける）で、入力欄の初期値は最初の描画でだけ決める
 */

/** 編集の対象（楽譜の上で押したもの） */
export type AnnotationEditTarget =
  { kind: 'annotation'; annotation: ScorePreviewAnnotation } | { kind: 'point' };

export interface AnnotationEditPanelProps {
  /** 編集の対象（何も選んでいなければ null） */
  target: AnnotationEditTarget | null;
  /** 直前に削除した階名の文字（「元に戻す」を出す。無ければ null） */
  removedText: string | null;
  busy: boolean;
  /** 押した位置に書き足す */
  onAdd: (text: string) => void;
  /** 選んだ階名の文字を書き換える */
  onSetText: (text: string) => void;
  /** 書き換えた自動の階名を元に戻す */
  onRevert: () => void;
  onRemove: () => void;
  /** 直前の削除を取り消す */
  onUndoRemove: () => void;
  onClose: () => void;
}

/** 選んだ階名が何なのか（どの操作ができるか）を 1 文で示す */
function describeAnnotation(annotation: ScorePreviewAnnotation): string {
  if (annotation.origin === 'manual') {
    return '書き足した階名です。書き換えるか削除してください。';
  }
  return annotation.textOverridden
    ? '自動で付いた階名を書き換えています。書き換えるか、自動の階名に戻してください。'
    : '自動で付いた階名です。書き換えるか削除してください。';
}

export function AnnotationEditPanel({
  target,
  removedText,
  busy,
  onAdd,
  onSetText,
  onRevert,
  onRemove,
  onUndoRemove,
  onClose,
}: AnnotationEditPanelProps) {
  const initial = target?.kind === 'annotation' ? target.annotation.text : '';
  const [text, setText] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // 楽譜を押したらすぐ打ち込めるようにする
    input.current?.focus();
  }, []);

  if (target === null && removedText === null) {
    return null;
  }

  const trimmed = text.trim();
  // 空の文字は確定できない。書き換えで同じ文字なら何も変わらない
  const submittable = trimmed.length > 0 && !(target?.kind === 'annotation' && trimmed === initial);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!submittable || busy || target === null) {
      return;
    }
    if (target.kind === 'point') {
      onAdd(trimmed);
    } else {
      onSetText(trimmed);
    }
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
      {target !== null ? (
        <form aria-label="階名の編集" onSubmit={submit} onKeyDown={closeOnEscape}>
          <p>
            {target.kind === 'point'
              ? '押した位置に書き足す階名を入力してください。'
              : describeAnnotation(target.annotation)}
          </p>
          <label>
            階名
            <input
              ref={input}
              type="text"
              value={text}
              maxLength={MANUAL_TEXT_MAX_LENGTH}
              placeholder="例: do, fi, ta"
              onChange={(event) => {
                setText(event.target.value);
              }}
              disabled={busy}
            />
          </label>
          <button type="submit" disabled={busy || !submittable}>
            {target.kind === 'point' ? '書き足す' : '書き換える'}
          </button>
          {target.kind === 'annotation' && target.annotation.textOverridden && (
            <button type="button" onClick={onRevert} disabled={busy}>
              自動の階名に戻す
            </button>
          )}
          {target.kind === 'annotation' && (
            <button type="button" onClick={onRemove} disabled={busy}>
              削除
            </button>
          )}
          <button type="button" onClick={onClose}>
            閉じる
          </button>
          {/* 標準フォントで描けない文字は出力PDFで「?」に置き換わる（fontMetrics.displayText） */}
          <p>半角の英字で入力してください。全角の文字は出力PDFで「?」になります。</p>
        </form>
      ) : (
        <p role="status">
          階名「{removedText}」を削除しました。
          <button type="button" onClick={onUndoRemove} disabled={busy}>
            元に戻す
          </button>
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </p>
      )}
    </div>
  );
}
