import type { XmlElement } from './xmlTree';
import { attr, descendants, find, findAll, findText, parseXml } from './xmlTree';

/** sheet XML（.omr 内の sheet#N/sheet#N.xml）1ファイル分のパース結果 */
export interface OmrSheetContent {
  pages: OmrPageContent[];
}

/** 1ページ分の物理構造（座標はすべて 300dpi 画像ピクセル） */
export interface OmrPageContent {
  systems: OmrSystem[];
}

export interface OmrSystem {
  /** 小節の水平範囲（stack）。譜表を縦断して共通 */
  stacks: OmrStack[];
  /** 上から順の譜表列 */
  staves: OmrStaff[];
}

export interface OmrStack {
  left: number;
  right: number;
}

export interface OmrStaff {
  /** 'P' + part@id（= MusicXML の part id = book.xml の logical-id） */
  partId: string;
  staffId: string;
  /** システム内で最初に現れた clef の kind（Audiveris 表記）。なければ null */
  clefKind: string | null;
  /** 符頭列（x 昇順） */
  heads: OmrHead[];
}

export interface OmrHead {
  /** 譜表位置（中線=0・下向き正。Audiveris 仕様） */
  pitch: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** book.xml のページ参照（movement 分割の材料） */
export interface BookPageRef {
  sheetNumber: number;
  /** sheet 内のページ順（0始まり） */
  pageIndexInSheet: number;
  movementStart: boolean;
  /**
   * この sheet の取り込み元となった元PDFのページ番号（1始まり）
   *
   * book.xml の `<sheet><input><number>`。**sheet 番号と一致するとは限らない**
   * （Audiveris が入力の一部だけを処理した場合など）。注釈をどの PDF ページへ描くかの正となる
   */
  sourcePageNumber: number;
}

/**
 * 注釈配置で避ける記号 1 つ（座標は `.omr` の 300dpi 画像ピクセル）
 *
 * 配置側が種別ごとの扱いを決められるよう、`kind` は sheet XML の要素名をそのまま持つ
 * （細い線＝符幹・加線は重なっても判読を妨げないため、`placementResolver` が除外する）
 */
export interface OmrSymbol {
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * sheet 単位の画像情報
 *
 * **同一 sheet の全ページが同じ画像座標空間を共有する**（Audiveris は 1 枚の画像の中で
 * movement 境界を検出するとページを分ける）。したがってページごとではなく sheet ごとに持つ
 */
export interface SheetImage {
  widthPx: number;
  heightPx: number;
  /** 譜線間隔。注釈のフォントサイズ・オフセットの基準（Victoria 17 / divisi 16） */
  interlinePx: number;
}

/** sheet 1 枚分の描画幾何（`parseSheetXml` と同じページ順・同じ長さ） */
export interface SheetGeometry {
  /** `<picture>` か `<scale><interline>` が欠けていれば null（幾何情報なしとして扱う） */
  image: SheetImage | null;
  pages: { symbols: OmrSymbol[] }[];
}

/**
 * ページ 1 枚分の描画幾何（曲全体のページ順に並べて使う）
 *
 * `image` は sheet 単位の情報を各ページへ配ったもの。同一 sheet のページ同士は
 * 同じ値を共有する（同じ画像座標空間にいるため）
 */
export interface PageGeometry {
  image: SheetImage | null;
  symbols: OmrSymbol[];
}

/**
 * 注釈と重なると判読を妨げる**葉の記号**の要素名
 *
 * `head-chord` / `rest-chord` / `beam-group` / `staff-barline` などの**集約要素は入れない**。
 * これらの `<bounds>` は和音や段全体を覆う広い矩形で、障害物として扱うと
 * 譜面の大半が「埋まっている」ことになり配置が破綻する
 */
const SYMBOL_KINDS: ReadonlySet<string> = new Set([
  'head',
  'stem',
  'flag',
  'beam',
  'ledger',
  'slur',
  'alter',
  'key-alter',
  'key',
  'clef',
  'rest',
  'barline',
  'articulation',
  'augmentation-dot',
  'ornament',
  'tuplet',
  'octave-shift',
  'caesura',
  'bracket',
  'time-whole',
]);

function parseIntAttr(element: XmlElement, name: string): number | null {
  const text = attr(element, name);
  if (text === null) {
    return null;
  }
  const value = Number.parseInt(text, 10);
  return Number.isNaN(value) ? null : value;
}

function parseSystem(systemElement: XmlElement): OmrSystem {
  const stacks: OmrStack[] = [];
  for (const stackElement of findAll(systemElement, 'stack')) {
    const left = parseIntAttr(stackElement, 'left');
    const right = parseIntAttr(stackElement, 'right');
    if (left !== null && right !== null) {
      stacks.push({ left, right });
    }
  }

  // inter（clef / head）は格納場所が入れ子になり得るため、システム配下を文書順で総なめする
  const staffClef = new Map<string, string>();
  const headsByStaff = new Map<string, OmrHead[]>();
  for (const element of descendants(systemElement)) {
    if (element.name === 'clef') {
      const staffId = attr(element, 'staff');
      const kind = attr(element, 'kind');
      // 段中の音部記号変更は v1 非対応: 最初に現れた clef を段全体に適用する（プロトタイプと同じ制約）
      if (staffId !== null && kind !== null && !staffClef.has(staffId)) {
        staffClef.set(staffId, kind);
      }
    } else if (element.name === 'head') {
      const staffId = attr(element, 'staff');
      const pitch = parseIntAttr(element, 'pitch');
      const bounds = find(element, 'bounds');
      if (staffId === null || pitch === null || bounds === null) {
        continue; // bounds を持たない head は座標が取れないため無視（プロトタイプと同じ）
      }
      const x = parseIntAttr(bounds, 'x');
      const y = parseIntAttr(bounds, 'y');
      const w = parseIntAttr(bounds, 'w');
      const h = parseIntAttr(bounds, 'h');
      if (x === null || y === null || w === null || h === null) {
        continue;
      }
      const heads = headsByStaff.get(staffId) ?? [];
      heads.push({ pitch, x, y, w, h });
      headsByStaff.set(staffId, heads);
    }
  }

  const staves: OmrStaff[] = [];
  for (const partElement of findAll(systemElement, 'part')) {
    const partId = attr(partElement, 'id');
    if (partId === null) {
      continue;
    }
    for (const staffElement of findAll(partElement, 'staff')) {
      const staffId = attr(staffElement, 'id');
      if (staffId === null) {
        continue;
      }
      staves.push({
        partId: `P${partId}`,
        staffId,
        clefKind: staffClef.get(staffId) ?? null,
        heads: (headsByStaff.get(staffId) ?? []).slice().sort((a, b) => a.x - b.x),
      });
    }
  }
  return { stacks, staves };
}

/**
 * .omr 内の sheet XML をパースする（1ファイルに複数ページがあり得る）
 *
 * zip（.omr）の展開・ファイル I/O は行わない（編成レイヤーが展開済みの XML 文字列を渡す）
 *
 * @throws ScoreParseError 整形式でない場合
 */
export function parseSheetXml(xml: string): OmrSheetContent {
  const root = parseXml(xml, 'sheet');
  return {
    pages: findAll(root, 'page').map((pageElement) => ({
      systems: findAll(pageElement, 'system').map(parseSystem),
    })),
  };
}

/**
 * book.xml をパースして sheet／ページ列を movement 分割情報付きで返す
 *
 * **sheet は番号の昇順に並べ直す。** 呼び出し側（`buildPageInfos`）はこの戻り値と
 * `assemblePageGeometry` の結果を**配列添字で 1 対 1 に対応づける**が、後者は
 * `.omr` のシート XML を番号昇順に読んでいる。book.xml の文書順が番号順と違うと、
 * あるシートの画像寸法と別のシートの元PDFページ番号が結び付き、注釈が誤ったページへ
 * 誤った縮尺で描かれる（例外にも issue にもならず気づけない）
 *
 * @throws ScoreParseError 整形式でない場合
 */
export function parseBookXml(xml: string): BookPageRef[] {
  const root = parseXml(xml, 'book');
  const pages: BookPageRef[] = [];
  const sheetElements = findAll(root, 'sheet')
    .map((element, documentOrder) => ({
      element,
      // number 属性がない sheet は文書順を番号とみなす（元の実装と同じ既定）
      number: parseIntAttr(element, 'number') ?? documentOrder + 1,
    }))
    .sort((a, b) => a.number - b.number);

  for (const { element: sheetElement, number: sheetNumber } of sheetElements) {
    // `<input><number>` が元PDFのページ番号。古い book.xml には無いことがあるため、
    // その場合は sheet 番号で代替する（1 sheet = 1 ページの通常ケースでは一致する）
    const inputNumber = findText(sheetElement, 'input/number');
    const parsed = inputNumber === null ? Number.NaN : Number.parseInt(inputNumber, 10);
    const sourcePageNumber = Number.isNaN(parsed) ? sheetNumber : parsed;
    findAll(sheetElement, 'page').forEach((pageElement, pageIndexInSheet) => {
      pages.push({
        sheetNumber,
        pageIndexInSheet,
        movementStart: attr(pageElement, 'movement-start') === 'true',
        sourcePageNumber,
      });
    });
  }
  return pages;
}

/** `<bounds x y w h>` を読む（1 つでも欠けたら座標が定まらないため null） */
function parseBounds(element: XmlElement): { x: number; y: number; w: number; h: number } | null {
  const bounds = find(element, 'bounds');
  if (bounds === null) {
    return null;
  }
  const x = parseIntAttr(bounds, 'x');
  const y = parseIntAttr(bounds, 'y');
  const w = parseIntAttr(bounds, 'w');
  const h = parseIntAttr(bounds, 'h');
  if (x === null || y === null || w === null || h === null) {
    return null;
  }
  return { x, y, w, h };
}

/**
 * sheet XML から注釈配置に使う描画幾何を取り出す
 *
 * `parseSheetXml`（照合に使う論理構造）とは**別の関数**にしてある。記号の矩形は
 * `ScoreModelBuilder` には一切不要で、`OmrPageContent` に足すと照合のテストが
 * 本題と無関係なデータを抱えることになるため
 *
 * @throws ScoreParseError 整形式でない場合
 */
export function parseSheetGeometry(xml: string): SheetGeometry {
  const root = parseXml(xml, 'sheet');

  const picture = find(root, 'picture');
  const interlineElement = find(root, 'scale/interline');
  const widthPx = picture === null ? null : parseIntAttr(picture, 'width');
  const heightPx = picture === null ? null : parseIntAttr(picture, 'height');
  const interlinePx = interlineElement === null ? null : parseIntAttr(interlineElement, 'main');
  // 3 つ揃わないと座標変換もオフセット計算もできない。欠けた値を既定値で補うと
  // 「それらしいが正しくない位置」に描くことになるため、幾何情報なしとして扱う
  const image: SheetImage | null =
    widthPx === null || heightPx === null || interlinePx === null
      ? null
      : { widthPx, heightPx, interlinePx };

  const pages = findAll(root, 'page').map((pageElement) => {
    const symbols: OmrSymbol[] = [];
    for (const element of descendants(pageElement)) {
      if (!SYMBOL_KINDS.has(element.name)) {
        continue;
      }
      const bounds = parseBounds(element);
      if (bounds !== null) {
        symbols.push({ kind: element.name, ...bounds });
      }
    }
    return { symbols };
  });

  return { image, pages };
}

/**
 * ページ列を movement ごとに分割する（先頭ページは暗黙に movement 1 の開始）
 *
 * インチピット等で曲が複数 movement に誤分割された場合、Audiveris は movement ごとに
 * MusicXML を出力するため、照合はこの分割単位で行う（プロトタイプで実証済み）
 */
export function groupMovements(pages: BookPageRef[]): BookPageRef[][] {
  const movements: BookPageRef[][] = [];
  for (const page of pages) {
    if (page.movementStart || movements.length === 0) {
      movements.push([]);
    }
    movements[movements.length - 1]?.push(page);
  }
  return movements;
}
