import { useState } from 'react';
import type { AnnotationEdit } from '../../shared/ipc/contract';
import type { ScorePreviewAnnotation } from '../../shared/types/ScorePreview';

/**
 * 楽譜の上で階名を足す・直すための小さな入力欄（F-5）
 *
 * 楽譜のページに重ねて出す。何をどこに描くかは Main が決めるため、ここは
 * 「どの注釈に何をするか」を `AnnotationEdit` にして渡すだけにする
 */

/** 編集中の対象（楽譜のどこを押したか） */
export type AnnotationDraft =
  /** 何も無い位置を押した（そこへ足す）。位置は pt・左上原点 */
  | { kind: 'add'; sourcePageIndex: number; x: number; y: number }
  /** 既存の注釈を押した */
  | { kind: 'edit'; sourcePageIndex: number; annotation: ScorePreviewAnnotation };

export interface AnnotationEditFormProps {
  draft: AnnotationDraft;
  onSubmit: (edit: AnnotationEdit) => void;
  onCancel: () => void;
}

export function AnnotationEditForm({ draft, onSubmit, onCancel }: AnnotationEditFormProps) {
  const [text, setText] = useState(draft.kind === 'edit' ? draft.annotation.text : '');
  const trimmed = text.trim();
  const adding = draft.kind === 'add';

  const submit = () => {
    if (trimmed === '') {
      return;
    }
    if (draft.kind === 'add') {
      onSubmit({
        kind: 'add',
        sourcePageIndex: draft.sourcePageIndex,
        x: draft.x,
        y: draft.y,
        text,
      });
      return;
    }
    // 変えていなければ送らない。表示中の文字は描けない文字を置き換えた後のものがあり、
    // そのまま送ると自動の階名が「手で書き換えたもの」になってしまう
    if (trimmed === draft.annotation.text) {
      onCancel();
      return;
    }
    onSubmit({ kind: 'setText', id: draft.annotation.id, text });
  };

  return (
    <form
      aria-label={adding ? '階名の追加' : '階名の修正'}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '4px',
        padding: '6px 8px',
        background: '#ffffff',
        border: '1px solid #888888',
        borderRadius: '4px',
        boxShadow: '0 2px 6px rgba(0, 0, 0, 0.25)',
        fontSize: '14px',
        whiteSpace: 'nowrap',
      }}
    >
      <label>
        階名{' '}
        <input
          type="text"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
          // 押した直後にそのまま入力できるようにする（楽譜を押す → 打つ、の 2 手で済ませる）
          autoFocus
          size={6}
        />
      </label>
      <button type="submit" disabled={trimmed === ''}>
        {adding ? '追加' : '変更'}
      </button>
      {draft.kind === 'edit' && (
        <button
          type="button"
          onClick={() => {
            onSubmit({ kind: 'remove', id: draft.annotation.id });
          }}
        >
          削除
        </button>
      )}
      {draft.kind === 'edit' && draft.annotation.overridden && (
        <button
          type="button"
          onClick={() => {
            onSubmit({ kind: 'setText', id: draft.annotation.id, text: null });
          }}
        >
          元の階名に戻す
        </button>
      )}
      <button type="button" onClick={onCancel}>
        やめる
      </button>
      {adding && <small style={{ flexBasis: '100%' }}>押した位置が文字の左下になります</small>}
    </form>
  );
}
