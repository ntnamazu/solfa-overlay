import type { ConfirmationState } from '../../shared/types/Confirmation';
import type { PitchStep } from '../../shared/types/Pitch';
import type { ResolvedStructure } from '../../shared/types/ResolvedStructure';
import type {
  Measure,
  NoteEvent,
  Part,
  ScoreModel,
  SystemInfo,
} from '../../shared/types/ScoreModel';
import { diatonicIndex, headStepOctave, isKnownClefKind } from './clefTable';
import type { MusicXmlNote, MusicXmlPart, ParsedMusicXml } from './MusicXmlParser';
import type { OmrHead, OmrPageContent, OmrStack, OmrStaff } from './OmrSheetParser';

/** パース済みの OMR 成果物一式（zip 展開・パースは呼び出し側で済ませて渡す） */
export interface OmrArtifacts {
  /** movement ごとの MusicXML（曲順。Audiveris は movement 単位で出力する） */
  movements: { musicXml: ParsedMusicXml }[];
  /** 曲全体のページ順の sheet パース結果 */
  pages: OmrPageContent[];
}

export interface BuildResult {
  score: ScoreModel;
  issues: BuildIssue[];
}

/**
 * 照合中に検出した問題（例外にせず部分結果と共に返す。
 * 機能設計書「エラーハンドリング」= 部分失敗は全体を失敗にしない）
 */
export type BuildIssue =
  | {
      kind: 'measureCountMismatch';
      partId: string;
      measureIndex: number;
      pageIndex: number;
      systemIndex: number;
      omrCount: number;
      xmlCount: number;
    }
  | {
      kind: 'pitchCrossCheckMismatch';
      noteId: string;
      partId: string;
      measureIndex: number;
      /** MusicXML 由来の音名（採用される値） */
      expectedStep: PitchStep;
      /** .omr の譜表位置＋音部記号から逆算した音名 */
      omrStep: PitchStep;
    }
  | {
      kind: 'unknownClef';
      pageIndex: number;
      systemIndex: number;
      staffIndex: number;
      partId: string;
      clefKind: string;
    }
  | { kind: 'partNotFound'; partId: string; pageIndex: number; systemIndex: number }
  | {
      kind: 'measureOutOfRange';
      partId: string;
      pageIndex: number;
      systemIndex: number;
      measureIndex: number;
    };

/** 確認画面の clef 修正値を (page, system, staff) で引くためのキー */
function staffKey(pageIndex: number, systemIndex: number, staffIndex: number): string {
  return `${pageIndex}:${systemIndex}:${staffIndex}`;
}

/** ClefKeyConfirm の修正値（corrected）を StaffRef 位置 → Audiveris kind の表に変換する */
function collectClefCorrections(confirmation: ConfirmationState): Map<string, string> {
  const corrections = new Map<string, string>();
  for (const item of confirmation.items) {
    if (item.kind === 'clef' && item.corrected !== null) {
      const { pageIndex, systemIndex, staffIndex } = item.staffRef;
      corrections.set(staffKey(pageIndex, systemIndex, staffIndex), item.corrected);
    }
  }
  return corrections;
}

/** movement の論理小節数（パート間で最大値。通し小節番号の累積に使う） */
function measureCountOf(musicXml: ParsedMusicXml): number {
  return musicXml.parts.reduce((max, part) => Math.max(max, part.measures.length), 0);
}

interface BuildContext {
  issues: BuildIssue[];
  parts: Map<string, Part>;
  /** partId → 通し小節番号 → Measure */
  measures: Map<string, Map<number, Measure>>;
}

function ensureMeasure(context: BuildContext, partId: string, index: number): Measure {
  let byIndex = context.measures.get(partId);
  if (byIndex === undefined) {
    byIndex = new Map();
    context.measures.set(partId, byIndex);
  }
  let measure = byIndex.get(index);
  if (measure === undefined) {
    measure = { partId, index, status: 'matched', notes: [] };
    byIndex.set(index, measure);
  }
  return measure;
}

/** 符頭中心の x（内包判定と NoteEvent 格納値で同じ丸めを使い、境界の食い違いを防ぐ） */
function headCenterX(head: OmrHead): number {
  return head.x + Math.trunc(head.w / 2);
}

/**
 * 小節内の音符を「同時に鳴る列」（同 offset の音群）へ束ね、時間順に並べる
 *
 * offset は MusicXmlParser のカーソル方式（backup / forward 対応済み）で計算済みのため、
 * 異リズム多声の音符もこのグループ化だけで正しい時間軸にマージされる
 */
function groupIntoColumns(xmlNotes: MusicXmlNote[]): MusicXmlNote[][] {
  const byOffset = new Map<number, MusicXmlNote[]>();
  for (const note of xmlNotes) {
    const column = byOffset.get(note.offset) ?? [];
    column.push(note);
    byOffset.set(note.offset, column);
  }
  return [...byOffset.entries()].sort(([a], [b]) => a - b).map(([, notes]) => notes);
}

/**
 * 1譜表×1小節（stack）の照合: 数が合えば対にし、合わなければ skipped に隔離する
 *
 * 対付けは「時間（x）で列を切り出し、列内は縦位置で対にする」2段階:
 * 1. 同 offset の音群を列とし、x 昇順の符頭を列サイズどおり先頭から貪欲に切り出す
 *    （総数一致を照合済みのため常に全符頭をちょうど消費する。x 距離の閾値は使わない）
 * 2. 列内は符頭を譜表位置昇順（中線=0・下向き正 → 高い音が先）、音符を幹音の
 *    絶対音高降順（高い音が先）に並べて対にする。譜表位置は幹音と一対一のため、
 *    和音・オクターブ重複 divisi でも曖昧さなく対応が決まる
 * （文書順×x順の添字 zip は和音・多声で対応が崩れるため使わない）
 */
function matchStack(
  context: BuildContext,
  staff: OmrStaff,
  clefKind: string | null,
  xmlNotes: MusicXmlNote[],
  stack: OmrStack,
  globalMeasureIndex: number,
  pageIndex: number,
  systemIndex: number,
): void {
  const measure = ensureMeasure(context, staff.partId, globalMeasureIndex);
  if (measure.status === 'skipped') {
    return; // 同一小節の別譜表で既に不一致確定（notes は破棄済み）
  }
  const stackHeads = staff.heads.filter(
    (head) => headCenterX(head) >= stack.left && headCenterX(head) < stack.right,
  );
  if (stackHeads.length !== xmlNotes.length) {
    measure.status = 'skipped';
    measure.notes = []; // 部分的に対にせず小節単位で隔離する（誤対応の波及防止）
    context.issues.push({
      kind: 'measureCountMismatch',
      partId: staff.partId,
      measureIndex: globalMeasureIndex,
      pageIndex,
      systemIndex,
      omrCount: stackHeads.length,
      xmlCount: xmlNotes.length,
    });
    return;
  }
  let headCursor = 0;
  for (const columnNotes of groupIntoColumns(xmlNotes)) {
    const columnHeads = stackHeads.slice(headCursor, headCursor + columnNotes.length);
    headCursor += columnNotes.length;
    // 高い音が先: 符頭は下向き正のため pitch 昇順（同値は x 昇順で決定的に）
    columnHeads.sort((a, b) => a.pitch - b.pitch || a.x - b.x);
    // 同値（ユニゾン）は文書順を保持（Array.prototype.sort は安定）
    const sortedNotes = [...columnNotes].sort(
      (a, b) =>
        diatonicIndex(b.pitch.step, b.pitch.octave) - diatonicIndex(a.pitch.step, a.pitch.octave),
    );
    for (const [pairIndex, head] of columnHeads.entries()) {
      const xmlNote = sortedNotes[pairIndex];
      /* v8 ignore next -- slice と同サイズのため到達しない */
      if (xmlNote === undefined) continue;
      const noteEvent: NoteEvent = {
        // OMR 再実行後も注釈の引き継ぎ照合が安定するよう決定的に採番する
        // （並びは offset 順 → 列内は高い音から）
        id: `${staff.partId}:m${globalMeasureIndex}:n${measure.notes.length}`,
        partId: staff.partId,
        measureIndex: globalMeasureIndex,
        pitch: xmlNote.pitch,
        head: { pageIndex, x: headCenterX(head), y: head.y },
        solfa: null,
      };
      // 音高クロスチェック: 譜表位置＋音部記号からの逆算と MusicXML の音名を突き合わせる
      // （octave は比較しない: プロトタイプ実測で step 比較のみで系統的誤りを検出できた）
      const derived = headStepOctave(head.pitch, clefKind);
      if (derived !== null && derived.step !== xmlNote.pitch.step) {
        context.issues.push({
          kind: 'pitchCrossCheckMismatch',
          noteId: noteEvent.id,
          partId: staff.partId,
          measureIndex: globalMeasureIndex,
          expectedStep: xmlNote.pitch.step,
          omrStep: derived.step,
        });
      }
      measure.notes.push(noteEvent);
    }
  }
}

/** システム内の走査位置（buildStaff へ渡す文脈） */
interface SystemPosition {
  globalMeasureBase: number;
  movementCursor: number;
  pageIndex: number;
  systemIndex: number;
}

/**
 * MusicXML（論理）と .omr（座標）の照合による ScoreModel 構築
 * （機能設計書「小節照合」。プロトタイプ solfa_proto.py の process_movement の移植）
 *
 * 譜表構造は BookStructureResolver の確定結果（ResolvedStructure）を前提とし、
 * 音部記号は確認画面（ClefKeyConfirm）の修正値を優先して解決する
 */
export class ScoreModelBuilder {
  build(
    artifacts: OmrArtifacts,
    structure: ResolvedStructure,
    confirmation: ConfirmationState,
  ): BuildResult {
    const context: BuildContext = { issues: [], parts: new Map(), measures: new Map() };
    const systems: SystemInfo[] = [];
    const corrections = collectClefCorrections(confirmation);

    let globalMeasureBase = 0;
    for (const movement of structure.movements) {
      const musicXml = artifacts.movements[movement.musicXmlIndex]?.musicXml;
      if (musicXml === undefined) {
        // ResolvedStructure と artifacts の不整合は認識エラーではなく呼び出し側の契約違反
        throw new Error(
          `ResolvedStructure が指す MusicXML がありません: ${movement.musicXmlIndex}`,
        );
      }
      for (const part of musicXml.parts) {
        if (!context.parts.has(part.id)) {
          context.parts.set(part.id, { id: part.id, name: part.name, staves: [] });
        }
      }
      let movementCursor = 0;
      for (const pageIndex of movement.pageIndices) {
        const page = artifacts.pages[pageIndex];
        if (page === undefined) {
          throw new Error(`ResolvedStructure が指すページがありません: ${pageIndex}`);
        }
        for (const [systemIndex, system] of page.systems.entries()) {
          systems.push({
            pageIndex,
            systemIndex,
            firstMeasureIndex: globalMeasureBase + movementCursor,
            measureCount: system.stacks.length,
          });
          this.buildSystem(context, musicXml, system.staves, system.stacks, corrections, {
            globalMeasureBase,
            movementCursor,
            pageIndex,
            systemIndex,
          });
          movementCursor += system.stacks.length;
        }
      }
      // 通し小節番号は MusicXML の論理小節数で累積する（OMR 側のページ欠落に影響されない）
      globalMeasureBase += measureCountOf(musicXml);
    }

    return { score: assemble(context, systems), issues: context.issues };
  }

  private buildSystem(
    context: BuildContext,
    musicXml: ParsedMusicXml,
    staves: OmrStaff[],
    stacks: OmrStack[],
    corrections: Map<string, string>,
    position: SystemPosition,
  ): void {
    // 同一パートが複数譜表にまたがる場合（鍵盤等）は <staff> 番号で音符を譜表に振り分けるため、
    // 先にパートごとの譜表数を数えてから走査する
    const staffTotals = new Map<string, number>();
    for (const staff of staves) {
      staffTotals.set(staff.partId, (staffTotals.get(staff.partId) ?? 0) + 1);
    }
    const staffOrdinals = new Map<string, number>();
    for (const [staffIndex, staff] of staves.entries()) {
      const ordinal = (staffOrdinals.get(staff.partId) ?? 0) + 1;
      staffOrdinals.set(staff.partId, ordinal);
      const clefKind =
        corrections.get(staffKey(position.pageIndex, position.systemIndex, staffIndex)) ??
        staff.clefKind;
      if (clefKind !== null && !isKnownClefKind(clefKind)) {
        context.issues.push({
          kind: 'unknownClef',
          pageIndex: position.pageIndex,
          systemIndex: position.systemIndex,
          staffIndex,
          partId: staff.partId,
          clefKind,
        });
      }
      const xmlPart = musicXml.parts.find((part) => part.id === staff.partId);
      if (xmlPart === undefined) {
        context.issues.push({
          kind: 'partNotFound',
          partId: staff.partId,
          pageIndex: position.pageIndex,
          systemIndex: position.systemIndex,
        });
        continue;
      }
      context.parts.get(staff.partId)?.staves.push({
        pageIndex: position.pageIndex,
        systemIndex: position.systemIndex,
        staffIndex,
        partId: staff.partId,
      });
      const isMultiStaffPart = (staffTotals.get(staff.partId) ?? 1) > 1;
      this.buildStaff(context, xmlPart, staff, clefKind, stacks, position, {
        ordinal,
        isMultiStaffPart,
      });
    }
  }

  private buildStaff(
    context: BuildContext,
    xmlPart: MusicXmlPart,
    staff: OmrStaff,
    clefKind: string | null,
    stacks: OmrStack[],
    position: SystemPosition,
    staffRole: { ordinal: number; isMultiStaffPart: boolean },
  ): void {
    for (const [stackIndex, stack] of stacks.entries()) {
      const localMeasure = position.movementCursor + stackIndex;
      const globalMeasureIndex = position.globalMeasureBase + localMeasure;
      const xmlMeasure = xmlPart.measures[localMeasure];
      if (xmlMeasure === undefined) {
        context.issues.push({
          kind: 'measureOutOfRange',
          partId: staff.partId,
          pageIndex: position.pageIndex,
          systemIndex: position.systemIndex,
          measureIndex: globalMeasureIndex,
        });
        continue;
      }
      // 多譜表パートは <staff> 番号で当該譜表の音符に絞る（staff 未指定は第1譜表とみなす）
      const xmlNotes = staffRole.isMultiStaffPart
        ? xmlMeasure.notes.filter((note) => (note.staff ?? 1) === staffRole.ordinal)
        : xmlMeasure.notes;
      matchStack(
        context,
        staff,
        clefKind,
        xmlNotes,
        stack,
        globalMeasureIndex,
        position.pageIndex,
        position.systemIndex,
      );
    }
  }
}

/** 照合結果を partId（出現順）→ 通し小節番号順に整列して ScoreModel に組み立てる */
function assemble(context: BuildContext, systems: SystemInfo[]): ScoreModel {
  const parts = [...context.parts.values()];
  const measures: Measure[] = [];
  for (const part of parts) {
    const byIndex = context.measures.get(part.id);
    if (byIndex === undefined) {
      continue;
    }
    for (const index of [...byIndex.keys()].sort((a, b) => a - b)) {
      const measure = byIndex.get(index);
      /* v8 ignore next -- keys() 由来のため必ず存在する */
      if (measure !== undefined) measures.push(measure);
    }
  }
  return { parts, systems, measures };
}
