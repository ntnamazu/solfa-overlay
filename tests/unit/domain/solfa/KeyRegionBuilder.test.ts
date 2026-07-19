import { describe, expect, it } from 'vitest';

import type { MusicXmlKey, MusicXmlPart, ParsedMusicXml } from '../../../../src/domain/score/MusicXmlParser';
import type { OmrArtifacts } from '../../../../src/domain/score/ScoreModelBuilder';
import { KeyRegionBuilder } from '../../../../src/domain/solfa/KeyRegionBuilder';
import type { ResolvedStructure } from '../../../../src/shared/types/ResolvedStructure';

/** 小節ごとの調号宣言（null は宣言なし＝前の調号が持続） */
type KeySpec = (MusicXmlKey | null)[];

function part(id: string, keys: KeySpec): MusicXmlPart {
  return {
    id,
    name: id,
    measures: keys.map((key, index) => ({ index, key, notes: [] })),
  };
}

function musicXml(parts: MusicXmlPart[]): ParsedMusicXml {
  const measureCount = parts.reduce((max, p) => Math.max(max, p.measures.length), 0);
  return {
    parts,
    layout: [{ pageIndex: 0, systemIndex: 0, firstMeasureIndex: 0, measureCount }],
  };
}

function artifactsOf(movements: ParsedMusicXml[]): OmrArtifacts {
  return { movements: movements.map((m) => ({ musicXml: m })), pages: [] };
}

/** movement ごとに「先頭小節番号と小節数」だけを持つ最小の確定構造を組む */
function structureOf(specs: { first: number; count: number }[]): ResolvedStructure {
  return {
    movements: specs.map((spec, musicXmlIndex) => ({
      musicXmlIndex,
      pageIndices: [musicXmlIndex],
      systems: [
        {
          pageIndex: musicXmlIndex,
          systemIndex: 0,
          firstMeasureIndex: spec.first,
          measureCount: spec.count,
        },
      ],
    })),
  };
}

const K = (fifths: number, mode: MusicXmlKey['mode'] = null): MusicXmlKey => ({ fifths, mode });

function build(parts: MusicXmlPart[], count?: number) {
  const xml = musicXml(parts);
  const measures = count ?? parts.reduce((max, p) => Math.max(max, p.measures.length), 0);
  return new KeyRegionBuilder().build(artifactsOf([xml]), structureOf([{ first: 0, count: measures }]));
}

describe('KeyRegionBuilder: 曲頭 KeyRegion の保証', () => {
  it('曲頭に宣言がなければハ長調の既定を先頭に置く（KeyRegion の制約）', () => {
    const { keyRegions } = build([part('P1', [null, null, null])]);

    expect(keyRegions).toHaveLength(1);
    expect(keyRegions[0]).toEqual({
      id: 'key-0',
      start: { measureIndex: 0, offset: 0 },
      tonicStep: 'C',
      tonicAlter: 0,
      mode: 'major',
      source: 'auto',
    });
  });

  it('曲頭より後の宣言があっても、曲頭は既定のまま保たれる', () => {
    const { keyRegions } = build([part('P1', [null, null, K(1)])]);

    expect(keyRegions.map((r) => [r.start.measureIndex, r.tonicStep, r.tonicAlter])).toEqual([
      [0, 'C', 0],
      [2, 'G', 0],
    ]);
  });

  it('最初の宣言が既定と同じ調なら区間を分けず先頭へ寄せる', () => {
    // 曲頭に宣言がなく m2 でハ長調が宣言される＝転調していない。
    // 既定を素直に前置きすると同じ調の KeyRegion が 2 つ並び、転調点 UI が
    // 存在しない転調点を描いてしまう（調号なしの楽譜で必ず起きる）
    const { keyRegions } = build([part('P1', [null, null, K(0), null])]);

    expect(keyRegions).toHaveLength(1);
    expect(keyRegions[0]?.id).toBe('key-0');
    expect(keyRegions[0]?.start).toEqual({ measureIndex: 0, offset: 0 });
    expect(keyRegions[0]?.tonicStep).toBe('C');
  });

  it('最初の宣言が既定と違う調なら既定を前置きする', () => {
    const { keyRegions } = build([part('P1', [null, null, K(2), null])]);

    expect(keyRegions.map((r) => [r.id, r.start.measureIndex, r.tonicStep])).toEqual([
      ['key-0', 0, 'C'],
      ['key-2', 2, 'D'],
    ]);
  });

  it('最初の宣言が fifths は既定と同じでも旋法が違えば前置きする', () => {
    const { keyRegions } = build([part('P1', [null, K(0, 'minor'), null])]);

    expect(keyRegions.map((r) => [r.start.measureIndex, r.tonicStep, r.mode])).toEqual([
      [0, 'C', 'major'],
      [1, 'A', 'minor'],
    ]);
  });

  it('曲頭に宣言があれば既定で上書きされない', () => {
    const { keyRegions } = build([part('P1', [K(-3), null, null])]);

    expect(keyRegions).toHaveLength(1);
    expect(keyRegions[0]?.tonicStep).toBe('E');
    expect(keyRegions[0]?.tonicAlter).toBe(-1);
    expect(keyRegions[0]?.start.measureIndex).toBe(0);
  });
});

describe('KeyRegionBuilder: 調号の持続と変化', () => {
  it('同じ調が続く小節では KeyRegion を増やさない', () => {
    const { keyRegions } = build([part('P1', [K(2), K(2), K(2), K(2)])]);

    expect(keyRegions).toHaveLength(1);
    expect(keyRegions[0]?.start.measureIndex).toBe(0);
  });

  it('調号が変化した小節だけ KeyRegion を作る', () => {
    const { keyRegions } = build([part('P1', [K(0), null, K(1), null, K(-1)])]);

    expect(keyRegions.map((r) => r.start.measureIndex)).toEqual([0, 2, 4]);
    expect(keyRegions.map((r) => r.tonicStep)).toEqual(['C', 'G', 'F']);
  });

  it('宣言のないパートは直前の調号を持ち続ける（多数決の母数から外れない）', () => {
    // P2 は m2 でしか宣言しない。m1 では P1 の宣言のみが有効
    const { keyRegions, issues } = build([
      part('P1', [K(0), K(1), null]),
      part('P2', [K(0), null, K(1)]),
    ]);

    // m1 は P1=1 / P2=0 で食い違い、同数のため小さい 0 が採用され KeyRegion は増えない。
    // m2 で P2 も 1 になり全パート一致 → ここで初めて変化点になる
    expect(keyRegions.map((r) => r.start.measureIndex)).toEqual([0, 2]);
    // m2 では P2 も 1 になり全パート一致するため、食い違いは m1 の 1 件だけ
    expect(issues.filter((i) => i.kind === 'keySignatureConflict').map((i) => i.measureIndex)).toEqual([
      1,
    ]);
  });

  it('id は通し小節番号から決まる（回帰スナップショットが安定する）', () => {
    const { keyRegions } = build([part('P1', [K(0), null, K(3)])]);

    expect(keyRegions.map((r) => r.id)).toEqual(['key-0', 'key-2']);
  });
});

describe('KeyRegionBuilder: パート間の食い違い（多数決）', () => {
  it('7:1 では多数側が採用される（divisi m114 相当）', () => {
    const parts = [
      ...Array.from({ length: 7 }, (_, i) => part(`P${i + 1}`, [K(1), K(0)])),
      part('P8', [K(1), null]),
    ];
    const { keyRegions, issues } = build(parts);

    expect(keyRegions.map((r) => [r.start.measureIndex, r.tonicStep])).toEqual([
      [0, 'G'],
      [1, 'C'],
    ]);
    const conflict = issues.find((i) => i.kind === 'keySignatureConflict');
    expect(conflict).toBeDefined();
    expect(conflict?.kind === 'keySignatureConflict' ? conflict.adopted : null).toBe(0);
  });

  it('同数なら小さい fifths を採用し、食い違いを報告する（divisi m182 相当）', () => {
    const { keyRegions, issues } = build([part('P1', [K(0), K(0)]), part('P2', [K(0), K(-1)])]);

    // m1 は 0 と -1 が 1:1。決定的にするため小さい -1 が採用される
    expect(keyRegions.map((r) => [r.start.measureIndex, r.tonicStep])).toEqual([
      [0, 'C'],
      [1, 'F'],
    ]);
    const conflict = issues.find((i) => i.kind === 'keySignatureConflict');
    expect(conflict).toEqual({
      kind: 'keySignatureConflict',
      measureIndex: 1,
      fifthsByPart: { P1: 0, P2: -1 },
      adopted: -1,
    });
  });

  it('食い違いは宣言のあった小節でだけ報告する（持続で数百件に膨らませない）', () => {
    const { issues } = build([
      part('P1', [K(0), K(1), null, null, null]),
      part('P2', [K(0), null, null, null, null]),
    ]);

    expect(issues.filter((i) => i.kind === 'keySignatureConflict')).toHaveLength(1);
    expect(issues[0]?.measureIndex).toBe(1);
  });

  it('全パートが一致していれば食い違いを報告しない', () => {
    const { issues } = build([part('P1', [K(0), K(2)]), part('P2', [K(0), K(2)])]);

    expect(issues).toEqual([]);
  });
});

describe('KeyRegionBuilder: 異常な調号', () => {
  it('五度圏の範囲外は報告し、直前の調号を維持する', () => {
    const { keyRegions, issues } = build([part('P1', [K(0), K(12), K(0)])]);

    expect(keyRegions).toHaveLength(1);
    expect(issues).toEqual([
      { kind: 'unsupportedKeySignature', measureIndex: 1, partId: 'P1', fifths: 12 },
    ]);
  });

  it('曲頭が範囲外でも既定のハ長調が入り、制約が保たれる', () => {
    const { keyRegions, issues } = build([part('P1', [K(-9), null])]);

    expect(keyRegions).toHaveLength(1);
    expect(keyRegions[0]?.start.measureIndex).toBe(0);
    expect(keyRegions[0]?.tonicStep).toBe('C');
    expect(issues[0]?.kind).toBe('unsupportedKeySignature');
  });
});

describe('KeyRegionBuilder: mode の扱い', () => {
  it('mode が未指定なら長調として扱う（Audiveris は <mode> を出力しない）', () => {
    const { keyRegions } = build([part('P1', [K(0)])]);

    expect(keyRegions[0]?.mode).toBe('major');
    expect(keyRegions[0]?.tonicStep).toBe('C');
  });

  it('mode が minor なら尊重し、平行短調の主音を採る', () => {
    const { keyRegions } = build([part('P1', [K(0, 'minor')])]);

    expect(keyRegions[0]?.mode).toBe('minor');
    expect(keyRegions[0]?.tonicStep).toBe('A');
    expect(keyRegions[0]?.tonicAlter).toBe(0);
  });

  it('同じ fifths で長短が同数なら長調を採る（決定性の確保）', () => {
    const { keyRegions, issues } = build([
      part('P1', [K(0), K(2, 'major')]),
      part('P2', [K(0), K(2, 'minor')]),
    ]);

    expect(keyRegions.map((r) => [r.start.measureIndex, r.tonicStep, r.mode])).toEqual([
      [0, 'C', 'major'],
      [1, 'D', 'major'],
    ]);
    // fifths は両パートとも 2 で一致しているため、食い違いとしては報告しない
    expect(issues).toEqual([]);
  });

  it('fifths が同じでも mode が変われば新しい KeyRegion になる', () => {
    const { keyRegions } = build([part('P1', [K(0, 'major'), K(0, 'minor')])]);

    expect(keyRegions.map((r) => [r.start.measureIndex, r.mode])).toEqual([
      [0, 'major'],
      [1, 'minor'],
    ]);
  });
});

describe('KeyRegionBuilder: 複数 movement', () => {
  it('movement をまたいで通し小節番号になる', () => {
    const first = musicXml([part('P1', [K(0), null, null])]);
    const second = musicXml([part('P1', [null, K(1), null])]);
    const structure = structureOf([
      { first: 0, count: 3 },
      { first: 3, count: 3 },
    ]);

    const { keyRegions } = new KeyRegionBuilder().build(artifactsOf([first, second]), structure);

    expect(keyRegions.map((r) => r.start.measureIndex)).toEqual([0, 4]);
  });

  it('前の movement の調号は次の movement へ持続する', () => {
    const first = musicXml([part('P1', [K(1), null])]);
    const second = musicXml([part('P1', [null, K(1)])]);
    const structure = structureOf([
      { first: 0, count: 2 },
      { first: 2, count: 2 },
    ]);

    const { keyRegions } = new KeyRegionBuilder().build(artifactsOf([first, second]), structure);

    // 2 つ目の movement の K(1) は前と同じ調のため KeyRegion を増やさない
    expect(keyRegions.map((r) => r.start.measureIndex)).toEqual([0]);
  });

  it('movement の並び順が曲順でなければ契約違反として例外にする', () => {
    // ResolvedStructure.movements は曲順が契約。ここで並べ替えて救うと、
    // ScoreModelBuilder が例外にする構造を KeyRegionBuilder だけが受理してしまう
    const first = musicXml([part('P1', [K(1), null])]);
    const second = musicXml([part('P1', [K(-1), null])]);
    const structure: ResolvedStructure = {
      movements: [
        {
          musicXmlIndex: 0,
          pageIndices: [1],
          systems: [{ pageIndex: 1, systemIndex: 0, firstMeasureIndex: 2, measureCount: 2 }],
        },
        {
          musicXmlIndex: 1,
          pageIndices: [0],
          systems: [{ pageIndex: 0, systemIndex: 0, firstMeasureIndex: 0, measureCount: 2 }],
        },
      ],
    };

    expect(() => new KeyRegionBuilder().build(artifactsOf([first, second]), structure)).toThrow(
      'movement 間で通し小節番号が重複',
    );
  });

  it('確定構造が割り当てた小節数を超える MusicXML の小節は無視する', () => {
    // XML は 5 小節あるが構造は 2 小節しか割り当てていない。m3 の調号変化は次の movement の
    // 小節番号を追い越すため採用しない
    const only = musicXml([part('P1', [K(0), null, null, K(4), null])]);
    const structure = structureOf([{ first: 0, count: 2 }]);

    const { keyRegions } = new KeyRegionBuilder().build(artifactsOf([only]), structure);

    expect(keyRegions.map((r) => r.start.measureIndex)).toEqual([0]);
  });

  it('段を持たない movement は読み飛ばす', () => {
    const only = musicXml([part('P1', [K(3)])]);
    const structure: ResolvedStructure = {
      movements: [{ musicXmlIndex: 0, pageIndices: [], systems: [] }],
    };

    const { keyRegions } = new KeyRegionBuilder().build(artifactsOf([only]), structure);

    expect(keyRegions).toHaveLength(1);
    expect(keyRegions[0]?.tonicStep).toBe('C');
  });

  it('確定構造が指す MusicXML がなければ契約違反として例外にする', () => {
    // ScoreModelBuilder.build() と同じ条件・同じ分類。片方だけが黙って読み飛ばすと
    // 壊れた ResolvedStructure が「正常」として通ってしまう
    const structure = structureOf([{ first: 0, count: 2 }]);

    expect(() => new KeyRegionBuilder().build(artifactsOf([]), structure)).toThrow(
      'ResolvedStructure が指す MusicXML がありません',
    );
  });

  it('movement の小節範囲が重複していれば契約違反として例外にする', () => {
    const first = musicXml([part('P1', [K(0), null])]);
    const second = musicXml([part('P1', [K(1), null])]);
    // 1 つ目が m0〜m2 を占めるのに 2 つ目が m1 から始まっている
    const structure = structureOf([
      { first: 0, count: 3 },
      { first: 1, count: 2 },
    ]);

    expect(() => new KeyRegionBuilder().build(artifactsOf([first, second]), structure)).toThrow(
      'movement 間で通し小節番号が重複',
    );
  });

  it('新しい movement で一部パートだけが再宣言しても、他パートの持続値が母数に残る', () => {
    // movement 1 では 2 パートとも fifths=0。movement 2 で P1 だけが fifths=-1 を宣言する。
    // P2 は宣言していないが movement 1 の 0 を持ち続けるため 1:1 の食い違いになる
    const first = musicXml([part('P1', [K(0)]), part('P2', [K(0)])]);
    const second = musicXml([part('P1', [K(-1), null]), part('P2', [null, null])]);
    const structure = structureOf([
      { first: 0, count: 1 },
      { first: 1, count: 2 },
    ]);

    const { keyRegions, issues } = new KeyRegionBuilder().build(
      artifactsOf([first, second]),
      structure,
    );

    // 同数のため小さい -1 が採用され、食い違いが報告される（母数から抜け落ちない）
    expect(keyRegions.map((r) => [r.start.measureIndex, r.tonicStep])).toEqual([
      [0, 'C'],
      [1, 'F'],
    ]);
    expect(issues).toEqual([
      {
        kind: 'keySignatureConflict',
        measureIndex: 1,
        fifthsByPart: { P1: -1, P2: 0 },
        adopted: -1,
      },
    ]);
  });
});
