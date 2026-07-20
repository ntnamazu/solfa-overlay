import { strFromU8 } from 'fflate';
import { parseMusicXml } from '../../domain/score/MusicXmlParser';
import type { OmrPageContent } from '../../domain/score/OmrSheetParser';
import { parseSheetXml } from '../../domain/score/OmrSheetParser';
import type { OmrArtifacts } from '../../domain/score/ScoreModelBuilder';
import { find, parseXml } from '../../domain/score/xmlTree';
import { ZipError, unzipEntries as unzipSafely } from '../../storage/zipArchive';
import { OmrArchiveError } from './errors';

/**
 * `.omr` / `.mxl`（いずれも zip）の展開と `OmrArtifacts` 組み立て（副作用なしの純粋関数群）
 *
 * ファイル I/O・子プロセスは扱わない（呼び出し側の OmrRunner が読み込んだバイト列を渡す）。
 * domain のパーサ（parseSheetXml / parseMusicXml）へ委譲し、zip 層のみをここに閉じ込める。
 */

/** `.omr` 内のシート XML エントリ（`sheet#N/sheet#N.xml`）を表す正規表現 */
const SHEET_XML_ENTRY = /^sheet#(\d+)\/sheet#\d+\.xml$/;

/**
 * zip バイト列を展開し、エントリ名 → 内容のマップを返す
 *
 * 展開とエントリ名の検証（パストラバーサル拒否）は `storage/zipArchive` に集約されており、
 * ここでは OMR 層のエラー分類（`OmrArchiveError`）へ翻訳するだけに徹する。
 * `.omr` / `.mxl` と `.solfaproj` で防御が食い違わないようにするための構成
 *
 * @throws OmrArchiveError 展開に失敗、またはパストラバーサルなエントリを含む場合
 */
export function unzipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  try {
    return unzipSafely(bytes);
  } catch (cause) {
    if (cause instanceof ZipError) {
      throw new OmrArchiveError(cause.message, { cause });
    }
    /* v8 ignore next -- unzipSafely は ZipError 以外を投げない */
    throw cause;
  }
}

/** UTF-8 バイト列を文字列へ復号する（先頭 BOM は除去） */
function decodeXml(data: Uint8Array): string {
  const text = strFromU8(data);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * `.mxl`（MusicXML の OPC zip）から本体 MusicXML 文字列を取り出す
 *
 * `META-INF/container.xml` の rootfile が本体を指す（OPC 仕様）。これを優先し、無ければ
 * `META-INF` 以外の最初の `.xml` にフォールバックする（プロトタイプと同方針）。
 *
 * @throws OmrArchiveError 本体 XML を特定できない場合
 */
export function extractMusicXml(mxlBytes: Uint8Array): string {
  const entries = unzipEntries(mxlBytes);
  const container = entries.get('META-INF/container.xml');
  if (container !== undefined) {
    // container.xml は OPC マニフェスト（本体 MusicXML ではない）。ScoreParseSource に専用値が
    // ないため、.mxl の一部として最も近い 'musicxml' を割り当てる（不正時のエラー表示は概略）
    const rootfile = find(parseXml(decodeXml(container), 'musicxml'), 'rootfiles/rootfile');
    const fullPath = rootfile?.attrs['full-path'];
    const body = fullPath === undefined ? undefined : entries.get(fullPath);
    if (body !== undefined) {
      return decodeXml(body);
    }
  }
  for (const [name, data] of entries) {
    if (!name.startsWith('META-INF/') && name.toLowerCase().endsWith('.xml')) {
      return decodeXml(data);
    }
  }
  throw new OmrArchiveError('.mxl から本体 MusicXML を特定できませんでした');
}

/**
 * `.omr` バイト列と movement 順の `.mxl` バイト列群から `OmrArtifacts` を組み立てる
 *
 * - `.omr`: `sheet#N/sheet#N.xml` を N 昇順に parseSheetXml し、ページ列を連結する
 *   （シート XML を持たないシート＝未転写ページは自然に飛ばされる）
 * - `.mxl`: 与えられた movement 順に本体 MusicXML を取り出し parseMusicXml する
 *
 * book.xml による movement→ページ対応の解決は BookStructureResolver（別フェーズ）の責務のため、
 * ここでは行わない（呼び出し側が ResolvedStructure を別途与える）。
 *
 * @throws OmrArchiveError zip 展開失敗・シート XML 欠落
 * @throws ScoreParseError XML が整形式でない場合（domain パーサ由来）
 */
export function assembleArtifacts(input: {
  omr: Uint8Array;
  movements: Uint8Array[];
}): OmrArtifacts {
  const omrEntries = unzipEntries(input.omr);
  const sheetNames = [...omrEntries.keys()]
    .filter((name) => SHEET_XML_ENTRY.test(name))
    .sort((a, b) => sheetNumberOf(a) - sheetNumberOf(b));
  if (sheetNames.length === 0) {
    throw new OmrArchiveError('.omr にシート XML（sheet#N/sheet#N.xml）が見つかりません');
  }
  const pages: OmrPageContent[] = [];
  for (const name of sheetNames) {
    const data = omrEntries.get(name);
    /* v8 ignore next -- name は omrEntries のキー由来のため必ず存在する */
    if (data === undefined) continue;
    pages.push(...parseSheetXml(decodeXml(data)).pages);
  }
  const movements = input.movements.map((mxl) => ({
    musicXml: parseMusicXml(extractMusicXml(mxl)),
  }));
  return { movements, pages };
}

/** `sheet#N/sheet#N.xml` からシート番号 N を取り出す（SHEET_XML_ENTRY 一致済み前提） */
function sheetNumberOf(entryName: string): number {
  const match = SHEET_XML_ENTRY.exec(entryName);
  /* v8 ignore next -- 呼び出し前に test 済みのため match は必ず成功する */
  return match === null ? 0 : Number.parseInt(match[1] ?? '', 10);
}
