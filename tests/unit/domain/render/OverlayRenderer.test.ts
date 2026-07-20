import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  OverlayRenderer,
  parseHexColor,
  renderOverlay,
} from '../../../../src/domain/render/OverlayRenderer';
import { DEFAULT_SETTINGS } from '../../../../src/shared/constants/DEFAULT_SETTINGS';
import type { Annotation } from '../../../../src/shared/types/Annotation';
import type { PageInfo, Project } from '../../../../src/shared/types/Project';
import type { NoteEvent } from '../../../../src/shared/types/ScoreModel';
import type { SolfaDegree } from '../../../../src/shared/types/SolfaDegree';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;

async function makePdf(pageCount = 1): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let i = 0; i < pageCount; i += 1) {
    document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  }
  return document.save();
}

const pageInfo = (pageIndex: number, sourcePageIndex: number): PageInfo => ({
  pageIndex,
  sourcePageIndex,
  widthPt: PAGE_WIDTH,
  heightPt: PAGE_HEIGHT,
  omrImageWidthPx: 2480,
  omrImageHeightPx: 3507,
  interlinePx: 17,
});

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
  anchor: { pageIndex: 0, x: 1240, y: 1753 },
  noteId: 'n1',
  text: null,
  origin: 'auto',
  deleted: false,
  ...overrides,
});

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    schemaVersion: 1,
    id: 'p1',
    sourcePdf: 'source.pdf',
    pages: [pageInfo(0, 0)],
    score: {
      parts: [{ id: 'P1', name: 'Soprano', staves: [] }],
      systems: [],
      measures: [
        {
          partId: 'P1',
          index: 0,
          status: 'matched',
          notes: [note('n1', { degree: 1, alteration: 0 })],
        },
      ],
    },
    confirmation: { items: [], completedAt: '2026-07-20T00:00:00Z' },
    structureDecisions: [],
    keyRegionDecisions: [],
    keyRegions: [],
    annotations: [annotation()],
    settings: { ...DEFAULT_SETTINGS },
    createdAt: '2026-07-20T00:00:00Z',
    updatedAt: '2026-07-20T00:00:00Z',
    ...overrides,
  };
}

/** 出力PDFのページ数と寸法を読み直す */
async function readPages(bytes: Uint8Array): Promise<{ width: number; height: number }[]> {
  const document = await PDFDocument.load(bytes);
  return document.getPages().map((page) => ({ width: page.getWidth(), height: page.getHeight() }));
}

describe('parseHexColor', () => {
  it('#rrggbb を解釈する', () => {
    const color = parseHexColor('#8b0000');
    expect(color?.red).toBeCloseTo(139 / 255, 6);
    expect(color?.green).toBe(0);
    expect(color?.blue).toBe(0);
  });

  it('#rgb の短縮形も解釈する', () => {
    expect(parseHexColor('#f00')).toEqual(parseHexColor('#ff0000'));
  });

  it('前後の空白と大文字を許す', () => {
    expect(parseHexColor(' #8B0000 ')).toEqual(parseHexColor('#8b0000'));
  });

  it('解釈できない値は null', () => {
    expect(parseHexColor('red')).toBeNull();
    expect(parseHexColor('#12345')).toBeNull();
    expect(parseHexColor('')).toBeNull();
  });
});

describe('renderOverlay', () => {
  it('元PDFのページ数と寸法を変えない（版面を保つ）', async () => {
    const sourcePdf = await makePdf(3);
    const before = await readPages(sourcePdf);
    const result = await renderOverlay({ sourcePdf, project: makeProject() });

    expect(await readPages(result.bytes)).toEqual(before);
  });

  it('階名を持つ注釈を描く', async () => {
    const result = await renderOverlay({ sourcePdf: await makePdf(), project: makeProject() });

    expect(result.drawnCount).toBe(1);
    expect(result.issues).toEqual([]);
  });

  it('deleted の注釈は描かない', async () => {
    const project = makeProject({ annotations: [annotation({ deleted: true })] });
    const result = await renderOverlay({ sourcePdf: await makePdf(), project });

    expect(result.drawnCount).toBe(0);
  });

  it('solfa 以外のレイヤー（v2 の和音役割）は描かない', async () => {
    const project = makeProject({
      annotations: [annotation({ layer: 'chordRole', text: 'I' })],
    });
    const result = await renderOverlay({ sourcePdf: await makePdf(), project });

    expect(result.drawnCount).toBe(0);
  });

  it('手動で書き換えた文字を優先して描く', async () => {
    const project = makeProject({ annotations: [annotation({ text: 'メモ' })] });
    const result = await renderOverlay({ sourcePdf: await makePdf(), project });

    // 'メモ' は WinAnsi で描けないため 1 文字ずつ置換される。例外にはならない
    expect(result.drawnCount).toBe(1);
    expect(result.issues).toEqual([
      { kind: 'characterSubstituted', from: 'メ', to: '?', count: 1 },
      { kind: 'characterSubstituted', from: 'モ', to: '?', count: 1 },
    ]);
  });

  it('♭ を含む階名でも例外にならず、置換を報告する（要求 発見4 の回帰）', async () => {
    // divisi 実データに出る do♭（度数1・変位 -1 は表に無いためフォールバック表示になる）
    const project = makeProject({
      score: {
        parts: [{ id: 'P1', name: 'S', staves: [] }],
        systems: [],
        measures: [
          {
            partId: 'P1',
            index: 0,
            status: 'matched',
            notes: [note('n1', { degree: 1, alteration: -1 })],
          },
        ],
      },
    });
    const result = await renderOverlay({ sourcePdf: await makePdf(), project });

    expect(result.drawnCount).toBe(1);
    expect(result.issues).toContainEqual({
      kind: 'characterSubstituted',
      from: '♭',
      to: 'b',
      count: 1,
    });
  });

  it('同じ置換が複数回起きたらまとめて数える', async () => {
    const flat: SolfaDegree = { degree: 1, alteration: -1 };
    const project = makeProject({
      score: {
        parts: [{ id: 'P1', name: 'S', staves: [] }],
        systems: [],
        measures: [
          {
            partId: 'P1',
            index: 0,
            status: 'matched',
            notes: [note('n1', flat), { ...note('n2', flat) }],
          },
        ],
      },
      annotations: [annotation(), annotation({ id: 'solfa-n2', noteId: 'n2' })],
    });
    const result = await renderOverlay({ sourcePdf: await makePdf(), project });

    expect(result.issues).toContainEqual({
      kind: 'characterSubstituted',
      from: '♭',
      to: 'b',
      count: 2,
    });
  });

  it('ページ寸法が無い注釈は描かずにまとめて報告する', async () => {
    const project = makeProject({ pages: [] });
    const result = await renderOverlay({ sourcePdf: await makePdf(), project });

    expect(result.drawnCount).toBe(0);
    expect(result.issues).toContainEqual({ kind: 'pageInfoMissing', pageIndex: 0, count: 1 });
  });

  it('元PDFに参照先ページが無ければ描かずに報告する', async () => {
    // sourcePageIndex=5 だが PDF は 1 ページしかない
    const project = makeProject({ pages: [pageInfo(0, 5)] });
    const result = await renderOverlay({ sourcePdf: await makePdf(1), project });

    expect(result.drawnCount).toBe(0);
    expect(result.issues).toContainEqual({ kind: 'pageInfoMissing', pageIndex: 0, count: 1 });
  });

  it('対応する音符が消えた孤立注釈は missingText として報告する', async () => {
    const project = makeProject({ annotations: [annotation({ noteId: 'zzz' })] });
    const result = await renderOverlay({ sourcePdf: await makePdf(), project });

    expect(result.drawnCount).toBe(0);
    expect(result.issues).toContainEqual({ kind: 'missingText', annotationId: 'solfa-n1' });
  });

  it('解釈できない色指定でも落ちず、既定色へ落として報告する', async () => {
    const project = makeProject({
      settings: { ...DEFAULT_SETTINGS, diatonicColor: 'darkred' },
    });
    const result = await renderOverlay({ sourcePdf: await makePdf(), project });

    expect(result.drawnCount).toBe(1);
    expect(result.issues).toContainEqual({ kind: 'invalidColor', value: 'darkred' });
  });

  it('幹音と変化音で描画結果が変わる（色と書体を変えているため）', async () => {
    const sourcePdf = await makePdf();
    const natural = await renderOverlay({ sourcePdf, project: makeProject() });
    const chromatic = await renderOverlay({
      sourcePdf,
      project: makeProject({
        score: {
          parts: [{ id: 'P1', name: 'S', staves: [] }],
          systems: [],
          measures: [
            {
              partId: 'P1',
              index: 0,
              status: 'matched',
              notes: [note('n1', { degree: 1, alteration: 1 })],
            },
          ],
        },
      }),
    });

    expect(chromatic.bytes).not.toEqual(natural.bytes);
    expect(chromatic.drawnCount).toBe(1);
  });

  it('PDF として読めないバイト列は例外にする', async () => {
    await expect(
      renderOverlay({ sourcePdf: new Uint8Array([1, 2, 3]), project: makeProject() }),
    ).rejects.toThrow();
  });

  it('score が null でも手動注釈は描ける', async () => {
    const project = makeProject({
      score: null,
      annotations: [annotation({ noteId: null, text: 'la', origin: 'manual' })],
    });
    const result = await renderOverlay({ sourcePdf: await makePdf(), project });

    expect(result.drawnCount).toBe(1);
  });
});

describe('OverlayRenderer（クラス形の入口）', () => {
  it('renderOverlay へ委譲する', async () => {
    const result = await new OverlayRenderer().render({
      sourcePdf: await makePdf(),
      project: makeProject(),
    });

    expect(result.drawnCount).toBe(1);
  });
});
