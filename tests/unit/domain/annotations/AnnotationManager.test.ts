import { describe, expect, it } from 'vitest';
import {
  AnnotationManager,
  MANUAL_TEXT_MAX_LENGTH,
  addAnnotation,
  applyAnnotationEdit,
  autoAnnotationId,
  listSkippedMeasures,
  manualAnchorAt,
  regenerateAnnotations,
  removeAnnotation,
  updateAnnotation,
} from '../../../../src/domain/annotations/AnnotationManager';
import { AnnotationEditError } from '../../../../src/domain/annotations/errors';
import { solfaFonts } from '../../../../src/domain/render/fontMetrics';
import type { PageGeometry } from '../../../../src/domain/score/OmrSheetParser';
import { DEFAULT_SETTINGS } from '../../../../src/shared/constants/DEFAULT_SETTINGS';
import type { Annotation } from '../../../../src/shared/types/Annotation';
import type { PageInfo } from '../../../../src/shared/types/Project';
import type { Measure, NoteEvent, ScoreModel } from '../../../../src/shared/types/ScoreModel';
import type { SolfaDegree } from '../../../../src/shared/types/SolfaDegree';

const PAGE: PageInfo = {
  pageIndex: 0,
  sourcePageIndex: 0,
  widthPt: 595.28,
  heightPt: 841.89,
  omrImageWidthPx: 2480,
  omrImageHeightPx: 3507,
  interlinePx: 17,
};

const note = (
  id: string,
  x: number,
  y: number,
  solfa: SolfaDegree | null = { degree: 1, alteration: 0 },
): NoteEvent => ({
  id,
  partId: 'P1',
  measureIndex: 0,
  pitch: { step: 'C', alter: 0, octave: 4 },
  head: { pageIndex: 0, x, y },
  solfa,
});

const scoreWith = (notes: NoteEvent[], extra: Measure[] = []): ScoreModel => ({
  parts: [{ id: 'P1', name: 'Soprano', staves: [] }],
  systems: [],
  measures: [{ partId: 'P1', index: 0, status: 'matched', notes }, ...extra],
});

const emptyGeometry: PageGeometry[] = [
  { image: { widthPx: 2480, heightPx: 3507, interlinePx: 17 }, symbols: [] },
];

const regenerate = (
  score: ScoreModel,
  existing: Annotation[] = [],
  geometry: PageGeometry[] = emptyGeometry,
  pages: PageInfo[] = [PAGE],
) => regenerateAnnotations({ score, geometry, pages, settings: DEFAULT_SETTINGS, existing });

describe('regenerateAnnotations', () => {
  it('階名を持つ音符に注釈を作り、持たない音符には作らない', () => {
    const score = scoreWith([note('n1', 500, 400), note('n2', 700, 400, null)]);
    const result = regenerate(score);

    expect(result.annotations).toHaveLength(1);
    expect(result.annotations[0]?.noteId).toBe('n1');
    expect(result.annotations[0]?.layer).toBe('solfa');
    expect(result.annotations[0]?.origin).toBe('auto');
  });

  it('注釈 id は音符 id から決まり、再生成しても変わらない', () => {
    const score = scoreWith([note('n1', 500, 400)]);

    expect(regenerate(score).annotations[0]?.id).toBe(autoAnnotationId('n1'));
    expect(regenerate(score).annotations[0]?.id).toBe(regenerate(score).annotations[0]?.id);
  });

  it('注釈は符頭の近くに置かれ、ページ添字を引き継ぐ', () => {
    const result = regenerate(scoreWith([note('n1', 500, 400)]));
    const anchor = result.annotations[0]?.anchor;

    expect(anchor?.pageIndex).toBe(0);
    // 基本位置は符頭の直上（y は下向きなので符頭上端より小さい）
    expect(anchor?.y).toBeLessThan(400);
    expect(anchor?.x).toBeLessThan(500); // 文字列の左端は符頭中心より左
  });

  it('同じ入力からは同じ結果を返す（入力の並び順に依存しない）', () => {
    const notes = [note('n1', 500, 400), note('n2', 520, 400), note('n3', 540, 400)];
    const forward = regenerate(scoreWith(notes)).annotations;
    const reversed = regenerate(scoreWith([...notes].reverse())).annotations;

    expect(reversed).toEqual(forward);
  });

  it('手動注釈は再生成しても消えない', () => {
    const manual = addAnnotation({ pageIndex: 0, x: 10, y: 20 }, 'メモ', 'manual-1');
    const result = regenerate(scoreWith([note('n1', 500, 400)]), [manual]);

    expect(result.annotations).toContainEqual(manual);
  });

  it('削除済みの自動注釈は再生成で復活しない（deleted を引き継ぐ）', () => {
    const score = scoreWith([note('n1', 500, 400)]);
    const first = regenerate(score).annotations;
    const deleted = removeAnnotation(first, autoAnnotationId('n1'));

    const regenerated = regenerate(score, deleted).annotations;
    expect(regenerated.find((a) => a.id === autoAnnotationId('n1'))?.deleted).toBe(true);
  });

  it('手動で上書きした文字は再生成後も残る', () => {
    const score = scoreWith([note('n1', 500, 400)]);
    const edited = updateAnnotation(regenerate(score).annotations, autoAnnotationId('n1'), {
      text: 'ドゥ',
    });

    expect(regenerate(score, edited).annotations[0]?.text).toBe('ドゥ');
  });

  it('音符が消えた自動注釈は残したうえで孤立として報告する', () => {
    const before = regenerate(scoreWith([note('n1', 500, 400)])).annotations;
    // 再解析で音符 id が変わった（OMR 再実行や訂正で起こり得る）
    const after = regenerate(scoreWith([note('n9', 500, 400)]), before);

    expect(after.issues).toContainEqual({
      kind: 'orphanAnnotation',
      annotationId: autoAnnotationId('n1'),
    });
    expect(after.annotations.map((a) => a.id)).toContain(autoAnnotationId('n1'));
  });

  it('障害物があれば基本位置を避ける', () => {
    const blocked: PageGeometry[] = [
      {
        image: { widthPx: 2480, heightPx: 3507, interlinePx: 17 },
        symbols: [{ kind: 'head', x: 400, y: 300, w: 200, h: 120 }],
      },
    ];
    const free = regenerate(scoreWith([note('n1', 500, 400)])).annotations[0];
    const avoided = regenerate(scoreWith([note('n1', 500, 400)]), [], blocked).annotations[0];

    expect(avoided?.anchor.y).not.toBeCloseTo(free?.anchor.y ?? 0, 6);
  });

  it('符幹だけがある場所は基本位置のまま（細線は障害物にしない）', () => {
    const withStem: PageGeometry[] = [
      {
        image: { widthPx: 2480, heightPx: 3507, interlinePx: 17 },
        symbols: [{ kind: 'stem', x: 480, y: 320, w: 4, h: 90 }],
      },
    ];
    const free = regenerate(scoreWith([note('n1', 500, 400)])).annotations[0];
    const withStemResult = regenerate(scoreWith([note('n1', 500, 400)]), [], withStem)
      .annotations[0];

    expect(withStemResult?.anchor).toEqual(free?.anchor);
  });

  it('非表示（deleted）の自動注釈は配置スペースを占有しない', () => {
    // n1 と n2 は同じ符頭位置。n1 を非表示にすると、その分の場所は空くはずで、
    // n2 は n1 が居なかったときと同じ基本位置を採れる（描かれない注釈が邪魔をしない）
    const free = regenerate(scoreWith([note('n2', 500, 400)])).annotations[0];
    const deletedN1: Annotation = {
      id: autoAnnotationId('n1'),
      layer: 'solfa',
      anchor: { pageIndex: 0, x: 123, y: 456 },
      noteId: 'n1',
      text: null,
      origin: 'auto',
      deleted: true,
    };
    const score = scoreWith([note('n1', 500, 400), note('n2', 500, 400)]);
    const result = regenerate(score, [deletedN1]);
    const n2 = result.annotations.find((a) => a.id === autoAnnotationId('n2'));

    expect(n2?.anchor).toEqual(free?.anchor);
    // 非表示の注釈が placementUnresolved を水増ししないこと
    expect(result.issues.some((i) => i.kind === 'placementUnresolved')).toBe(false);
  });

  it('描画される手動注釈を障害物として避ける（真上に重ねない）', () => {
    const score = scoreWith([note('n1', 500, 400)]);
    const free = regenerate(score).annotations[0];
    // 自動注釈の基本位置とちょうど重なる手動注釈を置く
    const manual = addAnnotation(
      { pageIndex: 0, x: free?.anchor.x ?? 0, y: free?.anchor.y ?? 0 },
      'do',
      'm1',
    );
    const moved = regenerate(score, [manual]).annotations.find(
      (a) => a.id === autoAnnotationId('n1'),
    );

    expect(moved?.anchor.y).not.toBeCloseTo(free?.anchor.y ?? 0, 6);
  });

  it('全候補が塞がれた注釈を placementUnresolved として報告する', () => {
    const walled: PageGeometry[] = [
      {
        image: { widthPx: 2480, heightPx: 3507, interlinePx: 17 },
        symbols: [{ kind: 'beam', x: 0, y: 0, w: 3000, h: 3000 }],
      },
    ];
    const result = regenerate(scoreWith([note('n1', 500, 400)]), [], walled);

    expect(result.issues).toContainEqual({
      kind: 'placementUnresolved',
      annotationId: autoAnnotationId('n1'),
      pageIndex: 0,
    });
    // それでも注釈自体は作られる（音符が無視されない）
    expect(result.annotations).toHaveLength(1);
  });

  it('ページ寸法が無いページは注釈を作りつつ missingPageGeometry を報告する', () => {
    const result = regenerate(scoreWith([note('n1', 500, 400)]), [], emptyGeometry, []);

    expect(result.issues).toContainEqual({ kind: 'missingPageGeometry', pageIndex: 0 });
    expect(result.annotations).toHaveLength(1);
    expect(Number.isFinite(result.annotations[0]?.anchor.y)).toBe(true);
  });

  it('幾何情報が無いページも同じく報告し、座標は有限のままにする', () => {
    const result = regenerate(scoreWith([note('n1', 500, 400)]), [], [], [PAGE]);

    expect(result.issues).toContainEqual({ kind: 'missingPageGeometry', pageIndex: 0 });
    expect(Number.isFinite(result.annotations[0]?.anchor.x)).toBe(true);
  });

  it('変化音は幹音より広い幅で場所を取る（太字で描かれるため）', () => {
    const natural = regenerate(scoreWith([note('n1', 500, 400, { degree: 1, alteration: 0 })]));
    const sharp = regenerate(scoreWith([note('n1', 500, 400, { degree: 1, alteration: 1 })]));

    // 'do'（幹音）と 'di'（変化音・太字）で左端の位置が異なる
    expect(sharp.annotations[0]?.anchor.x).not.toBe(natural.annotations[0]?.anchor.x);
  });
});

describe('注釈の編集', () => {
  it('手動注釈は origin: manual で noteId を持たない', () => {
    const annotation = addAnnotation({ pageIndex: 1, x: 5, y: 6 }, 'la', 'm1');

    expect(annotation).toEqual({
      id: 'm1',
      layer: 'solfa',
      anchor: { pageIndex: 1, x: 5, y: 6 },
      noteId: null,
      text: 'la',
      origin: 'manual',
      deleted: false,
    });
  });

  it('update は対象だけを書き換え、他は元の参照のまま返す', () => {
    const a = addAnnotation({ pageIndex: 0, x: 1, y: 1 }, 'do', 'a');
    const b = addAnnotation({ pageIndex: 0, x: 2, y: 2 }, 're', 'b');
    const updated = updateAnnotation([a, b], 'a', { text: 'di' });

    expect(updated[0]?.text).toBe('di');
    expect(updated[1]).toBe(b);
  });

  it('存在しない id の update は何も変えない', () => {
    const a = addAnnotation({ pageIndex: 0, x: 1, y: 1 }, 'do', 'a');
    expect(updateAnnotation([a], 'zzz', { text: 'x' })).toEqual([a]);
  });

  it('手動注釈の削除は実体を消す', () => {
    const manual = addAnnotation({ pageIndex: 0, x: 1, y: 1 }, 'do', 'm1');
    expect(removeAnnotation([manual], 'm1')).toEqual([]);
  });

  it('自動注釈の削除は deleted を立てる（消すと再生成で復活してしまうため）', () => {
    const auto = regenerate(scoreWith([note('n1', 500, 400)])).annotations;
    const removed = removeAnnotation(auto, autoAnnotationId('n1'));

    expect(removed).toHaveLength(1);
    expect(removed[0]?.deleted).toBe(true);
  });

  it('存在しない id の削除は元の配列と同じ内容を返す', () => {
    const manual = addAnnotation({ pageIndex: 0, x: 1, y: 1 }, 'do', 'm1');
    expect(removeAnnotation([manual], 'zzz')).toEqual([manual]);
  });
});

describe('manualAnchorAt（押した位置 → 手動注釈の位置）', () => {
  const scale = PAGE.omrImageWidthPx / PAGE.widthPt;
  const metrics = solfaFonts(DEFAULT_SETTINGS.fontFamily).regular;
  const fontPx = DEFAULT_SETTINGS.fontSizePt * scale;

  it('押した点が文字の中心になるよう、左端とベースラインを決める', () => {
    const anchor = manualAnchorAt(
      { sourcePageIndex: 0, x: 100, y: 200 },
      'fi',
      [PAGE],
      DEFAULT_SETTINGS,
    );

    expect(anchor.pageIndex).toBe(0);
    expect(anchor.x).toBeCloseTo(100 * scale - metrics.widthPt('fi', fontPx) / 2, 6);
    expect(anchor.y).toBeCloseTo(
      200 * (PAGE.omrImageHeightPx / PAGE.heightPt) + metrics.ascentPt(fontPx) / 2,
      6,
    );
  });

  it('1 つの元PDFページに複数の Audiveris ページがあれば、最小の pageIndex を選ぶ', () => {
    // Victoria は sheet#1（元PDF 1 ページ目）が Audiveris の page 0 と page 1 を含む
    const pages = [
      { ...PAGE, pageIndex: 2, sourcePageIndex: 1 },
      { ...PAGE, pageIndex: 1, sourcePageIndex: 0 },
      { ...PAGE, pageIndex: 0, sourcePageIndex: 0 },
    ];
    expect(
      manualAnchorAt({ sourcePageIndex: 0, x: 1, y: 1 }, 'do', pages, DEFAULT_SETTINGS).pageIndex,
    ).toBe(0);
    expect(
      manualAnchorAt({ sourcePageIndex: 1, x: 1, y: 1 }, 'do', pages, DEFAULT_SETTINGS).pageIndex,
    ).toBe(2);
  });

  it('対応する Audiveris ページが無い元PDFページには書き足せない', () => {
    expect(() =>
      manualAnchorAt({ sourcePageIndex: 5, x: 1, y: 1 }, 'do', [PAGE], DEFAULT_SETTINGS),
    ).toThrow(AnnotationEditError);
  });

  it('座標を変換できないページには書き足せない（NaN の位置を保存しない）', () => {
    expect(() =>
      manualAnchorAt(
        { sourcePageIndex: 0, x: 1, y: 1 },
        'do',
        [{ ...PAGE, omrImageWidthPx: 0 }],
        DEFAULT_SETTINGS,
      ),
    ).toThrow(AnnotationEditError);
  });
});

describe('applyAnnotationEdit（楽譜プレビューからの編集）', () => {
  const auto: Annotation = {
    id: 'solfa-n1',
    layer: 'solfa',
    anchor: { pageIndex: 0, x: 10, y: 20 },
    noteId: 'n1',
    text: null,
    origin: 'auto',
    deleted: false,
  };
  const manual = addAnnotation({ pageIndex: 0, x: 30, y: 40 }, 'fi', 'manual-1');
  const context = { pages: [PAGE], settings: DEFAULT_SETTINGS, newId: () => 'manual-new' };
  const apply = (annotations: Annotation[], edit: Parameters<typeof applyAnnotationEdit>[1]) =>
    applyAnnotationEdit(annotations, edit, context);

  describe('add', () => {
    it('押した位置に手動注釈を足す（id は発行したもの・前後の空白は落とす）', () => {
      const result = apply([auto], {
        kind: 'add',
        sourcePageIndex: 0,
        x: 100,
        y: 200,
        text: ' si ',
      });

      expect(result).toHaveLength(2);
      expect(result[1]).toEqual({
        id: 'manual-new',
        layer: 'solfa',
        anchor: manualAnchorAt(
          { sourcePageIndex: 0, x: 100, y: 200 },
          'si',
          [PAGE],
          DEFAULT_SETTINGS,
        ),
        noteId: null,
        text: 'si',
        origin: 'manual',
        deleted: false,
      });
    });

    it('空白だけの文字は書き足せない', () => {
      expect(() => apply([], { kind: 'add', sourcePageIndex: 0, x: 1, y: 1, text: '  ' })).toThrow(
        AnnotationEditError,
      );
    });

    it(`${MANUAL_TEXT_MAX_LENGTH} 文字を超える文字は書き足せない（譜面を横切る長文を防ぐ）`, () => {
      const text = 'a'.repeat(MANUAL_TEXT_MAX_LENGTH + 1);
      expect(() => apply([], { kind: 'add', sourcePageIndex: 0, x: 1, y: 1, text })).toThrow(
        AnnotationEditError,
      );
      expect(
        apply([], { kind: 'add', sourcePageIndex: 0, x: 1, y: 1, text: text.slice(1) }),
      ).toHaveLength(1);
    });
  });

  describe('setText', () => {
    it('自動注釈の文字を上書きし、位置と音符の参照は変えない', () => {
      const [edited] = apply([auto], { kind: 'setText', id: auto.id, text: 'fi' });
      expect(edited).toEqual({ ...auto, text: 'fi' });
    });

    it('null で自動の階名に戻す', () => {
      const [edited] = apply([{ ...auto, text: 'fi' }], {
        kind: 'setText',
        id: auto.id,
        text: null,
      });
      expect(edited?.text).toBeNull();
    });

    it('手動注釈は書き換えられるが、自動の階名には戻せない（戻る先が無い）', () => {
      expect(apply([manual], { kind: 'setText', id: manual.id, text: 'ta' })[0]?.text).toBe('ta');
      expect(() => apply([manual], { kind: 'setText', id: manual.id, text: null })).toThrow(
        AnnotationEditError,
      );
    });

    it('存在しない・削除済みの注釈は書き換えられない（古い画面からの操作）', () => {
      expect(() => apply([auto], { kind: 'setText', id: 'nope', text: 'do' })).toThrow(
        AnnotationEditError,
      );
      expect(() =>
        apply([{ ...auto, deleted: true }], { kind: 'setText', id: auto.id, text: 'do' }),
      ).toThrow(AnnotationEditError);
    });
  });

  describe('remove と restore', () => {
    it('自動注釈は非表示の印を付け、restore で外す', () => {
      const removed = apply([auto], { kind: 'remove', id: auto.id });
      expect(removed).toEqual([{ ...auto, deleted: true }]);
      expect(apply(removed, { kind: 'restore', annotation: auto })).toEqual([auto]);
    });

    it('手動注釈は取り除き、restore で削除前の内容をそのまま戻す', () => {
      const removed = apply([auto, manual], { kind: 'remove', id: manual.id });
      expect(removed).toEqual([auto]);
      expect(apply(removed, { kind: 'restore', annotation: manual })).toEqual([auto, manual]);
    });

    it('存在しない注釈は削除できない', () => {
      expect(() => apply([auto], { kind: 'remove', id: 'nope' })).toThrow(AnnotationEditError);
    });

    it('実体の無い自動注釈は restore で持ち込めない（自動注釈は再生成でしか作らない）', () => {
      expect(() => apply([], { kind: 'restore', annotation: auto })).toThrow(AnnotationEditError);
    });
  });

  it('入力の配列を書き換えない', () => {
    const annotations = [auto, manual];
    const before = structuredClone(annotations);
    apply(annotations, { kind: 'remove', id: auto.id });
    apply(annotations, { kind: 'setText', id: manual.id, text: 'ta' });
    expect(annotations).toEqual(before);
  });
});

describe('listSkippedMeasures', () => {
  it('skipped の小節だけを返す', () => {
    const score = scoreWith(
      [note('n1', 500, 400)],
      [{ partId: 'P1', index: 1, status: 'skipped', notes: [] }],
    );

    expect(listSkippedMeasures(score).map((m) => m.index)).toEqual([1]);
  });
});

describe('AnnotationManager（クラス形の入口）', () => {
  it('純関数群へ委譲する', () => {
    const manager = new AnnotationManager();
    const score = scoreWith([note('n1', 500, 400)]);
    const result = manager.regenerate({
      score,
      geometry: emptyGeometry,
      pages: [PAGE],
      settings: DEFAULT_SETTINGS,
      existing: [],
    });

    expect(result.annotations).toHaveLength(1);
    expect(manager.add({ pageIndex: 0, x: 0, y: 0 }, 'do', 'm').origin).toBe('manual');
    expect(
      manager.update(result.annotations, result.annotations[0]!.id, { text: 'x' })[0]?.text,
    ).toBe('x');
    expect(manager.remove(result.annotations, result.annotations[0]!.id)[0]?.deleted).toBe(true);
    expect(manager.listSkippedMeasures(score)).toEqual([]);
  });
});
