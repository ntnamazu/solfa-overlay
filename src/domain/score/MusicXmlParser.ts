import type { Pitch, PitchStep } from '../../shared/types/Pitch';
import { ScoreParseError } from './errors';
import type { XmlElement } from './xmlTree';
import { attr, find, findAll, findText, parseXml } from './xmlTree';

/** MusicXML から抽出した論理情報（1ファイル = Audiveris の 1 movement） */
export interface ParsedMusicXml {
  parts: MusicXmlPart[];
}

export interface MusicXmlPart {
  /** MusicXML part id（= book.xml logical-id。sheet XML の part id と対応する） */
  id: string;
  name: string;
  measures: MusicXmlMeasure[];
}

export interface MusicXmlMeasure {
  /** この MusicXML（movement）内での 0 始まりの小節番号 */
  index: number;
  /** この小節で宣言された調号。宣言がなければ null（前の調号が持続） */
  key: MusicXmlKey | null;
  /** 発音音符のみ（休符は除外）。譜面上の出現順 */
  notes: MusicXmlNote[];
}

export interface MusicXmlKey {
  /** 調号（♯正・♭負の数） */
  fifths: number;
  mode: 'major' | 'minor' | null;
}

export interface MusicXmlNote {
  pitch: Pitch;
  /** <chord/> 付き（直前の音符と同時発音） */
  isChordTone: boolean;
  /** 小節内オフセット（divisions 基準。小節頭は 0） */
  offset: number;
  /** <staff>（多譜表パートでの譜表番号・1始まり）。単一譜表パートでは null */
  staff: number | null;
}

const PITCH_STEPS: ReadonlySet<string> = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G']);

function parseIntText(text: string | null, fallback: number): number {
  if (text === null || text === '') {
    return fallback;
  }
  const value = Number.parseInt(text, 10);
  return Number.isNaN(value) ? fallback : value;
}

/** part-list から id → パート名の対応を作る（part-name 欠落時は id をそのまま名前にする） */
function parsePartNames(root: XmlElement): Map<string, string> {
  const names = new Map<string, string>();
  const partList = find(root, 'part-list');
  for (const scorePart of partList ? findAll(partList, 'score-part') : []) {
    const id = attr(scorePart, 'id');
    if (id !== null) {
      const name = findText(scorePart, 'part-name');
      names.set(id, name !== null && name !== '' ? name : id);
    }
  }
  return names;
}

function parsePitch(noteElement: XmlElement): Pitch | null {
  const pitchElement = find(noteElement, 'pitch');
  if (pitchElement === null) {
    return null;
  }
  const step = findText(pitchElement, 'step');
  const octaveText = findText(pitchElement, 'octave');
  if (step === null || !PITCH_STEPS.has(step) || octaveText === null) {
    return null;
  }
  // alter は MusicXML 仕様上小数（微分音）があり得るため整数へ切り詰める（プロトタイプと同じ扱い）
  const alter = Math.trunc(Number.parseFloat(findText(pitchElement, 'alter') ?? '0') || 0);
  return { step: step as PitchStep, alter, octave: parseIntText(octaveText, 4) };
}

interface MeasureParseState {
  divisions: number;
}

function parseMeasure(
  measureElement: XmlElement,
  index: number,
  state: MeasureParseState,
): MusicXmlMeasure {
  let key: MusicXmlKey | null = null;
  const notes: MusicXmlNote[] = [];
  // カーソル方式: note は duration 分進め、backup / forward で戻し / 送りする（MusicXML 仕様）
  let cursor = 0;
  let previousOffset = 0;

  for (const child of measureElement.children) {
    if (child.name === 'attributes') {
      state.divisions = parseIntText(findText(child, 'divisions'), state.divisions);
      const fifthsText = findText(child, 'key/fifths');
      if (fifthsText !== null) {
        const modeText = findText(child, 'key/mode');
        key = {
          fifths: parseIntText(fifthsText, 0),
          mode: modeText === 'major' || modeText === 'minor' ? modeText : null,
        };
      }
    } else if (child.name === 'backup') {
      cursor -= parseIntText(findText(child, 'duration'), 0);
    } else if (child.name === 'forward') {
      cursor += parseIntText(findText(child, 'duration'), 0);
    } else if (child.name === 'note') {
      // grace には duration がなく 0 として扱う（カーソルを進めない）
      const duration = parseIntText(findText(child, 'duration'), 0);
      const isChordTone = find(child, 'chord') !== null;
      const pitch = parsePitch(child);
      // 和音の後続音は直前音と同時発音（カーソルは先頭音で進んでいるため巻き戻して合わせる）
      const offset = isChordTone ? previousOffset : cursor;
      if (pitch !== null) {
        const staffText = findText(child, 'staff');
        notes.push({
          pitch,
          isChordTone,
          offset,
          staff: staffText === null ? null : parseIntText(staffText, 1),
        });
      }
      if (!isChordTone) {
        previousOffset = cursor;
        cursor += duration; // 休符もカーソルは進める（notes には含めない）
      }
    }
  }
  return { index, key, notes };
}

/**
 * score-partwise の MusicXML 文字列をパースする
 *
 * ファイル I/O・zip（.mxl）展開は行わない（編成レイヤーが展開済みの XML 文字列を渡す）
 *
 * @throws ScoreParseError 整形式でない・score-partwise でない場合
 */
export function parseMusicXml(xml: string): ParsedMusicXml {
  const root = parseXml(xml, 'musicxml');
  if (root.name !== 'score-partwise') {
    // Audiveris は partwise を出力する。timewise は変換せずサポート外として扱う
    throw new ScoreParseError(
      `score-partwise ではありません（ルート要素: ${root.name}）`,
      'musicxml',
    );
  }
  const partNames = parsePartNames(root);
  const parts: MusicXmlPart[] = [];
  for (const partElement of findAll(root, 'part')) {
    const id = attr(partElement, 'id');
    if (id === null) {
      throw new ScoreParseError('part 要素に id 属性がありません', 'musicxml');
    }
    const state: MeasureParseState = { divisions: 1 };
    const measures = findAll(partElement, 'measure').map((measureElement, index) =>
      parseMeasure(measureElement, index, state),
    );
    parts.push({ id, name: partNames.get(id) ?? id, measures });
  }
  return { parts };
}
