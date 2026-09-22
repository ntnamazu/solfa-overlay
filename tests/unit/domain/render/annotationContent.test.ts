import { describe, expect, it } from 'vitest';
import {
  annotationContent,
  isDrawnAnnotation,
  normalizeHexColor,
  notesById,
} from '../../../../src/domain/render/annotationContent';
import type { Annotation } from '../../../../src/shared/types/Annotation';
import type { NoteEvent, ScoreModel } from '../../../../src/shared/types/ScoreModel';
import type { SolfaDegree } from '../../../../src/shared/types/SolfaDegree';

const note = (id: string, solfa: SolfaDegree | null): NoteEvent => ({
  id,
  partId: 'P1',
  measureIndex: 0,
  pitch: { step: 'C', alter: 0, octave: 4 },
  head: { pageIndex: 0, x: 100, y: 100 },
  solfa,
});

const annotation = (overrides: Partial<Annotation> = {}): Annotation => ({
  id: 'solfa-n1',
  layer: 'solfa',
  anchor: { pageIndex: 0, x: 0, y: 0 },
  noteId: 'n1',
  text: null,
  origin: 'auto',
  deleted: false,
  ...overrides,
});

const score: ScoreModel = {
  parts: [],
  systems: [],
  measures: [
    {
      partId: 'P1',
      index: 0,
      status: 'matched',
      notes: [note('n1', { degree: 1, alteration: 0 })],
    },
    {
      partId: 'P1',
      index: 1,
      status: 'matched',
      notes: [note('n2', { degree: 4, alteration: 1 })],
    },
    { partId: 'P1', index: 2, status: 'matched', notes: [note('n3', null)] },
  ],
};

describe('notesById', () => {
  it('全小節の音符を id で引けるようにする', () => {
    expect([...notesById(score).keys()]).toEqual(['n1', 'n2', 'n3']);
  });

  it('楽譜が無ければ空', () => {
    expect(notesById(null).size).toBe(0);
  });
});

describe('annotationContent', () => {
  const notes = notesById(score);

  it('音符の階名を音節体系で文字列化する', () => {
    expect(annotationContent(annotation(), notes, 'kodaly')).toEqual({
      text: 'do',
      chromatic: false,
    });
    expect(annotationContent(annotation(), notes, 'tonicSolfa')?.text).toBe('d');
  });

  it('変位のある階名は変化音として扱う', () => {
    expect(annotationContent(annotation({ noteId: 'n2' }), notes, 'kodaly')).toEqual({
      text: 'fi',
      chromatic: true,
    });
  });

  it('手動で書き換えた文字を音符の階名より優先する', () => {
    expect(annotationContent(annotation({ text: 'DO!' }), notes, 'kodaly')?.text).toBe('DO!');
  });

  it('手動追加の注釈（音符なし）は書かれた文字をそのまま使い、変化音にしない', () => {
    expect(annotationContent(annotation({ noteId: null, text: 'x' }), notes, 'kodaly')).toEqual({
      text: 'x',
      chromatic: false,
    });
  });

  it('音符が消えた・階名が無い注釈は描く文字が決まらず null', () => {
    expect(annotationContent(annotation({ noteId: 'gone' }), notes, 'kodaly')).toBeNull();
    expect(annotationContent(annotation({ noteId: 'n3' }), notes, 'kodaly')).toBeNull();
  });
});

describe('isDrawnAnnotation', () => {
  it('削除フラグの立った注釈と v2 の別レイヤーは描かない', () => {
    expect(isDrawnAnnotation(annotation())).toBe(true);
    expect(isDrawnAnnotation(annotation({ deleted: true }))).toBe(false);
    expect(isDrawnAnnotation(annotation({ layer: 'chordRole' }))).toBe(false);
  });
});

describe('normalizeHexColor', () => {
  it('小文字の #rrggbb にそろえる（3 桁は展開する）', () => {
    expect(normalizeHexColor(' #8B0000 ')).toBe('#8b0000');
    expect(normalizeHexColor('#f0a')).toBe('#ff00aa');
  });

  it('解釈できない値は null', () => {
    expect(normalizeHexColor('red')).toBeNull();
    expect(normalizeHexColor('#12345')).toBeNull();
  });
});
