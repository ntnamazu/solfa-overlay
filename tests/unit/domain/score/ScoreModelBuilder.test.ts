import { describe, expect, it } from 'vitest';
import type {
  MusicXmlMeasure,
  MusicXmlNote,
  MusicXmlPart,
} from '../../../../src/domain/score/MusicXmlParser';
import type { OmrHead, OmrStaff, OmrSystem } from '../../../../src/domain/score/OmrSheetParser';
import type { OmrArtifacts } from '../../../../src/domain/score/ScoreModelBuilder';
import { ScoreModelBuilder } from '../../../../src/domain/score/ScoreModelBuilder';
import type { ConfirmationState } from '../../../../src/shared/types/Confirmation';
import type { PitchStep } from '../../../../src/shared/types/Pitch';
import type { ResolvedStructure } from '../../../../src/shared/types/ResolvedStructure';

/** テストデータ組み立てヘルパー（offset 省略時は 0 = 同時発音として扱われる点に注意） */
const note = (
  step: PitchStep,
  octave: number,
  alter = 0,
  staff: number | null = null,
  offset = 0,
): MusicXmlNote => ({
  pitch: { step, alter, octave },
  isChordTone: false,
  offset,
  staff,
});

const measure = (index: number, notes: MusicXmlNote[]): MusicXmlMeasure => ({
  index,
  key: null,
  notes,
});

const part = (id: string, name: string, measures: MusicXmlMeasure[]): MusicXmlPart => ({
  id,
  name,
  measures,
});

/** 符頭: 中心 x = x + 10（w=20 固定） */
const head = (pitch: number, x: number): OmrHead => ({ pitch, x, y: 300, w: 20, h: 16 });

const staff = (partId: string, clefKind: string | null, heads: OmrHead[]): OmrStaff => ({
  partId,
  staffId: `s-${partId}`,
  clefKind,
  heads,
});

const twoStackSystem = (staves: OmrStaff[]): OmrSystem => ({
  stacks: [
    { left: 0, right: 100 },
    { left: 100, right: 200 },
  ],
  staves,
});

/** 1 movement・1 ページの確定構造（段の小節数は stackCount で与える） */
const oneSystemMovement = (stackCount: number): ResolvedStructure => ({
  movements: [
    {
      musicXmlIndex: 0,
      pageIndices: [0],
      systems: [
        { pageIndex: 0, systemIndex: 0, firstMeasureIndex: 0, measureCount: stackCount },
      ],
    },
  ],
});

const singleMovement: ResolvedStructure = oneSystemMovement(2);

const noCorrections: ConfirmationState = { items: [], completedAt: '2026-07-18T00:00:00Z' };

const builder = new ScoreModelBuilder();

describe('ScoreModelBuilder', () => {
  describe('照合（matched）', () => {
    // TREBLE（中線 B4）: pitch 6 = C4, 5 = D4, 4 = E4
    const artifacts: OmrArtifacts = {
      movements: [
        {
          musicXml: { layout: [],
            parts: [
              part('P1', 'Soprano', [
                // 逐次音は offset を分けて実パーサの出力に合わせる（同 offset は同時発音の意味になる）
                measure(0, [note('C', 4), note('D', 4, 0, null, 4)]),
                measure(1, [note('E', 4)]),
              ]),
            ],
          },
        },
      ],
      pages: [
        {
          systems: [
            twoStackSystem([staff('P1', 'TREBLE', [head(6, 10), head(5, 50), head(4, 110)])]),
          ],
        },
      ],
    };
    const result = builder.build(artifacts, singleMovement, noCorrections);

    it('音符数一致の小節は matched になり、時間順×座標順で対になる', () => {
      expect(result.issues).toEqual([]);
      expect(result.score.measures.map((m) => m.status)).toEqual(['matched', 'matched']);
      const [first, second] = result.score.measures;
      expect(first?.notes.map((event) => event.pitch.step)).toEqual(['C', 'D']);
      expect(second?.notes.map((event) => event.pitch.step)).toEqual(['E']);
    });

    it('NoteEvent は符頭中心座標と決定的な id を持つ', () => {
      const events = result.score.measures[0]?.notes ?? [];
      expect(events[0]).toMatchObject({
        id: 'P1:m0:n0',
        partId: 'P1',
        measureIndex: 0,
        head: { pageIndex: 0, x: 20, y: 300 },
        solfa: null,
      });
      expect(events[1]?.id).toBe('P1:m0:n1');
    });

    it('SystemInfo と Part.staves が走査結果から構築される', () => {
      expect(result.score.systems).toEqual([
        { pageIndex: 0, systemIndex: 0, firstMeasureIndex: 0, measureCount: 2 },
      ]);
      expect(result.score.parts).toEqual([
        {
          id: 'P1',
          name: 'Soprano',
          staves: [{ pageIndex: 0, systemIndex: 0, staffIndex: 0, partId: 'P1' }],
        },
      ]);
    });
  });

  describe('スキップ小節の隔離', () => {
    it('音符数不一致の小節だけが skipped になり、他小節へ波及しない', () => {
      const artifacts: OmrArtifacts = {
        movements: [
          {
            musicXml: { layout: [],
              parts: [
                part('P1', 'Alto', [
                  measure(0, [note('C', 4), note('D', 4, 0, null, 4)]), // OMR 側は 1 個 → 不一致
                  measure(1, [note('E', 4)]),
                ]),
              ],
            },
          },
        ],
        pages: [{ systems: [twoStackSystem([staff('P1', 'TREBLE', [head(6, 10), head(4, 110)])])] }],
      };
      const result = builder.build(artifacts, singleMovement, noCorrections);
      expect(result.score.measures.map((m) => [m.index, m.status])).toEqual([
        [0, 'skipped'],
        [1, 'matched'],
      ]);
      expect(result.score.measures[0]?.notes).toEqual([]);
      expect(result.issues).toEqual([
        {
          kind: 'measureCountMismatch',
          partId: 'P1',
          measureIndex: 0,
          pageIndex: 0,
          systemIndex: 0,
          omrCount: 1,
          xmlCount: 2,
        },
      ]);
    });
  });

  describe('和音・多声の列対付け（offset 列 × 縦位置）', () => {
    it('和音で head の x 順と文書順が食い違っても縦位置で正対付けされる', () => {
      // 文書順 [C4, E4]（同 offset の和音）に対し、符頭は x 順で [E4位置, C4位置] と逆。
      // 旧方式（文書順×x順の添字 zip）では座標取り違え＋クロスチェック誤検出になったケース
      const artifacts: OmrArtifacts = {
        movements: [
          { musicXml: { layout: [], parts: [part('P1', 'Sop', [measure(0, [note('C', 4), note('E', 4)])])] } },
        ],
        pages: [
          {
            systems: [
              {
                stacks: [{ left: 0, right: 100 }],
                // TREBLE: pitch 4 = E4（x=10）, pitch 6 = C4（x=40）
                staves: [staff('P1', 'TREBLE', [head(4, 10), head(6, 40)])],
              },
            ],
          },
        ],
      };
      const result = builder.build(artifacts, singleMovement, noCorrections);
      expect(result.issues).toEqual([]);
      const notes = result.score.measures[0]?.notes ?? [];
      // 列内は高い音から: E4 → pitch4 の符頭（中心 x=20）、C4 → pitch6 の符頭（中心 x=50）
      expect(notes.map((event) => [event.pitch.step, event.head.x])).toEqual([
        ['E', 20],
        ['C', 50],
      ]);
    });

    it('オクターブ重複 divisi（同レター）でも符頭座標を取り違えない', () => {
      // G5 + G4 の同時発音。step クロスチェックは同レターのため検出できず、
      // 旧方式では静かに座標が入れ替わったケース（コードレビュー指摘1の核心）
      // TREBLE: G5 = pitch -5（x=40）, G4 = pitch 2（x=10）
      const artifacts: OmrArtifacts = {
        movements: [
          { musicXml: { layout: [], parts: [part('P1', 'Sop', [measure(0, [note('G', 5), note('G', 4)])])] } },
        ],
        pages: [
          {
            systems: [
              {
                stacks: [{ left: 0, right: 100 }],
                staves: [staff('P1', 'TREBLE', [head(2, 10), head(-5, 40)])],
              },
            ],
          },
        ],
      };
      const result = builder.build(artifacts, singleMovement, noCorrections);
      expect(result.issues).toEqual([]);
      const notes = result.score.measures[0]?.notes ?? [];
      expect(notes.map((event) => [event.pitch.octave, event.head.x])).toEqual([
        [5, 50], // G5 → 高い方（pitch -5）の符頭
        [4, 20], // G4 → 低い方（pitch 2）の符頭
      ]);
    });

    it('backup/forward の異リズム多声は offset 列にマージして対付けされる', () => {
      // 声部1: C5(0-2) D5(2-4) / 声部2: E4 全音符(0-4)。文書順は [C5, D5, E4] だが
      // 版面の x 順は [C5, E4, D5]（時間順）になる
      // TREBLE: C5 = pitch -1, E4 = pitch 4, D5 = pitch -2
      const artifacts: OmrArtifacts = {
        movements: [
          {
            musicXml: { layout: [],
              parts: [
                part('P1', 'Sop', [
                  measure(0, [
                    note('C', 5, 0, null, 0),
                    note('D', 5, 0, null, 2),
                    note('E', 4, 0, null, 0),
                  ]),
                ]),
              ],
            },
          },
        ],
        pages: [
          {
            systems: [
              {
                stacks: [{ left: 0, right: 100 }],
                staves: [staff('P1', 'TREBLE', [head(-1, 10), head(4, 12), head(-2, 60)])],
              },
            ],
          },
        ],
      };
      const result = builder.build(artifacts, singleMovement, noCorrections);
      expect(result.issues).toEqual([]);
      const notes = result.score.measures[0]?.notes ?? [];
      // 列 {offset0: [C5, E4], offset2: [D5]} → 貪欲に符頭 [x10, x12] / [x60] を割当
      expect(notes.map((event) => [event.pitch.step, event.pitch.octave, event.head.x])).toEqual([
        ['C', 5, 20],
        ['E', 4, 22],
        ['D', 5, 70],
      ]);
    });

    it('ユニゾン共有符頭（1符頭に2音）は現状は音符数不一致として skipped になる', () => {
      // 2声部が同音・同リズムのとき、版面は 1 符頭に 2 本の符尾で彫られることがある。
      // 照合の緩和（同 offset・同音高の集約）は実フィクスチャで Audiveris の実出力を
      // 確認してから導入判断するため、現状の厳格照合（skip + issue）を固定する
      const artifacts: OmrArtifacts = {
        movements: [
          { musicXml: { layout: [], parts: [part('P1', 'Sop', [measure(0, [note('G', 4), note('G', 4)])])] } },
        ],
        pages: [
          {
            systems: [
              { stacks: [{ left: 0, right: 100 }], staves: [staff('P1', 'TREBLE', [head(2, 10)])] },
            ],
          },
        ],
      };
      const result = builder.build(artifacts, singleMovement, noCorrections);
      expect(result.score.measures[0]?.status).toBe('skipped');
      expect(result.issues).toEqual([
        {
          kind: 'measureCountMismatch',
          partId: 'P1',
          measureIndex: 0,
          pageIndex: 0,
          systemIndex: 0,
          omrCount: 1,
          xmlCount: 2,
        },
      ]);
    });
  });

  describe('音高クロスチェックと clef 修正', () => {
    // ヘ音記号パートがト音記号と誤認識されたケース: BASS の中線 D3、TREBLE の中線 B4。
    // 同じ譜表位置 pitch=0 が BASS では D、TREBLE では B に逆算される
    const bassArtifacts = (): OmrArtifacts => ({
      movements: [
        { musicXml: { layout: [], parts: [part('P1', 'Bass', [measure(0, [note('D', 3)])])] } },
      ],
      pages: [
        {
          systems: [
            { stacks: [{ left: 0, right: 100 }], staves: [staff('P1', 'TREBLE', [head(0, 10)])] },
          ],
        },
      ],
    });

    it('誤認識された clef では step 不一致が issue として報告される（音符は MusicXML の音高で生成）', () => {
      const result = builder.build(bassArtifacts(), singleMovement, noCorrections);
      expect(result.issues).toEqual([
        {
          kind: 'pitchCrossCheckMismatch',
          noteId: 'P1:m0:n0',
          partId: 'P1',
          measureIndex: 0,
          expectedStep: 'D',
          omrStep: 'B',
        },
      ]);
      expect(result.score.measures[0]?.notes[0]?.pitch).toEqual({ step: 'D', alter: 0, octave: 3 });
    });

    it('確認画面の corrected（TREBLE→BASS）が反映されると不一致が解消する', () => {
      const confirmation: ConfirmationState = {
        items: [
          {
            id: 'c1',
            kind: 'clef',
            staffRef: { pageIndex: 0, systemIndex: 0, staffIndex: 0, partId: 'P1' },
            detected: 'TREBLE',
            corrected: 'BASS',
            clipRect: { pageIndex: 0, x: 0, y: 0, width: 10, height: 10 },
          },
        ],
        completedAt: '2026-07-18T00:00:00Z',
      };
      const result = builder.build(bassArtifacts(), singleMovement, confirmation);
      expect(result.issues).toEqual([]);
    });

    it('clef 未検出（null）の譜表はクロスチェックをスキップして照合だけ行う', () => {
      const artifacts = bassArtifacts();
      const target = artifacts.pages[0]?.systems[0]?.staves[0];
      if (target) target.clefKind = null;
      const result = builder.build(artifacts, singleMovement, noCorrections);
      expect(result.issues).toEqual([]);
      expect(result.score.measures[0]?.status).toBe('matched');
    });

    it('未知の clef kind は unknownClef issue になり、クロスチェックはスキップされる', () => {
      const artifacts = bassArtifacts();
      const target = artifacts.pages[0]?.systems[0]?.staves[0];
      if (target) target.clefKind = 'PERCUSSION';
      const result = builder.build(artifacts, singleMovement, noCorrections);
      expect(result.issues).toEqual([
        {
          kind: 'unknownClef',
          pageIndex: 0,
          systemIndex: 0,
          staffIndex: 0,
          partId: 'P1',
          clefKind: 'PERCUSSION',
        },
      ]);
      expect(result.score.measures[0]?.status).toBe('matched');
    });
  });

  describe('複数 movement の通し小節番号', () => {
    it('movement を跨いだ小節は MusicXML の論理小節数で累積した通し番号になる', () => {
      // mvt0: 2小節（ページ0）/ mvt1: 1小節（ページ1）→ 通し番号 0,1,2
      const artifacts: OmrArtifacts = {
        movements: [
          {
            musicXml: { layout: [],
              parts: [
                part('P1', 'Tenor', [
                  measure(0, [note('G', 3)]),
                  measure(1, [note('A', 3)]),
                ]),
              ],
            },
          },
          { musicXml: { layout: [], parts: [part('P1', 'Tenor', [measure(0, [note('B', 3)])])] } },
        ],
        pages: [
          {
            systems: [
              // TREBLE_DOWN_8（中線 B3）: pitch 2 = G3, 1 = A3
              twoStackSystem([staff('P1', 'TREBLE_DOWN_8', [head(2, 10), head(1, 110)])]),
            ],
          },
          {
            systems: [
              {
                stacks: [{ left: 0, right: 100 }],
                staves: [staff('P1', 'TREBLE_DOWN_8', [head(0, 10)])],
              },
            ],
          },
        ],
      };
      const structure: ResolvedStructure = {
        movements: [
          {
            musicXmlIndex: 0,
            pageIndices: [0],
            systems: [
              { pageIndex: 0, systemIndex: 0, firstMeasureIndex: 0, measureCount: 2 },
            ],
          },
          {
            musicXmlIndex: 1,
            pageIndices: [1],
            systems: [
              { pageIndex: 1, systemIndex: 0, firstMeasureIndex: 2, measureCount: 1 },
            ],
          },
        ],
      };
      const result = builder.build(artifacts, structure, noCorrections);
      expect(result.issues).toEqual([]);
      expect(result.score.measures.map((m) => m.index)).toEqual([0, 1, 2]);
      expect(result.score.measures[2]?.notes[0]?.id).toBe('P1:m2:n0');
      expect(result.score.systems.map((s) => s.firstMeasureIndex)).toEqual([0, 2]);
    });
  });

  describe('多譜表パート', () => {
    it('同一パートの複数譜表は <staff> 番号で音符を振り分けて照合する', () => {
      const artifacts: OmrArtifacts = {
        movements: [
          {
            musicXml: { layout: [],
              parts: [
                part('P1', 'Piano', [
                  measure(0, [note('C', 5, 0, 1), note('E', 3, 0, 2)]),
                ]),
              ],
            },
          },
        ],
        pages: [
          {
            systems: [
              {
                stacks: [{ left: 0, right: 100 }],
                staves: [
                  staff('P1', 'TREBLE', [head(-1, 10)]), // C5
                  staff('P1', 'BASS', [head(-1, 10)]), // E3
                ],
              },
            ],
          },
        ],
      };
      const result = builder.build(artifacts, singleMovement, noCorrections);
      expect(result.issues).toEqual([]);
      const notes = result.score.measures[0]?.notes ?? [];
      expect(notes.map((event) => [event.pitch.step, event.id])).toEqual([
        ['C', 'P1:m0:n0'],
        ['E', 'P1:m0:n1'],
      ]);
      expect(result.score.parts[0]?.staves).toHaveLength(2);
    });

    it('先に skipped 確定した小節は同一パートの後続譜表で再処理されない', () => {
      const artifacts: OmrArtifacts = {
        movements: [
          {
            musicXml: { layout: [],
              parts: [
                part('P1', 'Piano', [
                  measure(0, [note('C', 5, 0, 1), note('E', 3, 0, 2)]),
                ]),
              ],
            },
          },
        ],
        pages: [
          {
            systems: [
              {
                stacks: [{ left: 0, right: 100 }],
                staves: [
                  // 第1譜表: 符頭 2 個 vs staff=1 の音符 1 個 → 不一致で skipped
                  staff('P1', 'TREBLE', [head(-1, 10), head(-1, 40)]),
                  // 第2譜表: 同一小節を再訪するが skipped 済みのため早期 return
                  staff('P1', 'BASS', [head(-1, 10)]),
                ],
              },
            ],
          },
        ],
      };
      const result = builder.build(artifacts, singleMovement, noCorrections);
      expect(result.score.measures[0]?.status).toBe('skipped');
      expect(result.score.measures[0]?.notes).toEqual([]);
      // 不一致 issue は最初の譜表の 1 件のみ（再訪した譜表では issue を出さない）
      expect(result.issues).toEqual([
        {
          kind: 'measureCountMismatch',
          partId: 'P1',
          measureIndex: 0,
          pageIndex: 0,
          systemIndex: 0,
          omrCount: 2,
          xmlCount: 1,
        },
      ]);
    });
  });

  describe('構造の不整合', () => {
    it('MusicXML に存在しないパートの譜表は partNotFound issue になる', () => {
      const artifacts: OmrArtifacts = {
        movements: [{ musicXml: { layout: [], parts: [part('P1', 'Sop', [measure(0, [])])] } }],
        pages: [
          {
            systems: [
              { stacks: [{ left: 0, right: 100 }], staves: [staff('P9', 'TREBLE', [])] },
            ],
          },
        ],
      };
      const result = builder.build(artifacts, singleMovement, noCorrections);
      expect(result.issues).toEqual([
        { kind: 'partNotFound', partId: 'P9', pageIndex: 0, systemIndex: 0 },
      ]);
    });

    it('MusicXML の小節数を超える stack は measureOutOfRange issue になる', () => {
      const artifacts: OmrArtifacts = {
        movements: [
          { musicXml: { layout: [], parts: [part('P1', 'Sop', [measure(0, [note('C', 4)])])] } },
        ],
        pages: [{ systems: [twoStackSystem([staff('P1', 'TREBLE', [head(6, 10)])])] }],
      };
      const result = builder.build(artifacts, singleMovement, noCorrections);
      expect(result.issues).toEqual([
        { kind: 'measureOutOfRange', partId: 'P1', pageIndex: 0, systemIndex: 0, measureIndex: 1 },
      ]);
      expect(result.score.measures).toHaveLength(1);
    });

    it('ResolvedStructure が存在しない MusicXML / 段を指す場合は契約違反として例外にする', () => {
      const artifacts: OmrArtifacts = { movements: [], pages: [] };
      expect(() => builder.build(artifacts, singleMovement, noCorrections)).toThrowError(
        /MusicXML がありません/,
      );
      const withMovement: OmrArtifacts = {
        movements: [{ musicXml: { layout: [], parts: [] } }],
        pages: [],
      };
      expect(() => builder.build(withMovement, singleMovement, noCorrections)).toThrowError(
        /段がありません/,
      );
    });
  });

  describe('段アンカー（BookStructureResolver の確定構造）', () => {
    /** 2 段構成: 第1段は stack 2 個・第2段は stack 1 個。P1 は 3 小節ぶんの音符を持つ */
    const twoSystemArtifacts = (): OmrArtifacts => ({
      movements: [
        {
          musicXml: {
            layout: [],
            parts: [
              part('P1', 'Sop', [
                measure(0, [note('C', 4)]),
                measure(1, [note('D', 4)]),
                measure(2, [note('E', 4)]),
              ]),
            ],
          },
        },
      ],
      pages: [
        {
          systems: [
            twoStackSystem([staff('P1', 'TREBLE', [head(6, 10), head(5, 110)])]),
            {
              stacks: [{ left: 0, right: 100 }],
              staves: [staff('P1', 'TREBLE', [head(4, 10)])],
            },
          ],
        },
      ],
    });

    /** 第1段の担当小節数を measureCount で与える確定構造（第2段は必ず measureCount から始まる） */
    const structureWith = (firstSystemMeasureCount: number): ResolvedStructure => ({
      movements: [
        {
          musicXmlIndex: 0,
          pageIndices: [0],
          systems: [
            {
              pageIndex: 0,
              systemIndex: 0,
              firstMeasureIndex: 0,
              measureCount: firstSystemMeasureCount,
            },
            {
              pageIndex: 0,
              systemIndex: 1,
              firstMeasureIndex: firstSystemMeasureCount,
              measureCount: 1,
            },
          ],
        },
      ],
    });

    it('確定構造の小節数を超える stack は段内に隔離され、後続段の小節番号をずらさない', () => {
      // 第1段は stack 2 個だが確定構造では 1 小節ぶん → 2 個目の stack は measureOutOfRange
      const result = builder.build(twoSystemArtifacts(), structureWith(1), noCorrections);
      // 第2段の符頭は m2（E）向けのため m1（D）とはクロスチェックが合わない。ここでの関心事ではない
      expect(result.issues.filter((issue) => issue.kind === 'measureOutOfRange')).toEqual([
        { kind: 'measureOutOfRange', partId: 'P1', pageIndex: 0, systemIndex: 0, measureIndex: 1 },
      ]);
      // 第2段は 1（＝確定構造の firstMeasureIndex）から始まる。stack 数の累積なら 2 になっていた
      expect(result.score.measures.map((m) => m.index)).toEqual([0, 1]);
      expect(result.score.measures[1]?.notes.map((n) => n.pitch.step)).toEqual(['D']);
    });

    it('SystemInfo には確定構造の小節数が入る（OMR の stack 数ではない）', () => {
      const result = builder.build(twoSystemArtifacts(), structureWith(1), noCorrections);
      expect(result.score.systems).toEqual([
        { pageIndex: 0, systemIndex: 0, firstMeasureIndex: 0, measureCount: 1 },
        { pageIndex: 0, systemIndex: 1, firstMeasureIndex: 1, measureCount: 1 },
      ]);
    });

    it('確定構造が主張する小節に stack がない場合は skipped として残す（黙って欠落させない）', () => {
      // 第1段は MusicXML 3 小節ぶんを担当するが .omr の stack は 2 個（小節線の検出漏れ相当）
      const structure: ResolvedStructure = {
        movements: [
          {
            musicXmlIndex: 0,
            pageIndices: [0],
            systems: [
              { pageIndex: 0, systemIndex: 0, firstMeasureIndex: 0, measureCount: 3 },
              { pageIndex: 0, systemIndex: 1, firstMeasureIndex: 3, measureCount: 0 },
            ],
          },
        ],
      };
      const result = builder.build(twoSystemArtifacts(), structure, noCorrections);
      expect(result.issues).toContainEqual({
        kind: 'measureNotDetected',
        partId: 'P1',
        pageIndex: 0,
        systemIndex: 0,
        measureIndex: 2,
      });
      // m2 は消えず skipped として残る（修正UIの一覧に載る）
      expect(result.score.measures.map((m) => [m.index, m.status])).toEqual([
        [0, 'matched'],
        [1, 'matched'],
        [2, 'skipped'],
      ]);
    });

    it('movement 間で通し小節番号が重複する構造は契約違反として例外にする', () => {
      const artifacts = twoSystemArtifacts();
      const overlapping: ResolvedStructure = {
        movements: [
          {
            musicXmlIndex: 0,
            pageIndices: [0],
            systems: [
              { pageIndex: 0, systemIndex: 0, firstMeasureIndex: 0, measureCount: 2 },
            ],
          },
          {
            // 前 movement が 0-1 を使っているのに 1 から始まる＝小節が重なる
            musicXmlIndex: 0,
            pageIndices: [0],
            systems: [
              { pageIndex: 0, systemIndex: 1, firstMeasureIndex: 1, measureCount: 1 },
            ],
          },
        ],
      };
      expect(() => builder.build(artifacts, overlapping, noCorrections)).toThrowError(
        /通し小節番号が重複/,
      );
    });

    it('段が小節番号順に並んでいなくても movement 先頭を取り違えない', () => {
      const artifacts = twoSystemArtifacts();
      const reordered: ResolvedStructure = {
        movements: [
          {
            musicXmlIndex: 0,
            pageIndices: [0],
            systems: [
              // 意図的に後ろの段を先に置く（先頭要素＝movement 先頭とは限らない）
              { pageIndex: 0, systemIndex: 1, firstMeasureIndex: 2, measureCount: 1 },
              { pageIndex: 0, systemIndex: 0, firstMeasureIndex: 0, measureCount: 2 },
            ],
          },
        ],
      };
      const result = builder.build(artifacts, reordered, noCorrections);
      expect(result.issues).toEqual([]);
      expect(result.score.measures.map((m) => m.index)).toEqual([0, 1, 2]);
    });

    it('確定構造と stack 数が一致していれば全小節が照合される', () => {
      const result = builder.build(twoSystemArtifacts(), structureWith(2), noCorrections);
      expect(result.issues).toEqual([]);
      expect(result.score.measures.map((m) => m.index)).toEqual([0, 1, 2]);
      expect(result.score.measures[2]?.notes.map((n) => n.pitch.step)).toEqual(['E']);
    });
  });
});
