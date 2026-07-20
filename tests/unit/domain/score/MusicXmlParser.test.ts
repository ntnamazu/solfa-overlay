import { describe, expect, it } from 'vitest';
import { ScoreParseError } from '../../../../src/domain/score/errors';
import { parseMusicXml } from '../../../../src/domain/score/MusicXmlParser';

/** テスト用の score-partwise 文書を組み立てる */
function partwise(partList: string, parts: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <score-partwise version="4.0">
      <part-list>${partList}</part-list>
      ${parts}
    </score-partwise>`;
}

const note = (step: string, octave: number, duration: number, extra = ''): string =>
  `<note>${extra}<pitch><step>${step}</step><octave>${octave}</octave></pitch>
   <duration>${duration}</duration></note>`;

describe('parseMusicXml', () => {
  it('複数パートの id・パート名・小節数を抽出する', () => {
    const xml = partwise(
      `<score-part id="P1"><part-name>Soprano</part-name></score-part>
       <score-part id="P2"><part-name>Alto</part-name></score-part>`,
      `<part id="P1"><measure number="1"/><measure number="2"/></part>
       <part id="P2"><measure number="1"/></part>`,
    );
    const parsed = parseMusicXml(xml);
    expect(parsed.parts.map((part) => [part.id, part.name, part.measures.length])).toEqual([
      ['P1', 'Soprano', 2],
      ['P2', 'Alto', 1],
    ]);
    expect(parsed.parts[0]?.measures[0]?.index).toBe(0);
  });

  it('part-name が欠落したパートは id を名前として使う', () => {
    const xml = partwise(`<score-part id="P1"/>`, `<part id="P1"><measure number="1"/></part>`);
    expect(parseMusicXml(xml).parts[0]?.name).toBe('P1');
  });

  it('休符は notes に含めないが、後続音のオフセットには反映する', () => {
    const xml = partwise(
      `<score-part id="P1"/>`,
      `<part id="P1"><measure number="1">
         <attributes><divisions>4</divisions></attributes>
         <note><rest/><duration>4</duration></note>
         ${note('C', 4, 4)}
       </measure></part>`,
    );
    const notes = parseMusicXml(xml).parts[0]?.measures[0]?.notes ?? [];
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ pitch: { step: 'C', octave: 4 }, offset: 4 });
  });

  it('alter を整数化して抽出する（臨時記号・調号込みの実音）', () => {
    const xml = partwise(
      `<score-part id="P1"/>`,
      `<part id="P1"><measure number="1">
         <note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch>
           <duration>4</duration></note>
         <note><pitch><step>B</step><alter>-1</alter><octave>3</octave></pitch>
           <duration>4</duration></note>
       </measure></part>`,
    );
    const notes = parseMusicXml(xml).parts[0]?.measures[0]?.notes ?? [];
    expect(notes.map((event) => event.pitch)).toEqual([
      { step: 'F', alter: 1, octave: 4 },
      { step: 'B', alter: -1, octave: 3 },
    ]);
  });

  it('和音（chord）は直前音と同じオフセットになり、カーソルを進めない', () => {
    const xml = partwise(
      `<score-part id="P1"/>`,
      `<part id="P1"><measure number="1">
         <attributes><divisions>2</divisions></attributes>
         ${note('C', 4, 2)}
         ${note('E', 4, 2, '<chord/>')}
         ${note('G', 4, 2, '<chord/>')}
         ${note('D', 4, 2)}
       </measure></part>`,
    );
    const notes = parseMusicXml(xml).parts[0]?.measures[0]?.notes ?? [];
    expect(notes.map((event) => [event.pitch.step, event.offset, event.isChordTone])).toEqual([
      ['C', 0, false],
      ['E', 0, true],
      ['G', 0, true],
      ['D', 2, false],
    ]);
  });

  it('backup / forward を処理して多声小節のオフセットを計算する', () => {
    // 声部1: C(0-4) D(4-8) → backup 8 → 声部2: forward 4 → E(4-8)
    const xml = partwise(
      `<score-part id="P1"/>`,
      `<part id="P1"><measure number="1">
         <attributes><divisions>4</divisions></attributes>
         ${note('C', 5, 4)}
         ${note('D', 5, 4)}
         <backup><duration>8</duration></backup>
         <forward><duration>4</duration></forward>
         ${note('E', 4, 4)}
       </measure></part>`,
    );
    const notes = parseMusicXml(xml).parts[0]?.measures[0]?.notes ?? [];
    expect(notes.map((event) => [event.pitch.step, event.offset])).toEqual([
      ['C', 0],
      ['D', 4],
      ['E', 4],
    ]);
  });

  it('grace（duration なし）はオフセットを進めず 0 幅で抽出する', () => {
    const xml = partwise(
      `<score-part id="P1"/>`,
      `<part id="P1"><measure number="1">
         <attributes><divisions>4</divisions></attributes>
         <note><grace/><pitch><step>B</step><octave>4</octave></pitch></note>
         ${note('C', 5, 4)}
       </measure></part>`,
    );
    const notes = parseMusicXml(xml).parts[0]?.measures[0]?.notes ?? [];
    expect(notes.map((event) => [event.pitch.step, event.offset])).toEqual([
      ['B', 0],
      ['C', 0],
    ]);
  });

  it('調号の宣言・変更を小節単位で抽出し、宣言のない小節は null になる', () => {
    const xml = partwise(
      `<score-part id="P1"/>`,
      `<part id="P1">
         <measure number="1">
           <attributes><key><fifths>1</fifths><mode>major</mode></key></attributes>
         </measure>
         <measure number="2"/>
         <measure number="3">
           <attributes><key><fifths>-3</fifths></key></attributes>
         </measure>
       </part>`,
    );
    const measures = parseMusicXml(xml).parts[0]?.measures ?? [];
    expect(measures.map((measure) => measure.key)).toEqual([
      { fifths: 1, mode: 'major' },
      null,
      { fifths: -3, mode: null },
    ]);
  });

  it('divisions は宣言以降の小節へ持続する', () => {
    const xml = partwise(
      `<score-part id="P1"/>`,
      `<part id="P1">
         <measure number="1">
           <attributes><divisions>8</divisions></attributes>
           <note><rest/><duration>8</duration></note>
           ${note('C', 4, 8)}
         </measure>
         <measure number="2">
           <note><rest/><duration>8</duration></note>
           ${note('D', 4, 8)}
         </measure>
       </part>`,
    );
    const measures = parseMusicXml(xml).parts[0]?.measures ?? [];
    expect(measures[1]?.notes[0]?.offset).toBe(8);
  });

  it('多譜表パートの staff 番号を抽出する（なければ null）', () => {
    const xml = partwise(
      `<score-part id="P1"/>`,
      `<part id="P1"><measure number="1">
         <note><pitch><step>C</step><octave>5</octave></pitch>
           <duration>4</duration><staff>1</staff></note>
         <note><pitch><step>C</step><octave>3</octave></pitch>
           <duration>4</duration><staff>2</staff></note>
         ${note('G', 4, 4)}
       </measure></part>`,
    );
    const notes = parseMusicXml(xml).parts[0]?.measures[0]?.notes ?? [];
    expect(notes.map((event) => event.staff)).toEqual([1, 2, null]);
  });

  it('pitch 要素はあるが step が不正・octave 欠落の音符は除外する', () => {
    const xml = partwise(
      `<score-part id="P1"/>`,
      `<part id="P1"><measure number="1">
         <note><pitch><step>H</step><octave>4</octave></pitch><duration>4</duration></note>
         <note><pitch><step>C</step></pitch><duration>4</duration></note>
         ${note('D', 4, 4)}
       </measure></part>`,
    );
    const notes = parseMusicXml(xml).parts[0]?.measures[0]?.notes ?? [];
    // 不正 step（H）と octave 欠落は notes から除外され、正常な D のみ残る
    expect(notes.map((event) => event.pitch.step)).toEqual(['D']);
  });

  it('score-partwise 以外のルート要素は ScoreParseError で失敗する', () => {
    expect(() => parseMusicXml('<score-timewise/>')).toThrowError(ScoreParseError);
  });

  it('id のない part 要素は ScoreParseError で失敗する', () => {
    const xml = partwise(`<score-part id="P1"/>`, `<part><measure number="1"/></part>`);
    expect(() => parseMusicXml(xml)).toThrowError(ScoreParseError);
  });
});

describe('parseMusicXml の段レイアウト抽出', () => {
  /** number 番の小節（print 属性つき）を組み立てる */
  const measure = (number: number, print = ''): string =>
    `<measure number="${number}">${print}</measure>`;
  const newSystem = '<print new-system="yes"/>';
  const newPage = '<print new-page="yes"/>';

  it('new-system / new-page から ページ→段→小節数 を導出する', () => {
    const xml = partwise(
      `<score-part id="P1"/>`,
      `<part id="P1">
         ${measure(1)}${measure(2)}
         ${measure(3, newSystem)}${measure(4)}${measure(5)}
         ${measure(6, newPage)}${measure(7)}
       </part>`,
    );
    expect(parseMusicXml(xml).layout).toEqual([
      { pageIndex: 0, systemIndex: 0, firstMeasureIndex: 0, measureCount: 2 },
      { pageIndex: 0, systemIndex: 1, firstMeasureIndex: 2, measureCount: 3 },
      { pageIndex: 1, systemIndex: 0, firstMeasureIndex: 5, measureCount: 2 },
    ]);
  });

  it('print を持たない MusicXML は 1 ページ・1 段・全小節になる', () => {
    const xml = partwise(
      `<score-part id="P1"/>`,
      `<part id="P1">${measure(1)}${measure(2)}${measure(3)}</part>`,
    );
    expect(parseMusicXml(xml).layout).toEqual([
      { pageIndex: 0, systemIndex: 0, firstMeasureIndex: 0, measureCount: 3 },
    ]);
  });

  it('先頭小節の print は空の段を作らない', () => {
    const xml = partwise(
      `<score-part id="P1"/>`,
      `<part id="P1">${measure(1, newPage)}${measure(2)}</part>`,
    );
    expect(parseMusicXml(xml).layout).toEqual([
      { pageIndex: 0, systemIndex: 0, firstMeasureIndex: 0, measureCount: 2 },
    ]);
  });

  it('小節数が最大のパートからレイアウトを導出する（末尾が欠けたパートに引きずられない）', () => {
    const xml = partwise(
      `<score-part id="P1"/><score-part id="P2"/>`,
      `<part id="P1">${measure(1)}${measure(2, newSystem)}</part>
       <part id="P2">${measure(1)}${measure(2, newSystem)}${measure(3)}</part>`,
    );
    // P1 基準なら最終段は 1 小節。P2（最大）基準では 2 小節になる
    expect(parseMusicXml(xml).layout).toEqual([
      { pageIndex: 0, systemIndex: 0, firstMeasureIndex: 0, measureCount: 1 },
      { pageIndex: 0, systemIndex: 1, firstMeasureIndex: 1, measureCount: 2 },
    ]);
  });

  it('part が 1 つもない場合はレイアウトが空になる', () => {
    expect(parseMusicXml(partwise('', '')).layout).toEqual([]);
  });
});
