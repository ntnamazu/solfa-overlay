import type { Annotation } from '../../shared/types/Annotation';
import type { SyllableSystem } from '../../shared/types/ProjectSettings';
import type { NoteEvent, ScoreModel } from '../../shared/types/ScoreModel';
import { syllableFor } from '../solfa/syllableTables';

/**
 * 注釈を「何色の何という文字で描くか」の規則
 *
 * 出力PDF（`OverlayRenderer`）と Editor の楽譜プレビュー（`scorePreview`）が**同じ関数**で決める。
 * 別々に書くと「画面と出力で文字や色が違う」が起き、プレビューの意味がなくなる
 */

/** 音符 id → 音符（注釈の描画文字列と変化の有無を引くため） */
export function notesById(score: ScoreModel | null): Map<string, NoteEvent> {
  const table = new Map<string, NoteEvent>();
  for (const measure of score?.measures ?? []) {
    for (const note of measure.notes) {
      table.set(note.id, note);
    }
  }
  return table;
}

/** 注釈 1 つの描画内容 */
export interface AnnotationContent {
  /** 描く文字列（描けない文字の置換前） */
  text: string;
  /** 半音変化した階名か（色と太字で区別する） */
  chromatic: boolean;
}

/**
 * 注釈 1 つの描画内容を決める
 *
 * @returns 描く文字が決まらない（対応する音符が消えた孤立注釈など）なら null
 */
export function annotationContent(
  annotation: Annotation,
  notes: ReadonlyMap<string, NoteEvent>,
  syllableSystem: SyllableSystem,
): AnnotationContent | null {
  const note = annotation.noteId === null ? undefined : notes.get(annotation.noteId);
  // 手動で書き換えた文字が最優先。次に音符の階名。どちらも無ければ描けない
  const text =
    annotation.text ?? (note?.solfa == null ? null : syllableFor(note.solfa, syllableSystem));
  if (text === null) {
    return null;
  }
  return { text, chromatic: (note?.solfa?.alteration ?? 0) !== 0 };
}

/** 描く対象の注釈か（非表示にされた注釈と、v2 の別レイヤーは描かない） */
export function isDrawnAnnotation(annotation: Annotation): boolean {
  return !annotation.deleted && annotation.layer === 'solfa';
}

/**
 * `#rgb` / `#rrggbb` を小文字の `#rrggbb` に正規化する
 *
 * @returns 解釈できなければ null（呼び出し側が既定色へ落とす）
 */
export function normalizeHexColor(value: string): string | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (match === null) {
    return null;
  }
  const hex = (match[1] as string).toLowerCase();
  return `#${hex.length === 3 ? [...hex].map((character) => character + character).join('') : hex}`;
}
