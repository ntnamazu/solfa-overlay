import { describe, expect, it } from 'vitest';
import { ScoreParseError } from '../../../../src/domain/score/errors';
import {
  groupMovements,
  parseBookXml,
  parseSheetXml,
} from '../../../../src/domain/score/OmrSheetParser';

/** プロトタイプで実証した sheet XML 構造を模したテスト文書 */
const SHEET_XML = `<?xml version="1.0" encoding="UTF-8"?>
<sheet number="1">
  <page>
    <system>
      <stack left="100" right="500"/>
      <stack left="500" right="900"/>
      <part id="1">
        <staff id="11"/>
      </part>
      <part id="2">
        <staff id="12"/>
      </part>
      <sig>
        <inters>
          <clef staff="11" kind="TREBLE"/>
          <clef staff="12" kind="BASS"/>
          <clef staff="11" kind="ALTO"/>
          <head staff="11" pitch="6"><bounds x="400" y="200" w="20" h="16"/></head>
          <head staff="11" pitch="4"><bounds x="150" y="190" w="20" h="16"/></head>
          <head staff="11" pitch="2"><bounds x="600" y="180" w="20" h="16"/></head>
          <head staff="12" pitch="0"><bounds x="160" y="700" w="20" h="16"/></head>
          <head staff="12" pitch="0"/>
        </inters>
      </sig>
    </system>
    <system>
      <stack left="100" right="900"/>
      <part id="1">
        <staff id="21"/>
      </part>
    </system>
  </page>
  <page>
    <system>
      <stack left="100" right="900"/>
      <part id="1">
        <staff id="31"/>
      </part>
    </system>
  </page>
</sheet>`;

describe('parseSheetXml', () => {
  const sheet = parseSheetXml(SHEET_XML);

  it('page / system / stack の構造を抽出する', () => {
    expect(sheet.pages).toHaveLength(2);
    expect(sheet.pages[0]?.systems).toHaveLength(2);
    expect(sheet.pages[0]?.systems[0]?.stacks).toEqual([
      { left: 100, right: 500 },
      { left: 500, right: 900 },
    ]);
  });

  it("譜表は part id から 'P' 付きの partId で対応付ける（= MusicXML の part id）", () => {
    const staves = sheet.pages[0]?.systems[0]?.staves ?? [];
    expect(staves.map((staff) => [staff.partId, staff.staffId])).toEqual([
      ['P1', '11'],
      ['P2', '12'],
    ]);
  });

  it('システム内で最初に現れた clef を採用する（段中の変更は v1 非対応）', () => {
    const staves = sheet.pages[0]?.systems[0]?.staves ?? [];
    expect(staves[0]?.clefKind).toBe('TREBLE');
    expect(staves[1]?.clefKind).toBe('BASS');
  });

  it('clef が検出されていない譜表は clefKind が null になる', () => {
    expect(sheet.pages[0]?.systems[1]?.staves[0]?.clefKind).toBeNull();
  });

  it('符頭は x 昇順に整列される', () => {
    const heads = sheet.pages[0]?.systems[0]?.staves[0]?.heads ?? [];
    expect(heads.map((head) => head.x)).toEqual([150, 400, 600]);
    expect(heads[0]).toEqual({ pitch: 4, x: 150, y: 190, w: 20, h: 16 });
  });

  it('bounds を持たない head は座標が取れないため無視する', () => {
    const heads = sheet.pages[0]?.systems[0]?.staves[1]?.heads ?? [];
    expect(heads).toHaveLength(1);
  });

  it('整形式でない sheet XML は ScoreParseError で失敗する', () => {
    expect(() => parseSheetXml('<sheet><page></sheet>')).toThrowError(ScoreParseError);
  });

  it('数値でない属性・id 欠落・座標欠落の要素を無視して部分結果を返す', () => {
    const xml = `<?xml version="1.0"?>
<sheet number="1">
  <page>
    <system>
      <stack left="100" right="500"/>
      <stack left="abc" right="900"/>
      <part id="1">
        <staff id="11"/>
        <staff/>
      </part>
      <part>
        <staff id="99"/>
      </part>
      <sig>
        <head staff="11" pitch="6"><bounds x="bad" y="1" w="1" h="1"/></head>
        <head staff="11" pitch="4"><bounds x="150" y="190" w="20" h="16"/></head>
      </sig>
    </system>
  </page>
</sheet>`;
    const system = parseSheetXml(xml).pages[0]?.systems[0];
    // left が数値でない stack は取り込まない
    expect(system?.stacks).toEqual([{ left: 100, right: 500 }]);
    // id のない staff / part は無視され、id 付きの P1/11 だけが残る
    expect(system?.staves.map((staff) => [staff.partId, staff.staffId])).toEqual([['P1', '11']]);
    // bounds 座標が数値でない head も無視する
    expect(system?.staves[0]?.heads).toEqual([{ pitch: 4, x: 150, y: 190, w: 20, h: 16 }]);
  });
});

describe('parseBookXml / groupMovements', () => {
  const BOOK_XML = `<book>
    <sheet number="1"><page/></sheet>
    <sheet number="2"><page movement-start="true"/><page/></sheet>
    <sheet number="3"><page/></sheet>
  </book>`;

  it('sheet 番号・sheet 内ページ順・movement-start を抽出する', () => {
    expect(parseBookXml(BOOK_XML)).toEqual([
      { sheetNumber: 1, pageIndexInSheet: 0, movementStart: false },
      { sheetNumber: 2, pageIndexInSheet: 0, movementStart: true },
      { sheetNumber: 2, pageIndexInSheet: 1, movementStart: false },
      { sheetNumber: 3, pageIndexInSheet: 0, movementStart: false },
    ]);
  });

  it('movement-start で分割し、先頭ページは暗黙に movement 1 の開始とする', () => {
    const movements = groupMovements(parseBookXml(BOOK_XML));
    expect(movements).toHaveLength(2);
    expect(movements[0]?.map((page) => page.sheetNumber)).toEqual([1]);
    expect(movements[1]?.map((page) => page.sheetNumber)).toEqual([2, 2, 3]);
  });

  it('movement-start がない場合は全ページが単一 movement になる', () => {
    const movements = groupMovements(
      parseBookXml('<book><sheet number="1"><page/><page/></sheet></book>'),
    );
    expect(movements).toHaveLength(1);
    expect(movements[0]).toHaveLength(2);
  });

  it('ページのない book でも空配列を返す（例外にしない）', () => {
    expect(groupMovements(parseBookXml('<book/>'))).toEqual([]);
  });
});
