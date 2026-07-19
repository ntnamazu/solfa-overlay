import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { ScoreParseSource } from './errors';
import { ScoreParseError } from './errors';

/**
 * 文書順を保持した XML 要素ツリー（Python ElementTree 相当の最小 API）
 *
 * fast-xml-parser の既定モードは同名タグをグルーピングして出現順を失うため、
 * preserveOrder の出力をこの形に変換して使う（MusicXML の note / backup / forward の
 * 出現順がオフセット計算に不可欠）
 */
export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** 直下のテキスト（trim 済み・連結） */
  text: string;
}

/** preserveOrder モードのノード表現（fast-xml-parser 内部形式） */
type OrderedNode = Record<string, unknown>;

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  // 数値らしき文字列の自動変換はしない（'012' の桁落ち等を避け、呼び出し側で明示的に解釈する）
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

function toElement(name: string, body: unknown, attrsRaw: unknown): XmlElement {
  const attrs: Record<string, string> = {};
  if (attrsRaw !== null && typeof attrsRaw === 'object') {
    for (const [key, value] of Object.entries(attrsRaw)) {
      attrs[key] = String(value);
    }
  }
  const children: XmlElement[] = [];
  const texts: string[] = [];
  if (Array.isArray(body)) {
    for (const node of body as OrderedNode[]) {
      if ('#text' in node) {
        texts.push(String(node['#text']));
        continue;
      }
      const childName = Object.keys(node).find((key) => key !== ':@');
      if (childName === undefined || childName.startsWith('?')) {
        continue; // 処理命令（<?...?>）等は要素として扱わない
      }
      children.push(toElement(childName, node[childName], node[':@']));
    }
  }
  return { name, attrs, children, text: texts.join('').trim() };
}

/**
 * XML 文字列をパースしてルート要素を返す
 *
 * @param xml - XML 文字列（Audiveris 出力）
 * @param source - エラー報告用の成果物種別
 * @throws ScoreParseError 整形式でない・ルート要素がない場合
 */
export function parseXml(xml: string, source: ScoreParseSource): XmlElement {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new ScoreParseError(`XML が整形式ではありません: ${validation.err.msg}`, source);
  }
  const nodes = parser.parse(xml) as OrderedNode[];
  for (const node of nodes) {
    const name = Object.keys(node).find((key) => key !== ':@');
    if (name !== undefined && !name.startsWith('?')) {
      return toElement(name, node[name], node[':@']);
    }
  }
  /* v8 ignore next -- validate 済みの整形式 XML は必ずルート要素を持つため到達しない防御ガード */
  throw new ScoreParseError('ルート要素が見つかりません', source);
}

/** 直下の子要素からパス（'/' 区切り）で最初の要素を探す。見つからなければ null */
export function find(element: XmlElement, path: string): XmlElement | null {
  let current: XmlElement | null = element;
  for (const name of path.split('/')) {
    current = current.children.find((child) => child.name === name) ?? null;
    if (current === null) {
      return null;
    }
  }
  return current;
}

/** 直下の子要素から名前が一致するものをすべて返す */
export function findAll(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter((child) => child.name === name);
}

/** パス先要素のテキストを返す。要素がなければ null */
export function findText(element: XmlElement, path: string): string | null {
  return find(element, path)?.text ?? null;
}

/** 属性値を返す。なければ null */
export function attr(element: XmlElement, name: string): string | null {
  return element.attrs[name] ?? null;
}

/** 要素以下（自身を含む）を文書順で深さ優先に列挙する */
export function* descendants(element: XmlElement): Generator<XmlElement> {
  yield element;
  for (const child of element.children) {
    yield* descendants(child);
  }
}
