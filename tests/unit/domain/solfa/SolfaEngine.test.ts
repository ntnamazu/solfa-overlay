import { describe, expect, it } from 'vitest';
import {
  SolfaEngine,
  applyDegrees,
  computeDegree,
  expectedAlterInDoMajor,
  letterDistance,
  resolveDo,
} from '../../../../src/domain/solfa/SolfaEngine';
import { DEFAULT_SETTINGS } from '../../../../src/shared/constants/DEFAULT_SETTINGS';
import type { KeyRegion } from '../../../../src/shared/types/KeyRegion';
import type { Pitch, PitchStep } from '../../../../src/shared/types/Pitch';
import type { Measure, NoteEvent, ScoreModel } from '../../../../src/shared/types/ScoreModel';

function keyRegion(partial: {
  tonicStep: PitchStep;
  tonicAlter?: number;
  mode: 'major' | 'minor';
}): KeyRegion {
  return {
    id: 'test-region',
    start: { measureIndex: 0, offset: 0 },
    tonicStep: partial.tonicStep,
    tonicAlter: partial.tonicAlter ?? 0,
    mode: partial.mode,
    source: 'auto',
  };
}

function pitch(step: PitchStep, alter: number, octave = 4): Pitch {
  return { step, alter, octave };
}

const SHARP_ORDER: readonly PitchStep[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER: readonly PitchStep[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** 長調の主音 → 調号（♯なら正・♭なら負の個数） */
const MAJOR_KEY_SIGNATURES: readonly {
  name: string;
  doStep: PitchStep;
  doAlter: number;
  signature: number;
}[] = [
  { name: 'ハ長調 (C)', doStep: 'C', doAlter: 0, signature: 0 },
  { name: 'ト長調 (G)', doStep: 'G', doAlter: 0, signature: 1 },
  { name: 'ニ長調 (D)', doStep: 'D', doAlter: 0, signature: 2 },
  { name: 'イ長調 (A)', doStep: 'A', doAlter: 0, signature: 3 },
  { name: 'ホ長調 (E)', doStep: 'E', doAlter: 0, signature: 4 },
  { name: 'ロ長調 (B)', doStep: 'B', doAlter: 0, signature: 5 },
  { name: '嬰ヘ長調 (F♯)', doStep: 'F', doAlter: 1, signature: 6 },
  { name: '嬰ハ長調 (C♯)', doStep: 'C', doAlter: 1, signature: 7 },
  { name: 'ヘ長調 (F)', doStep: 'F', doAlter: 0, signature: -1 },
  { name: '変ロ長調 (B♭)', doStep: 'B', doAlter: -1, signature: -2 },
  { name: '変ホ長調 (E♭)', doStep: 'E', doAlter: -1, signature: -3 },
  { name: '変イ長調 (A♭)', doStep: 'A', doAlter: -1, signature: -4 },
  { name: '変ニ長調 (D♭)', doStep: 'D', doAlter: -1, signature: -5 },
  { name: '変ト長調 (G♭)', doStep: 'G', doAlter: -1, signature: -6 },
  { name: '変ハ長調 (C♭)', doStep: 'C', doAlter: -1, signature: -7 },
];

/** 調号（♯♭の個数）から各幹音の変位を引く */
function signatureAlterOf(letter: PitchStep, signature: number): number {
  if (signature > 0) {
    return SHARP_ORDER.slice(0, signature).includes(letter) ? 1 : 0;
  }
  return FLAT_ORDER.slice(0, -signature).includes(letter) ? -1 : 0;
}

describe('SolfaEngine', () => {
  describe('expectedAlterInDoMajor', () => {
    // 機能設計書の検算規定: 結果は do を主音とする長調の調号と必ず一致する
    it.each(MAJOR_KEY_SIGNATURES)(
      '$name の期待変位が調号と一致する',
      ({ doStep, doAlter, signature }) => {
        const doPitch = { step: doStep, alter: doAlter };
        for (const letter of SHARP_ORDER) {
          const degree = letterDistance(doStep, letter);
          expect(expectedAlterInDoMajor(doPitch, degree)).toBe(signatureAlterOf(letter, signature));
        }
      },
    );
  });

  describe('resolveDo', () => {
    it('長調では主音がそのまま do になる', () => {
      expect(resolveDo(keyRegion({ tonicStep: 'E', tonicAlter: -1, mode: 'major' }), 'la')).toEqual(
        { step: 'E', alter: -1 },
      );
    });

    it('Do基準短調では主音がそのまま do になる', () => {
      expect(resolveDo(keyRegion({ tonicStep: 'A', mode: 'minor' }), 'do')).toEqual({
        step: 'A',
        alter: 0,
      });
    });

    // La基準短調の do = 平行長調の主音（同じ調号を持つ長調）
    it.each<{
      name: string;
      tonicStep: PitchStep;
      tonicAlter: number;
      doStep: PitchStep;
      doAlter: number;
    }>([
      { name: 'イ短調 → C', tonicStep: 'A', tonicAlter: 0, doStep: 'C', doAlter: 0 },
      { name: 'ホ短調 → G', tonicStep: 'E', tonicAlter: 0, doStep: 'G', doAlter: 0 },
      { name: 'ロ短調 → D', tonicStep: 'B', tonicAlter: 0, doStep: 'D', doAlter: 0 },
      { name: '嬰ヘ短調 → A', tonicStep: 'F', tonicAlter: 1, doStep: 'A', doAlter: 0 },
      { name: '嬰ハ短調 → E', tonicStep: 'C', tonicAlter: 1, doStep: 'E', doAlter: 0 },
      { name: '嬰ト短調 → B', tonicStep: 'G', tonicAlter: 1, doStep: 'B', doAlter: 0 },
      { name: '嬰ニ短調 → F♯', tonicStep: 'D', tonicAlter: 1, doStep: 'F', doAlter: 1 },
      { name: '嬰イ短調 → C♯', tonicStep: 'A', tonicAlter: 1, doStep: 'C', doAlter: 1 },
      { name: 'ニ短調 → F', tonicStep: 'D', tonicAlter: 0, doStep: 'F', doAlter: 0 },
      { name: 'ト短調 → B♭', tonicStep: 'G', tonicAlter: 0, doStep: 'B', doAlter: -1 },
      { name: 'ハ短調 → E♭', tonicStep: 'C', tonicAlter: 0, doStep: 'E', doAlter: -1 },
      { name: 'ヘ短調 → A♭', tonicStep: 'F', tonicAlter: 0, doStep: 'A', doAlter: -1 },
      { name: '変ロ短調 → D♭', tonicStep: 'B', tonicAlter: -1, doStep: 'D', doAlter: -1 },
      { name: '変ホ短調 → G♭', tonicStep: 'E', tonicAlter: -1, doStep: 'G', doAlter: -1 },
      { name: '変イ短調 → C♭', tonicStep: 'A', tonicAlter: -1, doStep: 'C', doAlter: -1 },
    ])('La基準短調: $name', ({ tonicStep, tonicAlter, doStep, doAlter }) => {
      expect(resolveDo(keyRegion({ tonicStep, tonicAlter, mode: 'minor' }), 'la')).toEqual({
        step: doStep,
        alter: doAlter,
      });
    });
  });

  describe('computeDegree', () => {
    it('ト長調のF♮を度数7・変位-1として計算する', () => {
      const region = keyRegion({ tonicStep: 'G', mode: 'major' });
      expect(computeDegree(pitch('F', 0), region, 'la')).toEqual({ degree: 7, alteration: -1 });
    });

    it('イ短調La基準では do が C になる', () => {
      const region = keyRegion({ tonicStep: 'A', mode: 'minor' });
      expect(computeDegree(pitch('C', 0), region, 'la')).toEqual({ degree: 1, alteration: 0 });
    });

    it('ニ長調のC♮を度数7・変位-1として計算する', () => {
      const region = keyRegion({ tonicStep: 'D', mode: 'major' });
      expect(computeDegree(pitch('C', 0), region, 'la')).toEqual({ degree: 7, alteration: -1 });
    });

    it('変ホ長調のB♮を度数5・変位+1として計算する', () => {
      const region = keyRegion({ tonicStep: 'E', tonicAlter: -1, mode: 'major' });
      expect(computeDegree(pitch('B', 0), region, 'la')).toEqual({ degree: 5, alteration: 1 });
    });

    it('嬰ヘ長調のE♯を度数7・変位0として計算する', () => {
      const region = keyRegion({ tonicStep: 'F', tonicAlter: 1, mode: 'major' });
      expect(computeDegree(pitch('E', 1), region, 'la')).toEqual({ degree: 7, alteration: 0 });
    });

    it('イ短調La基準のG♯（導音）を度数5・変位+1として計算する', () => {
      const region = keyRegion({ tonicStep: 'A', mode: 'minor' });
      expect(computeDegree(pitch('G', 1), region, 'la')).toEqual({ degree: 5, alteration: 1 });
    });

    // 2軸直交の担保: 同じ音が La基準では do/fa/so、Do基準では me/le/te 相当になる
    describe('La基準⇔Do基準の読み替え（イ短調の C/F/G）', () => {
      const region = keyRegion({ tonicStep: 'A', mode: 'minor' });

      it.each<{ step: PitchStep; la: [number, number]; doBasis: [number, number] }>([
        { step: 'C', la: [1, 0], doBasis: [3, -1] },
        { step: 'F', la: [4, 0], doBasis: [6, -1] },
        { step: 'G', la: [5, 0], doBasis: [7, -1] },
      ])('$step: La基準 $la / Do基準 $doBasis', ({ step, la, doBasis }) => {
        expect(computeDegree(pitch(step, 0), region, 'la')).toEqual({
          degree: la[0],
          alteration: la[1],
        });
        expect(computeDegree(pitch(step, 0), region, 'do')).toEqual({
          degree: doBasis[0],
          alteration: doBasis[1],
        });
      });
    });
  });

  describe('SolfaEngine クラス', () => {
    it('計算から文字列化まで一貫して動作する（ト長調F♮ → te）', () => {
      const engine = new SolfaEngine();
      const region = keyRegion({ tonicStep: 'G', mode: 'major' });
      const degree = engine.computeDegree(pitch('F', 0), region, DEFAULT_SETTINGS.minorBasis);
      expect(engine.toSyllable(degree, DEFAULT_SETTINGS)).toBe('te');
      expect(engine.toSyllable(degree, { ...DEFAULT_SETTINGS, syllableSystem: 'tonicSolfa' })).toBe(
        'ta',
      );
    });
  });
});

describe('computeDegrees（ScoreModel との結線）', () => {
  function regionAtMeasure(
    measureIndex: number,
    tonicStep: PitchStep,
    mode: 'major' | 'minor' = 'major',
    tonicAlter = 0,
  ): KeyRegion {
    return {
      id: `key-${measureIndex}`,
      start: { measureIndex, offset: 0 },
      tonicStep,
      tonicAlter,
      mode,
      source: 'auto',
    };
  }

  function note(id: string, measureIndex: number, step: PitchStep, alter = 0): NoteEvent {
    return {
      id,
      partId: 'P1',
      measureIndex,
      pitch: pitch(step, alter),
      head: { pageIndex: 0, x: 0, y: 0 },
      solfa: null,
    };
  }

  function scoreOf(measures: Measure[]): ScoreModel {
    return { parts: [{ id: 'P1', name: 'P1', staves: [] }], systems: [], measures };
  }

  function measure(
    index: number,
    notes: NoteEvent[],
    status: Measure['status'] = 'matched',
  ): Measure {
    return { partId: 'P1', index, status, notes };
  }

  it('全ての音符に階名を与える', () => {
    const score = scoreOf([
      measure(0, [note('n1', 0, 'C'), note('n2', 0, 'D')]),
      measure(1, [note('n3', 1, 'E')]),
    ]);

    const degrees = new SolfaEngine().computeDegrees(score, [regionAtMeasure(0, 'C')], 'la');

    expect(degrees.size).toBe(3);
    expect(degrees.get('n1')).toEqual({ degree: 1, alteration: 0 });
    expect(degrees.get('n2')).toEqual({ degree: 2, alteration: 0 });
    expect(degrees.get('n3')).toEqual({ degree: 3, alteration: 0 });
  });

  it('転調をまたぐ音符はその位置で有効な KeyRegion で計算される', () => {
    const score = scoreOf([
      measure(0, [note('before', 0, 'G')]),
      measure(4, [note('boundary', 4, 'G')]),
      measure(9, [note('after', 9, 'G')]),
    ]);
    // m0〜m3 はハ長調（G は so）、m4 以降はト長調（G は do）
    const regions = [regionAtMeasure(0, 'C'), regionAtMeasure(4, 'G')];

    const degrees = new SolfaEngine().computeDegrees(score, regions, 'la');

    expect(degrees.get('before')).toEqual({ degree: 5, alteration: 0 });
    expect(degrees.get('boundary')).toEqual({ degree: 1, alteration: 0 });
    expect(degrees.get('after')).toEqual({ degree: 1, alteration: 0 });
  });

  it('多数の KeyRegion でも各小節が正しい区間に割り当たる（二分探索の検証）', () => {
    // 0,10,20,...,90 の 10 区間。主音は C,D,E,F,G,A,B,C,D,E と巡回する
    const steps: PitchStep[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C', 'D', 'E'];
    const regions = steps.map((step, i) => regionAtMeasure(i * 10, step));
    const score = scoreOf(
      Array.from({ length: 100 }, (_, m) => measure(m, [note(`n${m}`, m, 'C')])),
    );

    const degrees = new SolfaEngine().computeDegrees(score, regions, 'la');

    for (let m = 0; m < 100; m += 1) {
      const expectedStep = steps[Math.floor(m / 10)];
      expect(expectedStep).toBeDefined();
      const expected = computeDegree(pitch('C', 0), regionAtMeasure(0, expectedStep ?? 'C'), 'la');
      expect(degrees.get(`n${m}`)).toEqual(expected);
    }
  });

  it('skipped 小節（音符なし）があっても例外にならない', () => {
    const score = scoreOf([
      measure(0, [note('n1', 0, 'C')]),
      measure(1, [], 'skipped'),
      measure(2, [note('n2', 2, 'D')]),
    ]);

    const degrees = new SolfaEngine().computeDegrees(score, [regionAtMeasure(0, 'C')], 'la');

    expect([...degrees.keys()]).toEqual(['n1', 'n2']);
  });

  it('短調基準（La / Do）の切り替えが結果に反映される', () => {
    const score = scoreOf([measure(0, [note('n1', 0, 'C')])]);
    const regions = [regionAtMeasure(0, 'A', 'minor')];
    const engine = new SolfaEngine();

    // イ短調の C は La基準で do（度数1）、Do基準で me（度数3・変位-1）
    expect(engine.computeDegrees(score, regions, 'la').get('n1')).toEqual({
      degree: 1,
      alteration: 0,
    });
    expect(engine.computeDegrees(score, regions, 'do').get('n1')).toEqual({
      degree: 3,
      alteration: -1,
    });
  });

  describe('KeyRegion の契約検証', () => {
    const score = scoreOf([measure(0, [note('n1', 0, 'C')])]);
    const engine = new SolfaEngine();

    it('空の KeyRegion 列を拒否する', () => {
      expect(() => engine.computeDegrees(score, [], 'la')).toThrow('KeyRegion が空です');
    });

    it('曲頭の KeyRegion がない場合を拒否する', () => {
      expect(() => engine.computeDegrees(score, [regionAtMeasure(3, 'C')], 'la')).toThrow(
        'KeyRegion の先頭は曲頭',
      );
    });

    it('先頭の offset が 0 でない場合を拒否する', () => {
      const head = regionAtMeasure(0, 'C');
      const shifted: KeyRegion = { ...head, start: { measureIndex: 0, offset: 12 } };
      expect(() => engine.computeDegrees(score, [shifted], 'la')).toThrow('KeyRegion の先頭は曲頭');
    });

    it('小節番号が昇順でない場合を拒否する', () => {
      const regions = [regionAtMeasure(0, 'C'), regionAtMeasure(5, 'G'), regionAtMeasure(2, 'D')];
      expect(() => engine.computeDegrees(score, regions, 'la')).toThrow('昇順・重複なし');
    });

    it('小節番号が重複する場合を拒否する', () => {
      const regions = [regionAtMeasure(0, 'C'), regionAtMeasure(0, 'G')];
      expect(() => engine.computeDegrees(score, regions, 'la')).toThrow('昇順・重複なし');
    });
  });
});

describe('applyDegrees', () => {
  const baseNote: NoteEvent = {
    id: 'n1',
    partId: 'P1',
    measureIndex: 0,
    pitch: { step: 'C', alter: 0, octave: 4 },
    head: { pageIndex: 0, x: 1, y: 2 },
    solfa: null,
  };
  const score: ScoreModel = {
    parts: [{ id: 'P1', name: 'P1', staves: [] }],
    systems: [],
    measures: [
      { partId: 'P1', index: 0, status: 'matched', notes: [baseNote] },
      { partId: 'P1', index: 1, status: 'skipped', notes: [] },
    ],
  };

  it('階名を埋めた新しい ScoreModel を返す', () => {
    const applied = applyDegrees(score, new Map([['n1', { degree: 1, alteration: 0 }]]));

    expect(applied.measures[0]?.notes[0]?.solfa).toEqual({ degree: 1, alteration: 0 });
  });

  it('元の ScoreModel を変更しない（非破壊）', () => {
    applyDegrees(score, new Map([['n1', { degree: 1, alteration: 0 }]]));

    expect(score.measures[0]?.notes[0]?.solfa).toBeNull();
    expect(baseNote.solfa).toBeNull();
  });

  it('結果のない音符は solfa を null のまま残す', () => {
    const applied = applyDegrees(score, new Map());

    expect(applied.measures[0]?.notes[0]?.solfa).toBeNull();
  });

  it('結果のない音符の既存の階名を上書きしない（部分再計算の安全性）', () => {
    // 転調指定の変更で影響範囲だけ再計算したとき、範囲外の階名が無言で消えてはいけない
    const scored: ScoreModel = {
      ...score,
      measures: [
        {
          ...(score.measures[0] as Measure),
          notes: [{ ...baseNote, solfa: { degree: 5, alteration: 0 } }],
        },
        ...score.measures.slice(1),
      ],
    };

    const applied = applyDegrees(scored, new Map());

    expect(applied.measures[0]?.notes[0]?.solfa).toEqual({ degree: 5, alteration: 0 });
  });

  it('結果のある音符は既存の階名を置き換える', () => {
    const scored: ScoreModel = {
      ...score,
      measures: [
        {
          ...(score.measures[0] as Measure),
          notes: [{ ...baseNote, solfa: { degree: 5, alteration: 0 } }],
        },
        ...score.measures.slice(1),
      ],
    };

    const applied = applyDegrees(scored, new Map([['n1', { degree: 2, alteration: -1 }]]));

    expect(applied.measures[0]?.notes[0]?.solfa).toEqual({ degree: 2, alteration: -1 });
  });

  it('音符以外のフィールドを保つ', () => {
    const applied = applyDegrees(score, new Map([['n1', { degree: 1, alteration: 0 }]]));

    expect(applied.parts).toEqual(score.parts);
    expect(applied.measures[1]).toEqual(score.measures[1]);
    expect(applied.measures[0]?.notes[0]?.head).toEqual({ pageIndex: 0, x: 1, y: 2 });
  });
});

describe('computeDegrees → toSyllable の一気通貫', () => {
  it('ト長調の音階が階名文字列になる', () => {
    const engine = new SolfaEngine();
    const steps: PitchStep[] = ['G', 'A', 'B', 'C', 'D', 'E', 'F'];
    const score: ScoreModel = {
      parts: [{ id: 'P1', name: 'P1', staves: [] }],
      systems: [],
      measures: [
        {
          partId: 'P1',
          index: 0,
          status: 'matched',
          notes: steps.map((step, i) => ({
            id: `n${i}`,
            partId: 'P1',
            measureIndex: 0,
            pitch: { step, alter: step === 'F' ? 1 : 0, octave: 4 },
            head: { pageIndex: 0, x: i, y: 0 },
            solfa: null,
          })),
        },
      ],
    };
    const regions: KeyRegion[] = [
      {
        id: 'key-0',
        start: { measureIndex: 0, offset: 0 },
        tonicStep: 'G',
        tonicAlter: 0,
        mode: 'major',
        source: 'auto',
      },
    ];

    const applied = applyDegrees(score, engine.computeDegrees(score, regions, 'la'));
    const syllables = (applied.measures[0]?.notes ?? []).map((n) =>
      n.solfa === null ? '?' : engine.toSyllable(n.solfa, DEFAULT_SETTINGS),
    );

    expect(syllables).toEqual(['do', 're', 'mi', 'fa', 'so', 'la', 'ti']);
  });
});
