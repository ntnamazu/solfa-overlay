import { describe, expect, it } from 'vitest';
import {
  buildConfirmationItems,
  mergeCorrections,
} from '../../../../src/domain/score/confirmationItems';
import type { OmrHead, OmrStaff, OmrSystem } from '../../../../src/domain/score/OmrSheetParser';
import type { BuildIssue, OmrArtifacts } from '../../../../src/domain/score/ScoreModelBuilder';
import type { StaffRef } from '../../../../src/shared/types/ScoreModel';

const head = (x: number, y = 300): OmrHead => ({ pitch: 0, x, y, w: 20, h: 16 });

const staff = (
  partId: string,
  clefKind: string | null,
  heads: OmrHead[] = [head(100)],
): OmrStaff => ({ partId, staffId: `s-${partId}`, clefKind, heads });

const system = (staves: OmrStaff[]): OmrSystem => ({ stacks: [{ left: 0, right: 200 }], staves });

/** ページ→段→譜表の三重配列から OmrArtifacts を組む（MusicXML は本モジュールでは未使用） */
const artifactsOf = (pages: OmrStaff[][][]): OmrArtifacts => ({
  movements: [],
  pages: pages.map((systems) => ({ systems: systems.map(system) })),
});

const mismatch = (partId: string, ref: StaffRef): BuildIssue => ({
  kind: 'pitchCrossCheckMismatch',
  noteId: `${partId}:n0`,
  partId,
  measureIndex: 0,
  staffRef: ref,
  expectedStep: 'C',
  omrStep: 'B',
});

const ref = (
  pageIndex: number,
  systemIndex: number,
  staffIndex: number,
  partId: string,
): StaffRef => ({ pageIndex, systemIndex, staffIndex, partId });

describe('buildConfirmationItems', () => {
  describe('グルーピング', () => {
    it('同一パート・同一 clef の複数譜表を 1 グループに畳む', () => {
      // 3 ページ × 1 段 × 1 譜表 = 3 譜表だが、確認画面に出るのは 1 行
      const artifacts = artifactsOf([
        [[staff('P1', 'TREBLE')]],
        [[staff('P1', 'TREBLE')]],
        [[staff('P1', 'TREBLE')]],
      ]);
      const items = buildConfirmationItems(artifacts, []);

      expect(items).toHaveLength(1);
      expect(items[0]?.id).toBe('clef-P1-TREBLE');
      expect(items[0]?.staffRefs).toHaveLength(3);
      expect(items[0]?.staffRefs.map((r) => r.pageIndex)).toEqual([0, 1, 2]);
    });

    it('同一パートでも検出された clef が違えば別グループになる', () => {
      // divisi の P6（ALTO 35 段 / TREBLE 8 段）と同じ形。誤検出側だけを訂正できる必要がある
      const artifacts = artifactsOf([[[staff('P6', 'ALTO')], [staff('P6', 'TREBLE')]]]);
      const items = buildConfirmationItems(artifacts, []);

      expect(items.map((item) => item.id)).toEqual(['clef-P6-ALTO', 'clef-P6-TREBLE']);
    });

    it('clef を検出できなかった譜表を UNKNOWN グループとして出す', () => {
      // 一覧から漏らすと「確認したのに直せない譜表」が残るため必ず行になる
      const artifacts = artifactsOf([[[staff('P1', null), staff('P2', 'BASS')]]]);
      const items = buildConfirmationItems(artifacts, []);

      expect(items.map((item) => item.detected)).toEqual(['UNKNOWN', 'BASS']);
      expect(items[0]?.id).toBe('clef-P1-UNKNOWN');
    });

    it('パートが違えば同じ clef でも別グループになる', () => {
      const artifacts = artifactsOf([[[staff('P1', 'TREBLE'), staff('P2', 'TREBLE')]]]);
      expect(buildConfirmationItems(artifacts, [])).toHaveLength(2);
    });
  });

  describe('並び順（楽譜順に固定する）', () => {
    const artifacts = artifactsOf([
      [[staff('P1', 'TREBLE'), staff('P2', 'ALTO'), staff('P3', 'BASS')]],
    ]);

    it('partId 昇順（楽譜の上から下）に並ぶ', () => {
      const items = buildConfirmationItems(artifacts, []);
      expect(items.map((item) => item.partId)).toEqual(['P1', 'P2', 'P3']);
    });

    it('不一致件数は並び順に影響しない（並びの意味が曲によって変わらないように）', () => {
      const issues = [
        mismatch('P2', ref(0, 0, 1, 'P2')),
        mismatch('P2', ref(0, 0, 1, 'P2')),
        mismatch('P3', ref(0, 0, 2, 'P3')),
      ];
      const items = buildConfirmationItems(artifacts, issues);

      expect(items.map((item) => [item.partId, item.mismatchCount])).toEqual([
        ['P1', 0],
        ['P2', 2],
        ['P3', 1],
      ]);
    });

    it('パートが 10 以上でも自然順に並ぶ（localeCompare だと P10 < P2 になる）', () => {
      const manyParts = artifactsOf([
        [[staff('P10', 'BASS'), staff('P2', 'ALTO'), staff('P1', 'TREBLE')]],
      ]);
      expect(buildConfirmationItems(manyParts, []).map((item) => item.partId)).toEqual([
        'P1',
        'P2',
        'P10',
      ]);
    });

    it('番号を持たない partId でも決定的に並ぶ（辞書順へのフォールバック）', () => {
      const named = artifactsOf([[[staff('Tenor', 'TREBLE'), staff('Alto', 'ALTO')]]]);
      expect(buildConfirmationItems(named, []).map((item) => item.partId)).toEqual([
        'Alto',
        'Tenor',
      ]);
    });

    it('入力の並び順を変えても結果が変わらない（再解析で行が入れ替わらない）', () => {
      const reversed = artifactsOf([
        [[staff('P3', 'BASS'), staff('P2', 'ALTO'), staff('P1', 'TREBLE')]],
      ]);
      expect(buildConfirmationItems(reversed, []).map((item) => item.id)).toEqual(
        buildConfirmationItems(artifacts, []).map((item) => item.id),
      );
    });

    it('同一パート内で clef が違うグループは検出値の昇順で並ぶ', () => {
      const sameParts = artifactsOf([[[staff('P1', 'TREBLE'), staff('P1', 'ALTO')]]]);
      expect(buildConfirmationItems(sameParts, []).map((item) => item.detected)).toEqual([
        'ALTO',
        'TREBLE',
      ]);
    });
  });

  describe('不一致件数の帰属', () => {
    it('同一パートでも不一致は発生した譜表のグループにだけ加算される', () => {
      // partId だけでは P6 の ALTO 35 段と TREBLE 8 段を区別できない。
      // BuildIssue が staffRef を持つのはこの帰属のため
      const artifacts = artifactsOf([[[staff('P6', 'ALTO')], [staff('P6', 'TREBLE')]]]);
      const items = buildConfirmationItems(artifacts, [mismatch('P6', ref(0, 0, 0, 'P6'))]);

      expect(items.map((item) => [item.detected, item.mismatchCount])).toEqual([
        ['ALTO', 1],
        ['TREBLE', 0],
      ]);
    });

    it('クロスチェック以外の issue は件数に数えない', () => {
      const artifacts = artifactsOf([[[staff('P1', 'TREBLE')]]]);
      const issues: BuildIssue[] = [
        {
          kind: 'measureCountMismatch',
          partId: 'P1',
          measureIndex: 0,
          pageIndex: 0,
          systemIndex: 0,
          omrCount: 1,
          xmlCount: 2,
        },
      ];
      expect(buildConfirmationItems(artifacts, issues)[0]?.mismatchCount).toBe(0);
    });

    it('存在しない譜表を指す不一致は無視する（部分失敗を全体失敗にしない）', () => {
      const artifacts = artifactsOf([[[staff('P1', 'TREBLE')]]]);
      const items = buildConfirmationItems(artifacts, [mismatch('P1', ref(9, 9, 9, 'P1'))]);
      expect(items[0]?.mismatchCount).toBe(0);
    });
  });

  describe('clipRect の近似', () => {
    it('最初の符頭より左に、符頭幅を単位とした矩形を置く', () => {
      const artifacts = artifactsOf([[[staff('P1', 'TREBLE', [head(100, 300), head(140, 320)])]]]);
      const clipRect = buildConfirmationItems(artifacts, [])[0]?.clipRect;

      // 符頭幅 20 × 4 = 80 を左へ確保し、縦は符頭の上端〜下端を覆う
      expect(clipRect).toEqual({ pageIndex: 0, x: 20, y: 300, width: 80, height: 36 });
    });

    it('ページ左端をはみ出さない', () => {
      const artifacts = artifactsOf([[[staff('P1', 'TREBLE', [head(10)])]]]);
      expect(buildConfirmationItems(artifacts, [])[0]?.clipRect.x).toBe(0);
    });

    it('符頭のない譜表でも破綻しない（休符のみの段）', () => {
      const artifacts = artifactsOf([[[staff('P1', 'TREBLE', [])]]]);
      expect(buildConfirmationItems(artifacts, [])[0]?.clipRect).toEqual({
        pageIndex: 0,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
    });

    it('代表は最初に現れた譜表になる（走査順が決定的であることの帰結）', () => {
      const artifacts = artifactsOf([
        [[staff('P1', 'TREBLE', [head(100)])]],
        [[staff('P1', 'TREBLE', [head(500)])]],
      ]);
      expect(buildConfirmationItems(artifacts, [])[0]?.clipRect.x).toBe(20);
    });
  });

  it('生成直後の corrected は null（検出値をそのまま採用する）', () => {
    const artifacts = artifactsOf([[[staff('P1', 'TREBLE')]]]);
    expect(buildConfirmationItems(artifacts, [])[0]?.corrected).toBeNull();
  });
});

describe('mergeCorrections', () => {
  const artifacts = artifactsOf([[[staff('P1', 'TREBLE'), staff('P2', 'ALTO')]]]);

  it('再生成した確認項目へ既存の修正値を id で引き継ぐ', () => {
    const previous = buildConfirmationItems(artifacts, []).map((item) =>
      item.id === 'clef-P2-ALTO' ? { ...item, corrected: 'TREBLE' } : item,
    );
    const merged = mergeCorrections(buildConfirmationItems(artifacts, []), previous);

    expect(merged.find((item) => item.id === 'clef-P2-ALTO')?.corrected).toBe('TREBLE');
    expect(merged.find((item) => item.id === 'clef-P1-TREBLE')?.corrected).toBeNull();
  });

  it('対応する項目が消えた修正値は落ちる（構造の訂正で譜表構成が変わった場合）', () => {
    const previous = [
      {
        id: 'clef-P9-BASS',
        kind: 'clef' as const,
        partId: 'P9',
        detected: 'BASS',
        corrected: 'TREBLE',
        staffRefs: [],
        clipRect: { pageIndex: 0, x: 0, y: 0, width: 0, height: 0 },
        mismatchCount: 0,
      },
    ];
    const merged = mergeCorrections(buildConfirmationItems(artifacts, []), previous);
    expect(merged.every((item) => item.corrected === null)).toBe(true);
  });
});

describe('訂正しても並び順が動かない', () => {
  const artifacts = artifactsOf([
    [[staff('P6', 'ALTO'), staff('P4', 'ALTO'), staff('P7', 'TREBLE')]],
  ]);
  /** P6 に 3 件・P4 に 2 件・P7 に 1 件の不一致を作る */
  const issues: BuildIssue[] = [
    mismatch('P6', ref(0, 0, 0, 'P6')),
    mismatch('P6', ref(0, 0, 0, 'P6')),
    mismatch('P6', ref(0, 0, 0, 'P6')),
    mismatch('P4', ref(0, 0, 1, 'P4')),
    mismatch('P4', ref(0, 0, 1, 'P4')),
    mismatch('P7', ref(0, 0, 2, 'P7')),
  ];

  it('訂正して不一致が消えたグループも、同じ位置に留まる', () => {
    const initial = buildConfirmationItems(artifacts, issues);
    expect(initial.map((item) => item.partId)).toEqual(['P4', 'P6', 'P7']);

    // P6 を訂正した結果、その譜表の不一致が解消された状態を再現する
    const corrected = initial.map((item) =>
      item.partId === 'P6' ? { ...item, corrected: 'TREBLE' } : item,
    );
    const rebuilt = buildConfirmationItems(
      artifacts,
      issues.filter((issue) => issue.partId !== 'P6'),
    );
    // 楽譜順に固定したため、不一致が 0 になっても素の生成順が変わらない
    expect(rebuilt.map((item) => item.partId)).toEqual(['P4', 'P6', 'P7']);

    const merged = mergeCorrections(rebuilt, corrected);
    expect(merged.map((item) => item.partId)).toEqual(['P4', 'P6', 'P7']);
    expect(merged[1]?.corrected).toBe('TREBLE');
    expect(merged[1]?.mismatchCount).toBe(0);
  });

  it('前回の並びに引きずられない（初回に不一致があったかで並びが変わらない）', () => {
    // 前回が「不一致件数の降順」で並んでいた頃の状態を渡しても、結果は楽譜順になる
    const previous = [...buildConfirmationItems(artifacts, issues)].reverse();
    const merged = mergeCorrections(buildConfirmationItems(artifacts, issues), previous);
    expect(merged.map((item) => item.partId)).toEqual(['P4', 'P6', 'P7']);
  });

  it('前回が空でも並びは同じ（初回と 2 回目で並びの意味が変わらない）', () => {
    const merged = mergeCorrections(buildConfirmationItems(artifacts, issues), []);
    expect(merged.map((item) => item.partId)).toEqual(['P4', 'P6', 'P7']);
  });
});
