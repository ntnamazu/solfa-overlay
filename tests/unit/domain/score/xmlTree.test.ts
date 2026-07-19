import { describe, expect, it } from 'vitest';
import { ScoreParseError } from '../../../../src/domain/score/errors';
import {
  attr,
  descendants,
  find,
  findAll,
  findText,
  parseXml,
} from '../../../../src/domain/score/xmlTree';

describe('parseXml', () => {
  it('XML宣言・DOCTYPE付きの文書からルート要素を取り出す', () => {
    const root = parseXml(
      `<?xml version="1.0" encoding="UTF-8"?>
       <!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN"
         "http://www.musicxml.org/dtds/partwise.dtd">
       <score-partwise version="4.0"><part id="P1"/></score-partwise>`,
      'musicxml',
    );
    expect(root.name).toBe('score-partwise');
    expect(attr(root, 'version')).toBe('4.0');
  });

  it('同名タグが混在しても子要素の文書順を保持する', () => {
    const root = parseXml('<m><note>a</note><backup/><note>b</note></m>', 'musicxml');
    expect(root.children.map((child) => child.name)).toEqual(['note', 'backup', 'note']);
  });

  it('実体参照を復号したテキストを返す', () => {
    const root = parseXml('<part-name>Alt &amp; Ten</part-name>', 'musicxml');
    expect(root.text).toBe('Alt & Ten');
  });

  it('属性値は数値変換せず文字列のまま返す', () => {
    const root = parseXml('<staff id="012"/>', 'sheet');
    expect(attr(root, 'id')).toBe('012');
    expect(attr(root, 'missing')).toBeNull();
  });

  it('整形式でないXMLは ScoreParseError(source付き) で失敗する', () => {
    expect(() => parseXml('<a><b></a>', 'sheet')).toThrowError(ScoreParseError);
    try {
      parseXml('<a><b></a>', 'sheet');
    } catch (error) {
      expect((error as ScoreParseError).source).toBe('sheet');
    }
  });

  it('要素を含まない文書は ScoreParseError で失敗する', () => {
    expect(() => parseXml('<?xml version="1.0"?>', 'book')).toThrowError(ScoreParseError);
  });

  it('要素内の処理命令（<?...?>）は子要素として扱わない', () => {
    const root = parseXml('<sys><?target data?><stack/></sys>', 'sheet');
    expect(root.children.map((child) => child.name)).toEqual(['stack']);
  });
});

describe('find / findAll / findText', () => {
  const root = parseXml(
    `<note>
       <pitch><step>F</step><alter>1</alter><octave>4</octave></pitch>
       <beam number="1">begin</beam>
       <beam number="2">begin</beam>
     </note>`,
    'musicxml',
  );

  it("スラッシュ区切りのパスで子孫要素を辿れる('pitch/step')", () => {
    expect(findText(root, 'pitch/step')).toBe('F');
    expect(find(root, 'pitch/step')?.name).toBe('step');
  });

  it('存在しないパスは null を返す', () => {
    expect(find(root, 'rest')).toBeNull();
    expect(findText(root, 'pitch/missing')).toBeNull();
  });

  it('findAll は直下の同名要素をすべて返す（深い探索はしない）', () => {
    expect(findAll(root, 'beam')).toHaveLength(2);
    expect(findAll(root, 'step')).toHaveLength(0);
  });
});

describe('descendants', () => {
  it('自身を含む全要素を文書順で列挙する', () => {
    const root = parseXml('<sys><part><staff/></part><stack/></sys>', 'sheet');
    const names = [...descendants(root)].map((element) => element.name);
    expect(names).toEqual(['sys', 'part', 'staff', 'stack']);
  });
});
