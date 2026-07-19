import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BookStructureResolver } from '../../../src/domain/score/BookStructureResolver';
import { parseMusicXml } from '../../../src/domain/score/MusicXmlParser';
import { parseBookXml, parseSheetXml } from '../../../src/domain/score/OmrSheetParser';
import type { OmrArtifacts } from '../../../src/domain/score/ScoreModelBuilder';
import { ScoreModelBuilder } from '../../../src/domain/score/ScoreModelBuilder';
import type { ConfirmationState } from '../../../src/shared/types/Confirmation';

/**
 * synthetic-mini フィクスチャによるパース→照合の通し回帰。
 * 各コンポーネントのユニットテストが担保する内部挙動ではなく、
 * 「実ファイルを 3 パーサに通して ScoreModelBuilder で組み立てる」経路全体を固定する。
 * フィクスチャの設計意図・座標の逆算根拠は tests/fixtures/synthetic-mini/README.md を参照。
 */
const readFixture = (name: string): string =>
  readFileSync(new URL(`../../fixtures/synthetic-mini/${name}`, import.meta.url), 'utf-8');

const noCorrections: ConfirmationState = { items: [], completedAt: '2026-07-18T00:00:00Z' };

describe('synthetic-mini パイプライン統合', () => {
  const musicXml = parseMusicXml(readFixture('score.musicxml'));
  const sheet = parseSheetXml(readFixture('sheet1.xml'));

  const artifacts: OmrArtifacts = {
    movements: [{ musicXml }],
    pages: sheet.pages,
  };
  // フィクスチャの MusicXML は <print> を持たないため、段の小節数は OMR の stack 数へ
  // フォールバックする（BookStructureResolver の既定動作）
  const structure = new BookStructureResolver().resolve(
    artifacts,
    parseBookXml(readFixture('book.xml')),
  );
  const result = new ScoreModelBuilder().build(artifacts, structure, noCorrections);

  it('各パーサがフィクスチャの構造を復元する', () => {
    expect(musicXml.parts.map((p) => [p.id, p.name, p.measures.length])).toEqual([
      ['P1', 'Soprano', 4],
      ['P2', 'Bass', 4],
    ]);
    // 休符は除外され発音音符のみ（P1 m0 は G4, A4 の 2 音）
    expect(musicXml.parts[0]?.measures[0]?.notes.map((n) => n.pitch.step)).toEqual(['G', 'A']);
    // 調号は第1小節で宣言され以降は持続（m1 は宣言なし = null）
    expect(musicXml.parts[0]?.measures[0]?.key).toEqual({ fifths: 1, mode: 'major' });
    expect(musicXml.parts[0]?.measures[1]?.key).toBeNull();
    expect(sheet.pages).toHaveLength(1);
    expect(sheet.pages[0]?.systems).toHaveLength(2);
    // 単一 movement（movement-start なし・先頭ページの暗黙開始）
    expect(structure).toEqual({
      movements: [
        {
          musicXmlIndex: 0,
          pageIndices: [0],
          systems: [
            { pageIndex: 0, systemIndex: 0, firstMeasureIndex: 0, measureCount: 2 },
            { pageIndex: 0, systemIndex: 1, firstMeasureIndex: 2, measureCount: 2 },
          ],
        },
      ],
    });
  });

  it('音符数一致の小節が対付けされ、不一致の小節だけが skipped で隔離される', () => {
    expect(result.score.measures.map((m) => [m.partId, m.index, m.status])).toEqual([
      ['P1', 0, 'matched'],
      ['P1', 1, 'matched'],
      ['P1', 2, 'matched'],
      ['P1', 3, 'matched'],
      ['P2', 0, 'matched'],
      ['P2', 1, 'matched'],
      ['P2', 2, 'matched'],
      ['P2', 3, 'skipped'],
    ]);
    // skipped 小節は誤対応を避けるため notes を破棄する
    const skipped = result.score.measures.find((m) => m.partId === 'P2' && m.index === 3);
    expect(skipped?.notes).toEqual([]);
    // matched 音符の総数（P1: 2+2+3+1、P2: 1+2+2+0 = 13）
    const totalNotes = result.score.measures.reduce((sum, m) => sum + m.notes.length, 0);
    expect(totalNotes).toBe(13);
  });

  it('issue は音符数不一致 1 件のみ（クロスチェック不一致・構造欠落はゼロ）', () => {
    expect(result.issues).toEqual([
      {
        kind: 'measureCountMismatch',
        partId: 'P2',
        measureIndex: 3,
        pageIndex: 0,
        systemIndex: 1,
        omrCount: 3,
        xmlCount: 2,
      },
    ]);
  });

  it('NoteEvent が MusicXML の音高（臨時記号込み）と符頭中心座標を保持する', () => {
    const p1m0 = result.score.measures.find((m) => m.partId === 'P1' && m.index === 0);
    // 符頭中心 x = bounds.x(150) + trunc(w/2)(10) = 160
    expect(p1m0?.notes[0]).toMatchObject({
      id: 'P1:m0:n0',
      partId: 'P1',
      measureIndex: 0,
      pitch: { step: 'G', alter: 0, octave: 4 },
      head: { pageIndex: 0, x: 160, y: 300 },
      solfa: null,
    });
    // 臨時記号 alter が保持される（F#5 / E5 / C5）
    const p1m2 = result.score.measures.find((m) => m.partId === 'P1' && m.index === 2);
    expect(p1m2?.notes.map((n) => [n.pitch.step, n.pitch.alter, n.pitch.octave])).toEqual([
      ['F', 1, 5],
      ['E', 0, 5],
      ['C', 0, 5],
    ]);
    const p2m2 = result.score.measures.find((m) => m.partId === 'P2' && m.index === 2);
    expect(p2m2?.notes.map((n) => [n.pitch.step, n.pitch.alter])).toEqual([
      ['B', 0],
      ['E', -1],
    ]);
  });

  it('SystemInfo と Part.staves が走査順に構築される', () => {
    expect(result.score.systems).toEqual([
      { pageIndex: 0, systemIndex: 0, firstMeasureIndex: 0, measureCount: 2 },
      { pageIndex: 0, systemIndex: 1, firstMeasureIndex: 2, measureCount: 2 },
    ]);
    expect(result.score.parts.map((p) => [p.id, p.name])).toEqual([
      ['P1', 'Soprano'],
      ['P2', 'Bass'],
    ]);
    expect(result.score.parts[0]?.staves).toEqual([
      { pageIndex: 0, systemIndex: 0, staffIndex: 0, partId: 'P1' },
      { pageIndex: 0, systemIndex: 1, staffIndex: 0, partId: 'P1' },
    ]);
    expect(result.score.parts[1]?.staves).toEqual([
      { pageIndex: 0, systemIndex: 0, staffIndex: 1, partId: 'P2' },
      { pageIndex: 0, systemIndex: 1, staffIndex: 1, partId: 'P2' },
    ]);
  });
});
