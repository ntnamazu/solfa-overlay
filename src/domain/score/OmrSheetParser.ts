import type { XmlElement } from './xmlTree';
import { attr, descendants, find, findAll, parseXml } from './xmlTree';

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
}

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
 * @throws ScoreParseError 整形式でない場合
 */
export function parseBookXml(xml: string): BookPageRef[] {
  const root = parseXml(xml, 'book');
  const pages: BookPageRef[] = [];
  for (const sheetElement of findAll(root, 'sheet')) {
    const sheetNumber = parseIntAttr(sheetElement, 'number') ?? pages.length + 1;
    findAll(sheetElement, 'page').forEach((pageElement, pageIndexInSheet) => {
      pages.push({
        sheetNumber,
        pageIndexInSheet,
        movementStart: attr(pageElement, 'movement-start') === 'true',
      });
    });
  }
  return pages;
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
