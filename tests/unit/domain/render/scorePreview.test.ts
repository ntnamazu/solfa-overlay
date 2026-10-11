import { describe, expect, it } from 'vitest';
import type { ScorePreviewInput } from '../../../../src/domain/render/scorePreview';
import { buildScorePreview } from '../../../../src/domain/render/scorePreview';
import type { OmrPageContent, OmrStaff } from '../../../../src/domain/score/OmrSheetParser';
import { DEFAULT_SETTINGS } from '../../../../src/shared/constants/DEFAULT_SETTINGS';
import type { Annotation } from '../../../../src/shared/types/Annotation';
import type { KeyRegion } from '../../../../src/shared/types/KeyRegion';
import type { PageInfo } from '../../../../src/shared/types/Project';
import type { NoteEvent, ScoreModel } from '../../../../src/shared/types/ScoreModel';
import type { SolfaDegree } from '../../../../src/shared/types/SolfaDegree';

/**
 * 画像 1000×2000px を 500×1000pt のページへ写す（縮尺 x・y とも 0.5）。
 * 検算しやすい数値にして、縮尺と y を反転しないことを直接確かめる
 */
const pageInfo = (pageIndex: number, sourcePageIndex: number): PageInfo => ({
  pageIndex,
  sourcePageIndex,
  widthPt: 500,
  heightPt: 1000,
  omrImageWidthPx: 1000,
  omrImageHeightPx: 2000,
  interlinePx: 20,
});

const note = (id: string, solfa: SolfaDegree | null): NoteEvent => ({
  id,
  partId: 'P1',
  measureIndex: 0,
  pitch: { step: 'C', alter: 0, octave: 4 },
  head: { pageIndex: 0, x: 0, y: 0 },
  solfa,
});

const annotation = (overrides: Partial<Annotation> = {}): Annotation => ({
  id: 'solfa-n1',
  layer: 'solfa',
  anchor: { pageIndex: 0, x: 200, y: 400 },
  noteId: 'n1',
  text: null,
  origin: 'auto',
  deleted: false,
  ...overrides,
});

const staff = (partId: string, extent?: { top: number; bottom: number }): OmrStaff => ({
  partId,
  staffId: partId,
  clefKind: 'TREBLE',
  heads: [],
  ...(extent === undefined ? {} : { extent }),
});

/** 1 ページ 1 段・2 小節（stack 100–500 / 500–900）・2 パート */
const omrPage = (
  staves: OmrStaff[] = [staff('P1', { top: 300, bottom: 380 })],
): OmrPageContent => ({
  systems: [
    {
      stacks: [
        { left: 100, right: 500 },
        { left: 500, right: 900 },
      ],
      staves,
    },
  ],
});

const score = (overrides: Partial<ScoreModel> = {}): ScoreModel => ({
  parts: [{ id: 'P1', name: 'Soprano', staves: [] }],
  systems: [{ pageIndex: 0, systemIndex: 0, firstMeasureIndex: 0, measureCount: 2 }],
  measures: [
    {
      partId: 'P1',
      index: 0,
      status: 'matched',
      notes: [note('n1', { degree: 1, alteration: 0 }), note('n2', { degree: 4, alteration: 1 })],
    },
  ],
  ...overrides,
});

function build(overrides: Partial<ScorePreviewInput> = {}) {
  return buildScorePreview({
    score: score(),
    omrPages: [omrPage()],
    pages: [pageInfo(0, 0)],
    annotations: [annotation()],
    annotationIssues: [],
    keyRegions: [],
    settings: { ...DEFAULT_SETTINGS },
    ...overrides,
  });
}

/**
 * 全ページの重ね描きから 1 種類だけを集める
 *
 * 小節の範囲は段があれば必ず作られるため、「ページが無い」では他の種類が無いことを確かめられない
 */
function collect(
  preview: ReturnType<typeof build>,
  key: 'annotations' | 'skippedMeasures' | 'placementWarnings',
): unknown[] {
  return preview.pages.flatMap((page): unknown[] => page[key]);
}

describe('buildScorePreview: 注釈', () => {
  it('アンカーを pt・左上原点へ縮尺する（y を反転しない）', () => {
    const [page] = build().pages;
    expect(page).toMatchObject({ sourcePageIndex: 0, widthPt: 500, heightPt: 1000 });
    expect(page?.annotations).toEqual([
      {
        id: 'solfa-n1',
        x: 100,
        y: 200,
        text: 'do',
        chromatic: false,
        origin: 'auto',
        textOverridden: false,
      },
    ]);
  });

  it('編集パネルのために、手動かどうかと文字の上書きの有無を添える', () => {
    const preview = build({
      annotations: [
        annotation({ id: 'solfa-n1', text: 'fi' }),
        annotation({ id: 'manual-1', noteId: null, text: 'ta', origin: 'manual' }),
      ],
    });
    expect(preview.pages[0]?.annotations).toMatchObject([
      { id: 'solfa-n1', text: 'fi', origin: 'auto', textOverridden: true },
      // 手動注釈の文字は「上書き」ではない（戻る先の自動の階名が無い）
      { id: 'manual-1', text: 'ta', origin: 'manual', textOverridden: false },
    ]);
  });

  it('変化音を区別し、音節体系に従って文字列化する', () => {
    const preview = build({
      annotations: [annotation({ id: 'solfa-n2', noteId: 'n2' })],
      settings: { ...DEFAULT_SETTINGS, syllableSystem: 'tonicSolfa' },
    });
    expect(preview.pages[0]?.annotations[0]).toMatchObject({ text: 'fe', chromatic: true });
  });

  it('出力PDFと同じく描けない文字を置換する（do♭ → dob）', () => {
    const preview = build({
      score: score({
        measures: [
          {
            partId: 'P1',
            index: 0,
            status: 'matched',
            notes: [note('n1', { degree: 1, alteration: -1 })],
          },
        ],
      }),
    });
    expect(preview.pages[0]?.annotations[0]?.text).toBe('dob');
  });

  it('削除フラグ・別レイヤー・文字が決まらない注釈は出力PDFと同じく出さない', () => {
    const preview = build({
      annotations: [
        annotation({ id: 'deleted', deleted: true }),
        annotation({ id: 'chord', layer: 'chordRole' }),
        annotation({ id: 'orphan', noteId: 'gone' }),
      ],
    });
    expect(collect(preview, 'annotations')).toEqual([]);
  });

  it('ページ寸法の無い・変換できないページの注釈は出さない', () => {
    expect(build({ pages: [] }).pages).toEqual([]);
    expect(build({ pages: [{ ...pageInfo(0, 0), omrImageWidthPx: 0 }] }).pages).toEqual([]);
  });

  it('同じ元PDFページに対応する Audiveris ページの注釈を 1 ページへまとめる（Victoria の sheet#1）', () => {
    const preview = build({
      pages: [pageInfo(0, 0), pageInfo(1, 0), pageInfo(2, 1)],
      annotations: [
        annotation({ id: 'a' }),
        annotation({ id: 'b', anchor: { pageIndex: 1, x: 0, y: 0 } }),
        annotation({ id: 'c', anchor: { pageIndex: 2, x: 0, y: 0 } }),
      ],
    });
    expect(preview.pages.map((page) => page.sourcePageIndex)).toEqual([0, 1]);
    expect(preview.pages[0]?.annotations.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('ページは元PDFのページ順に並べる', () => {
    const preview = build({
      pages: [pageInfo(0, 2), pageInfo(1, 0)],
      annotations: [
        annotation({ id: 'late' }),
        annotation({ id: 'early', anchor: { pageIndex: 1, x: 0, y: 0 } }),
      ],
    });
    expect(preview.pages.map((page) => page.sourcePageIndex)).toEqual([0, 2]);
  });
});

describe('buildScorePreview: 見た目', () => {
  it('書体と色を出力PDFと同じ値へ正規化する', () => {
    const { style } = build({
      settings: {
        ...DEFAULT_SETTINGS,
        fontFamily: ' Serif ',
        fontSizePt: 9,
        diatonicColor: '#F00',
        chromaticColor: '#6A0DAD',
      },
    });
    expect(style).toEqual({
      fontFamily: 'serif',
      fontSizePt: 9,
      diatonicColor: '#ff0000',
      chromaticColor: '#6a0dad',
    });
  });

  it('未知の書体・解釈できない色は出力PDFと同じく既定値へ落とす', () => {
    const { style } = build({
      settings: {
        ...DEFAULT_SETTINGS,
        fontFamily: 'Comic Sans MS',
        diatonicColor: 'red',
        chromaticColor: '',
      },
    });
    expect(style).toMatchObject({
      fontFamily: 'sans-serif',
      diatonicColor: DEFAULT_SETTINGS.diatonicColor,
      chromaticColor: DEFAULT_SETTINGS.chromaticColor,
    });
  });
});

describe('buildScorePreview: スキップ小節', () => {
  const skippedScore = (index: number, partId = 'P1') =>
    score({ measures: [{ partId, index, status: 'skipped', notes: [] }] });

  it('小節の stack × パートの譜線範囲（上下に半譜線間隔の余白）を囲む', () => {
    const preview = build({ score: skippedScore(1), annotations: [] });
    // px: left 500 / right 900 / top 300-10 / bottom 380+10 → pt は半分
    expect(preview.pages[0]?.skippedMeasures).toEqual([
      { partId: 'P1', measureIndex: 1, x: 250, y: 145, width: 200, height: 50 },
    ]);
  });

  it('同じパートが複数の譜表を持つときは縦範囲を合わせる', () => {
    const preview = build({
      score: skippedScore(0),
      omrPages: [
        omrPage([
          staff('P1', { top: 300, bottom: 380 }),
          staff('P2', { top: 500, bottom: 580 }),
          staff('P1', { top: 700, bottom: 780 }),
        ]),
      ],
      annotations: [],
    });
    expect(preview.pages[0]?.skippedMeasures[0]).toMatchObject({ y: 145, height: 250 });
  });

  it('stack が見つからない小節（measureNotDetected）は段全体の横範囲へ広げる', () => {
    const preview = build({
      score: score({
        systems: [{ pageIndex: 0, systemIndex: 0, firstMeasureIndex: 0, measureCount: 3 }],
        measures: [{ partId: 'P1', index: 2, status: 'skipped', notes: [] }],
      }),
      annotations: [],
    });
    expect(preview.pages[0]?.skippedMeasures[0]).toMatchObject({ x: 50, width: 400 });
  });

  it('位置を特定できない小節は推測で描かない', () => {
    // 段に属さない小節
    expect(collect(build({ score: skippedScore(5), annotations: [] }), 'skippedMeasures')).toEqual(
      [],
    );
    // パートの譜表に譜線範囲が無い
    expect(
      collect(
        build({ score: skippedScore(0), omrPages: [omrPage([staff('P1')])], annotations: [] }),
        'skippedMeasures',
      ),
    ).toEqual([]);
    // パートの譜表がその段に無い
    expect(
      collect(build({ score: skippedScore(0, 'P9'), annotations: [] }), 'skippedMeasures'),
    ).toEqual([]);
    // .omr に段が無い
    expect(build({ score: skippedScore(0), omrPages: [], annotations: [] }).pages).toEqual([]);
    // 段に stack が 1 つも無く横範囲が決まらない
    expect(
      collect(
        build({
          score: skippedScore(0),
          omrPages: [{ systems: [{ stacks: [], staves: [staff('P1', { top: 1, bottom: 2 })] }] }],
          annotations: [],
        }),
        'skippedMeasures',
      ),
    ).toEqual([]);
    // 段のページに寸法が無い
    expect(build({ score: skippedScore(0), pages: [], annotations: [] }).pages).toEqual([]);
  });

  it('照合できた小節は囲まない', () => {
    expect(build().pages[0]?.skippedMeasures).toEqual([]);
  });
});

describe('buildScorePreview: 配置警告', () => {
  it('配置を調整できなかった注釈のアンカー位置に印を置く', () => {
    const preview = build({
      annotationIssues: [
        { kind: 'placementUnresolved', annotationId: 'solfa-n1', pageIndex: 0 },
        { kind: 'missingPageGeometry', pageIndex: 0 },
      ],
    });
    expect(preview.pages[0]?.placementWarnings).toEqual([
      { annotationId: 'solfa-n1', x: 100, y: 200 },
    ]);
  });

  it('対応する注釈やページ寸法が無ければ印を置かない', () => {
    const preview = build({
      annotations: [],
      annotationIssues: [{ kind: 'placementUnresolved', annotationId: 'gone', pageIndex: 0 }],
    });
    expect(collect(preview, 'placementWarnings')).toEqual([]);
    expect(
      build({
        pages: [],
        annotationIssues: [{ kind: 'placementUnresolved', annotationId: 'solfa-n1', pageIndex: 0 }],
      }).pages,
    ).toEqual([]);
  });
});

describe('buildScorePreview: 小節の範囲と調の区切り（F-6）', () => {
  const region = (measureIndex: number, overrides: Partial<KeyRegion> = {}): KeyRegion => ({
    id: `key-${measureIndex}`,
    start: { measureIndex, offset: 0 },
    tonicStep: 'C',
    tonicAlter: 0,
    mode: 'major',
    source: 'auto',
    ...overrides,
  });
  /** 2 パートの段（P1 300–380px / P2 500–580px） */
  const twoParts = [
    omrPage([staff('P1', { top: 300, bottom: 380 }), staff('P2', { top: 500, bottom: 580 })]),
  ];

  it('小節ごとに stack × 段の全譜表の縦範囲（上下に半譜線間隔の余白）を持つ', () => {
    const preview = build({ omrPages: twoParts, annotations: [] });
    // px: top 300-10 / bottom 580+10 → pt は半分
    expect(preview.pages[0]?.measures).toEqual([
      { measureIndex: 0, x: 50, y: 145, width: 200, height: 150 },
      { measureIndex: 1, x: 250, y: 145, width: 200, height: 150 },
    ]);
  });

  it('区切りが始まる小節の左端・上端に印を置く（曲頭を含む）', () => {
    const preview = build({
      omrPages: twoParts,
      keyRegions: [
        region(0),
        region(1, { tonicStep: 'E', tonicAlter: 0, mode: 'minor', source: 'user' }),
      ],
    });
    expect(preview.pages[0]?.keyChanges).toEqual([
      {
        measureIndex: 0,
        x: 50,
        y: 145,
        height: 150,
        tonicStep: 'C',
        tonicAlter: 0,
        mode: 'major',
        source: 'auto',
      },
      {
        measureIndex: 1,
        x: 250,
        y: 145,
        height: 150,
        tonicStep: 'E',
        tonicAlter: 0,
        mode: 'minor',
        source: 'user',
      },
    ]);
  });

  it('段のページの元PDFページへ載せる', () => {
    const preview = build({
      score: score({
        systems: [{ pageIndex: 1, systemIndex: 0, firstMeasureIndex: 0, measureCount: 1 }],
      }),
      omrPages: [omrPage(), omrPage()],
      pages: [pageInfo(0, 0), pageInfo(1, 3)],
      annotations: [],
      keyRegions: [region(0)],
    });
    expect(preview.pages.map((page) => page.sourcePageIndex)).toEqual([3]);
    expect(preview.pages[0]?.keyChanges.map((marker) => marker.measureIndex)).toEqual([0]);
  });

  it('位置が分からない小節は範囲を作らず、その小節の区切りには印を置かない', () => {
    const noExtent = build({
      omrPages: [omrPage([staff('P1')])],
      annotations: [],
      keyRegions: [region(0)],
    });
    expect(noExtent.pages).toEqual([]);

    // stack が 1 つしか無い段の 2 小節目
    const oneStack = build({
      omrPages: [
        {
          systems: [
            {
              stacks: [{ left: 100, right: 500 }],
              staves: [staff('P1', { top: 300, bottom: 380 })],
            },
          ],
        },
      ],
      annotations: [],
      keyRegions: [region(0), region(1, { tonicStep: 'G' })],
    });
    expect(oneStack.pages[0]?.measures.map((measure) => measure.measureIndex)).toEqual([0]);
    expect(oneStack.pages[0]?.keyChanges.map((marker) => marker.measureIndex)).toEqual([0]);

    // .omr に段が無い・段のページに寸法が無い・範囲外の区切り
    expect(build({ omrPages: [], annotations: [], keyRegions: [region(0)] }).pages).toEqual([]);
    expect(build({ pages: [], annotations: [], keyRegions: [region(0)] }).pages).toEqual([]);
    expect(build({ annotations: [], keyRegions: [region(9)] }).pages[0]?.keyChanges).toEqual([]);
  });

  it('同じ通し小節番号が複数の段に現れたら先の段を採る', () => {
    const preview = build({
      score: score({
        systems: [
          { pageIndex: 0, systemIndex: 0, firstMeasureIndex: 0, measureCount: 1 },
          { pageIndex: 0, systemIndex: 1, firstMeasureIndex: 0, measureCount: 1 },
        ],
      }),
      omrPages: [
        {
          systems: [
            {
              stacks: [{ left: 100, right: 500 }],
              staves: [staff('P1', { top: 300, bottom: 380 })],
            },
            {
              stacks: [{ left: 100, right: 500 }],
              staves: [staff('P1', { top: 900, bottom: 980 })],
            },
          ],
        },
      ],
      annotations: [],
    });
    expect(preview.pages[0]?.measures).toEqual([
      { measureIndex: 0, x: 50, y: 145, width: 200, height: 50 },
    ]);
  });
});
