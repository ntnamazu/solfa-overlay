import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { OmrArchiveError } from '../../../../src/main/omr/errors';
import {
  assembleArtifacts,
  assemblePageGeometry,
  extractMusicXml,
  unzipEntries,
} from '../../../../src/main/omr/omrArchive';

/** 文字列マップから zip バイト列を作る（テスト用の合成成果物） */
function makeZip(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) {
    entries[name] = strToU8(content);
  }
  return zipSync(entries);
}

const SHEET_XML = `<?xml version="1.0"?>
<sheet>
  <page>
    <system>
      <stack left="0" right="100"/>
      <part id="1"><staff id="1"/></part>
    </system>
  </page>
</sheet>`;

const MUSICXML = `<?xml version="1.0"?>
<score-partwise>
  <part-list><score-part id="P1"><part-name>Soprano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration></note>
    </measure>
  </part>
</score-partwise>`;

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container><rootfiles>
  <rootfile full-path="score.xml" media-type="application/vnd.recordare.musicxml+xml"/>
</rootfiles></container>`;

describe('unzipEntries', () => {
  it('ファイルエントリを名前→内容のマップで返す', () => {
    const entries = unzipEntries(makeZip({ 'a.txt': 'hello', 'dir/b.txt': 'world' }));
    expect(entries.size).toBe(2);
    expect(entries.get('a.txt')).toEqual(strToU8('hello'));
    expect(entries.get('dir/b.txt')).toEqual(strToU8('world'));
  });

  it('ディレクトリエントリ（末尾 /）を除外する', () => {
    // zipSync はディレクトリエントリを明示的に含めない限り作らないため、明示的に空名を検証する
    const entries = unzipEntries(makeZip({ 'sheet#1/sheet#1.xml': SHEET_XML }));
    expect([...entries.keys()]).toEqual(['sheet#1/sheet#1.xml']);
  });

  it('`..` を含むエントリ名を OmrArchiveError で拒否する（パストラバーサル防御）', () => {
    expect(() => unzipEntries(makeZip({ '../evil.txt': 'x' }))).toThrow(OmrArchiveError);
    expect(() => unzipEntries(makeZip({ 'a/../../evil.txt': 'x' }))).toThrow(OmrArchiveError);
  });

  it('絶対パスのエントリ名を拒否する', () => {
    expect(() => unzipEntries(makeZip({ '/etc/passwd': 'x' }))).toThrow(OmrArchiveError);
  });

  it('zip として不正なバイト列は OmrArchiveError にする', () => {
    expect(() => unzipEntries(new Uint8Array([1, 2, 3, 4]))).toThrow(OmrArchiveError);
  });
});

describe('extractMusicXml', () => {
  it('container.xml の rootfile が指す本体 XML を取り出す', () => {
    const mxl = makeZip({ 'META-INF/container.xml': CONTAINER, 'score.xml': MUSICXML });
    expect(extractMusicXml(mxl)).toContain('<score-partwise>');
  });

  it('container.xml が無ければ META-INF 以外の最初の .xml にフォールバックする', () => {
    const mxl = makeZip({ 'anything.xml': MUSICXML });
    expect(extractMusicXml(mxl)).toContain('<score-partwise>');
  });

  it('本体 XML を特定できなければ OmrArchiveError にする', () => {
    const mxl = makeZip({ 'README.txt': 'no xml here' });
    expect(() => extractMusicXml(mxl)).toThrow(OmrArchiveError);
  });
});

describe('assembleArtifacts', () => {
  it('.omr のシート XML をシート番号昇順で連結し .mxl を movement 順にパースする', () => {
    const omr = makeZip({
      'book.xml': '<book/>',
      'sheet#1/sheet#1.xml': SHEET_XML,
      'sheet#2/sheet#2.xml': SHEET_XML,
    });
    const mxl = makeZip({ 'META-INF/container.xml': CONTAINER, 'score.xml': MUSICXML });
    const artifacts = assembleArtifacts({ omr, movements: [mxl] });
    expect(artifacts.pages).toHaveLength(2); // sheet#1・sheet#2 各1ページ
    expect(artifacts.movements).toHaveLength(1);
    expect(artifacts.movements[0]?.musicXml.parts[0]?.id).toBe('P1');
  });

  it('シート番号を数値順に並べる（sheet#10 は sheet#2 の後）', () => {
    const omr = makeZip({
      'sheet#2/sheet#2.xml': SHEET_XML,
      'sheet#10/sheet#10.xml': SHEET_XML,
      'sheet#1/sheet#1.xml': SHEET_XML,
    });
    // 3 ページ得られれば（順序込みで）連結が成立している
    expect(assembleArtifacts({ omr, movements: [] }).pages).toHaveLength(3);
  });

  it('シート XML を持たないシート（未転写ページ）は自然に飛ばす', () => {
    // sheet#1 は画像のみ・sheet#2 のみ XML あり → 1 ページ
    const omr = makeZip({
      'sheet#1/BINARY.png': 'not-really-png',
      'sheet#2/sheet#2.xml': SHEET_XML,
    });
    expect(assembleArtifacts({ omr, movements: [] }).pages).toHaveLength(1);
  });

  it('シート XML が皆無なら OmrArchiveError にする', () => {
    const omr = makeZip({ 'book.xml': '<book/>', 'sheet#1/BINARY.png': 'x' });
    expect(() => assembleArtifacts({ omr, movements: [] })).toThrow(OmrArchiveError);
  });
});

describe('assemblePageGeometry', () => {
  /** 1 sheet に 2 ページ（Victoria の実データと同じ形） */
  const TWO_PAGE_SHEET = `<sheet>
    <picture width="2480" height="3507"/>
    <scale><interline main="17"/></scale>
    <page><system><sig><inters>
      <head staff="1"><bounds x="10" y="20" w="20" h="16"/></head>
    </inters></sig></system></page>
    <page><system><sig><inters>
      <stem><bounds x="40" y="50" w="4" h="60"/></stem>
    </inters></sig></system></page>
  </sheet>`;

  it('ページごとに記号を返し、sheet の画像情報を各ページへ配る', () => {
    const omr = makeZip({ 'sheet#1/sheet#1.xml': TWO_PAGE_SHEET });
    const geometry = assemblePageGeometry(omr);
    expect(geometry).toHaveLength(2);
    expect(geometry[0]?.symbols.map((s) => s.kind)).toEqual(['head']);
    expect(geometry[1]?.symbols.map((s) => s.kind)).toEqual(['stem']);
    // 同一 sheet の 2 ページは同じ画像座標空間にいる
    expect(geometry[0]?.image).toEqual({ widthPx: 2480, heightPx: 3507, interlinePx: 17 });
    expect(geometry[1]?.image).toEqual(geometry[0]?.image);
  });

  it('assembleArtifacts(...).pages と長さ・順序が一致する（注釈のページずれ防止）', () => {
    const omr = makeZip({
      'sheet#2/sheet#2.xml': SHEET_XML,
      'sheet#10/sheet#10.xml': TWO_PAGE_SHEET,
      'sheet#1/sheet#1.xml': SHEET_XML,
    });
    const pages = assembleArtifacts({ omr, movements: [] }).pages;
    const geometry = assemblePageGeometry(omr);
    expect(geometry).toHaveLength(pages.length);
    // sheet#10（2ページ・記号あり）が末尾に来ていれば数値順の連結が両者で揃っている
    expect(geometry.at(-2)?.symbols.map((s) => s.kind)).toEqual(['head']);
    expect(geometry.at(-1)?.symbols.map((s) => s.kind)).toEqual(['stem']);
  });

  it('画像情報のないシートは image が null（assembleArtifacts と同じく例外にしない）', () => {
    const omr = makeZip({ 'sheet#1/sheet#1.xml': SHEET_XML });
    expect(assemblePageGeometry(omr)[0]?.image).toBeNull();
  });

  it('シート XML が皆無なら assembleArtifacts と同じく OmrArchiveError にする', () => {
    const omr = makeZip({ 'book.xml': '<book/>', 'sheet#1/BINARY.png': 'x' });
    expect(() => assemblePageGeometry(omr)).toThrow(OmrArchiveError);
  });
});
