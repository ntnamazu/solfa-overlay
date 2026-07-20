import { describe, expect, it } from 'vitest';
import { BookStructureResolver } from '../../../../src/domain/score/BookStructureResolver';
import type { StructureIssue } from '../../../../src/domain/score/BookStructureResolver';
import type {
  MusicXmlSystemLayout,
  ParsedMusicXml,
} from '../../../../src/domain/score/MusicXmlParser';
import type { BookPageRef, OmrPageContent } from '../../../../src/domain/score/OmrSheetParser';
import type { OmrArtifacts } from '../../../../src/domain/score/ScoreModelBuilder';

/** stackCount 個の stack と staffCounts 分の譜表を持つ段を作る（座標は照合しないため素朴でよい） */
const system = (stackCount: number, staffCount = 1): OmrPageContent['systems'][number] => ({
  stacks: Array.from({ length: stackCount }, (_, index) => ({
    left: index * 100,
    right: (index + 1) * 100,
  })),
  staves: Array.from({ length: staffCount }, (_, index) => ({
    partId: `P${index + 1}`,
    staffId: `s${index + 1}`,
    clefKind: 'TREBLE',
    heads: [],
  })),
});

const page = (systems: OmrPageContent['systems']): OmrPageContent => ({ systems });

/** ページ順に new-page / new-system を割り当てた段レイアウトを作る */
const layoutOf = (pages: number[][]): MusicXmlSystemLayout[] => {
  const layout: MusicXmlSystemLayout[] = [];
  let firstMeasureIndex = 0;
  pages.forEach((systems, pageIndex) => {
    systems.forEach((measureCount, systemIndex) => {
      layout.push({ pageIndex, systemIndex, firstMeasureIndex, measureCount });
      firstMeasureIndex += measureCount;
    });
  });
  return layout;
};

/** partCount 個のパートが measureCount 小節ずつ持つ MusicXML */
const musicXml = (measureCount: number, layout: MusicXmlSystemLayout[]): ParsedMusicXml => ({
  parts: [
    {
      id: 'P1',
      name: 'Voice',
      measures: Array.from({ length: measureCount }, (_, index) => ({
        index,
        key: null,
        notes: [],
      })),
    },
  ],
  layout,
});

/** movementStart が true のページで区切られる book.xml のページ参照列 */
const bookPages = (movementStarts: boolean[]): BookPageRef[] =>
  movementStarts.map((movementStart, index) => ({
    sheetNumber: index + 1,
    pageIndexInSheet: 0,
    movementStart,
  }));

const resolver = new BookStructureResolver();

const kindsOf = (issues: StructureIssue[]): string[] => issues.map((issue) => issue.kind);

describe('BookStructureResolver.resolve', () => {
  it('MusicXML の段レイアウトに小節番号をアンカーする', () => {
    const artifacts: OmrArtifacts = {
      movements: [{ musicXml: musicXml(9, layoutOf([[4, 5]])) }],
      pages: [page([system(4), system(5)])],
    };
    const structure = resolver.resolve(artifacts, bookPages([true]));
    expect(structure.movements[0]?.systems).toEqual([
      { pageIndex: 0, systemIndex: 0, firstMeasureIndex: 0, measureCount: 4 },
      { pageIndex: 0, systemIndex: 1, firstMeasureIndex: 4, measureCount: 5 },
    ]);
    expect(structure.movements[0]?.pageIndices).toEqual([0]);
  });

  it('stack 数が MusicXML と食い違う段でも、後続段の小節番号がずれない', () => {
    // 第1段は stack 5 個だが MusicXML は 4 小節 → 第2段は 4 から始まる（5 ではない）
    const artifacts: OmrArtifacts = {
      movements: [{ musicXml: musicXml(9, layoutOf([[4, 5]])) }],
      pages: [page([system(5), system(5)])],
    };
    expect(resolver.resolve(artifacts, bookPages([true])).movements[0]?.systems).toEqual([
      { pageIndex: 0, systemIndex: 0, firstMeasureIndex: 0, measureCount: 4 },
      { pageIndex: 0, systemIndex: 1, firstMeasureIndex: 4, measureCount: 5 },
    ]);
  });

  it('MusicXML にレイアウトがない段は OMR の stack 数へフォールバックする', () => {
    const artifacts: OmrArtifacts = {
      movements: [{ musicXml: musicXml(7, []) }],
      pages: [page([system(3), system(4)])],
    };
    expect(
      resolver
        .resolve(artifacts, bookPages([true]))
        .movements[0]?.systems.map((s) => [s.firstMeasureIndex, s.measureCount]),
    ).toEqual([
      [0, 3],
      [3, 4],
    ]);
  });

  it('movement を跨いで通し小節番号が累積する', () => {
    const artifacts: OmrArtifacts = {
      movements: [
        { musicXml: musicXml(3, layoutOf([[3]])) },
        { musicXml: musicXml(6, layoutOf([[6]])) },
      ],
      pages: [page([system(3)]), page([system(6)])],
    };
    const structure = resolver.resolve(artifacts, bookPages([true, true]));
    expect(structure.movements.map((movement) => movement.musicXmlIndex)).toEqual([0, 1]);
    expect(structure.movements[1]?.systems).toEqual([
      { pageIndex: 1, systemIndex: 0, firstMeasureIndex: 3, measureCount: 6 },
    ]);
  });

  it('MusicXML が movement 数より少ない場合は末尾 movement に寄せる', () => {
    const artifacts: OmrArtifacts = {
      movements: [{ musicXml: musicXml(4, layoutOf([[2], [2]])) }],
      pages: [page([system(2)]), page([system(2)])],
    };
    expect(
      resolver.resolve(artifacts, bookPages([true, true])).movements.map((m) => m.musicXmlIndex),
    ).toEqual([0, 0]);
  });

  it('段数が一致しないページでは MusicXML のレイアウトを使わず stack 数へフォールバックする', () => {
    // 段の対応づけは序数で行うため、段数が違うページでは対応が保証されない
    const artifacts: OmrArtifacts = {
      movements: [{ musicXml: musicXml(9, layoutOf([[4, 5]])) }],
      pages: [page([system(3), system(3), system(3)])],
    };
    expect(
      resolver
        .resolve(artifacts, bookPages([true]))
        .movements[0]?.systems.map((s) => [s.firstMeasureIndex, s.measureCount]),
    ).toEqual([
      [0, 3],
      [3, 3],
      [6, 3],
    ]);
  });

  it('book.xml と実ページ数が食い違う場合は XML レイアウトへアンカーしない', () => {
    // artifacts.pages は sheet XML を持つページだけの配列なので、数が違えば「k 番目 ↔ k 番目」の
    // 対応は成立しない。推測でアンカーすると小節番号が黙ってずれるため stack 数へ退避する
    const artifacts: OmrArtifacts = {
      movements: [{ musicXml: musicXml(12, layoutOf([[4], [4], [4]])) }],
      pages: [page([system(6)]), page([system(6)])],
    };
    expect(
      resolver
        .resolve(artifacts, bookPages([true, false, false]))
        .movements[0]?.systems.map((s) => [s.firstMeasureIndex, s.measureCount]),
    ).toEqual([
      [0, 6],
      [6, 6],
    ]);
  });

  it('ページ数が一致していれば XML レイアウトへアンカーする（上のケースとの対比）', () => {
    const artifacts: OmrArtifacts = {
      movements: [{ musicXml: musicXml(12, layoutOf([[4], [4], [4]])) }],
      pages: [page([system(6)]), page([system(6)]), page([system(6)])],
    };
    expect(
      resolver
        .resolve(artifacts, bookPages([true, false, false]))
        .movements[0]?.systems.map((s) => s.measureCount),
    ).toEqual([4, 4, 4]);
  });

  it('MusicXML が 1 つもない場合も stack 数で構造を組み立てられる', () => {
    const artifacts: OmrArtifacts = { movements: [], pages: [page([system(4)])] };
    const structure = resolver.resolve(artifacts, bookPages([true]));
    expect(structure.movements[0]?.systems).toEqual([
      { pageIndex: 0, systemIndex: 0, firstMeasureIndex: 0, measureCount: 4 },
    ]);
  });

  it('book.xml に載っていても実体のないページは構造から除外される', () => {
    const artifacts: OmrArtifacts = {
      movements: [{ musicXml: musicXml(4, layoutOf([[4]])) }],
      pages: [page([system(4)])],
    };
    // book.xml は 2 ページぶんあるが artifacts.pages は 1 ページしかない
    const structure = resolver.resolve(artifacts, bookPages([true, false]));
    expect(structure.movements[0]?.pageIndices).toEqual([0]);
    expect(structure.movements[0]?.systems).toHaveLength(1);
  });

  it('systemMeasureCount の decision が MusicXML レイアウトより優先される', () => {
    const artifacts: OmrArtifacts = {
      movements: [{ musicXml: musicXml(9, layoutOf([[4, 5]])) }],
      pages: [page([system(4), system(5)])],
    };
    const structure = resolver.resolve(artifacts, bookPages([true]), [
      { kind: 'systemMeasureCount', pageIndex: 0, systemIndex: 0, measureCount: 6 },
    ]);
    expect(
      structure.movements[0]?.systems.map((s) => [s.firstMeasureIndex, s.measureCount]),
    ).toEqual([
      [0, 6],
      [6, 5],
    ]);
  });

  it('measureCount 0 の decision では後続段の小節番号が進まない', () => {
    // 段を「担当小節なし」として無効化する使い方（確認画面で誤検出段を外すケースを想定）
    const artifacts: OmrArtifacts = {
      movements: [{ musicXml: musicXml(9, layoutOf([[4, 5]])) }],
      pages: [page([system(4), system(5)])],
    };
    const structure = resolver.resolve(artifacts, bookPages([true]), [
      { kind: 'systemMeasureCount', pageIndex: 0, systemIndex: 0, measureCount: 0 },
    ]);
    expect(
      structure.movements[0]?.systems.map((s) => [s.firstMeasureIndex, s.measureCount]),
    ).toEqual([
      [0, 0],
      [0, 5],
    ]);
  });

  it('movementAssignment の decision で対応 MusicXML を差し替えられる', () => {
    const artifacts: OmrArtifacts = {
      movements: [
        { musicXml: musicXml(3, layoutOf([[3]])) },
        { musicXml: musicXml(6, layoutOf([[6]])) },
      ],
      pages: [page([system(6)])],
    };
    const structure = resolver.resolve(artifacts, bookPages([true]), [
      { kind: 'movementAssignment', movementIndex: 0, musicXmlIndex: 1 },
    ]);
    expect(structure.movements[0]?.musicXmlIndex).toBe(1);
    expect(structure.movements[0]?.systems[0]?.measureCount).toBe(6);
  });
});

describe('BookStructureResolver.detect', () => {
  it('構造が整合していれば問題を検出しない', () => {
    const artifacts: OmrArtifacts = {
      movements: [{ musicXml: musicXml(9, layoutOf([[4, 5]])) }],
      pages: [page([system(4, 4), system(5, 4)])],
    };
    expect(resolver.detect(artifacts, bookPages([true]))).toEqual([]);
  });

  it('段あたりの小節数の食い違いを検出する', () => {
    const artifacts: OmrArtifacts = {
      movements: [{ musicXml: musicXml(9, layoutOf([[4, 5]])) }],
      pages: [page([system(5), system(5)])],
    };
    expect(resolver.detect(artifacts, bookPages([true]))).toEqual([
      {
        kind: 'systemMeasureCountMismatch',
        movementIndex: 0,
        pageIndex: 0,
        systemIndex: 0,
        omrStackCount: 5,
        xmlMeasureCount: 4,
      },
    ]);
  });

  it('ページ数・段数の食い違いを検出する', () => {
    const artifacts: OmrArtifacts = {
      movements: [{ musicXml: musicXml(9, layoutOf([[4, 5]])) }],
      pages: [page([system(4), system(5), system(3)])],
    };
    const issues = resolver.detect(artifacts, bookPages([true]));
    expect(kindsOf(issues)).toEqual(['systemCountMismatch']);
    expect(issues[0]).toMatchObject({ omrSystemCount: 3, xmlSystemCount: 2 });
  });

  it('movement 数と MusicXML 数の食い違いを検出する', () => {
    const artifacts: OmrArtifacts = {
      movements: [{ musicXml: musicXml(4, layoutOf([[2], [2]])) }],
      pages: [page([system(2)]), page([system(2)])],
    };
    const issues = resolver.detect(artifacts, bookPages([true, true]));
    expect(issues[0]).toEqual({
      kind: 'movementCountMismatch',
      omrMovementCount: 2,
      musicXmlCount: 1,
    });
    // 1 つの MusicXML を 2 movement に割り当てるため、ページ数の食い違いも併せて報告される
    expect(kindsOf(issues)).toContain('pageCountMismatch');
  });

  it('MusicXML が 1 つもない場合は movementCountMismatch だけを返す', () => {
    const artifacts: OmrArtifacts = { movements: [], pages: [page([system(4)])] };
    expect(resolver.detect(artifacts, bookPages([true]))).toEqual([
      { kind: 'movementCountMismatch', omrMovementCount: 1, musicXmlCount: 0 },
    ]);
  });

  it('book.xml と実ページ数の食い違いを報告する', () => {
    const artifacts: OmrArtifacts = {
      movements: [{ musicXml: musicXml(12, layoutOf([[4], [4], [4]])) }],
      pages: [page([system(4)]), page([system(4)])],
    };
    const issues = resolver.detect(artifacts, bookPages([true, false, false]));
    expect(issues).toContainEqual({
      kind: 'pageCorrespondenceMismatch',
      bookPageCount: 3,
      artifactPageCount: 2,
    });
    // 対応が取れない以上、段あたり小節数の突き合わせは行わない（resolve も同じ判断をする）
    expect(kindsOf(issues)).not.toContain('systemMeasureCountMismatch');
  });

  it('同一ページ内で段の譜表数が揃わない場合に警告する', () => {
    const artifacts: OmrArtifacts = {
      movements: [{ musicXml: musicXml(9, layoutOf([[4, 5]])) }],
      pages: [page([system(4, 2), system(5, 4)])],
    };
    expect(resolver.detect(artifacts, bookPages([true]))).toEqual([
      {
        kind: 'inconsistentSystemStaffCount',
        movementIndex: 0,
        pageIndex: 0,
        staffCounts: [2, 4],
      },
    ]);
  });
});
