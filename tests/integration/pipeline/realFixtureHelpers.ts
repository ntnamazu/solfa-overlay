import { BookStructureResolver } from '../../../src/domain/score/BookStructureResolver';
import type { StructureIssue } from '../../../src/domain/score/BookStructureResolver';
import { parseBookXml } from '../../../src/domain/score/OmrSheetParser';
import { assembleArtifacts, unzipEntries } from '../../../src/main/omr/omrArchive';
import type { OmrArtifacts } from '../../../src/domain/score/ScoreModelBuilder';
import { ScoreModelBuilder } from '../../../src/domain/score/ScoreModelBuilder';
import type { BuildIssue, BuildResult } from '../../../src/domain/score/ScoreModelBuilder';
import type { ConfirmationState } from '../../../src/shared/types/Confirmation';
import type { ResolvedStructure } from '../../../src/shared/types/ResolvedStructure';

/**
 * 実 Audiveris フィクスチャ（.omr / .mxl）の回帰テスト用ヘルパー
 *
 * 実運用と同じ経路で確定構造を組む: book.xml をパース → BookStructureResolver で
 * MusicXML の段レイアウトへアンカー → ScoreModelBuilder で照合。
 * 確認画面（StructureConfirm）はまだないため decisions は空＝検出結果をそのまま採用する
 */
const NO_CORRECTIONS: ConfirmationState = { items: [], completedAt: '2026-07-19T00:00:00Z' };

export interface FixtureSummary {
  movements: number;
  pages: number;
  parts: string[];
  matchedMeasures: number;
  skippedMeasures: number;
  notes: number;
  /** 1 列（同一符頭中心 x）に複数音が乗る小節数＝和音・divisi の列対付けが稼働した小節 */
  multiNoteColumnMeasures: number;
  /** BuildIssue の種別ごとの件数 */
  issueCounts: Record<string, number>;
  /** BookStructureResolver.detect が返した StructureIssue の種別ごとの件数 */
  structureIssueCounts: Record<string, number>;
  skippedRefs: string[];
}

export interface FixtureRun {
  artifacts: OmrArtifacts;
  structure: ResolvedStructure;
  structureIssues: StructureIssue[];
  result: BuildResult;
  summary: FixtureSummary;
}

/** .omr バイト列と movement 順の .mxl バイト列群から照合まで一気に走らせ、要約を返す */
export function runFixture(omr: Uint8Array, movements: Uint8Array[]): FixtureRun {
  const artifacts = assembleArtifacts({ omr, movements });
  const bookBytes = unzipEntries(omr).get('book.xml');
  if (bookBytes === undefined) {
    throw new Error('フィクスチャの .omr に book.xml がありません');
  }
  const bookPages = parseBookXml(Buffer.from(bookBytes).toString('utf-8'));
  const resolver = new BookStructureResolver();
  const structureIssues = resolver.detect(artifacts, bookPages);
  const structure = resolver.resolve(artifacts, bookPages);
  const result = new ScoreModelBuilder().build(artifacts, structure, NO_CORRECTIONS);

  const matched = result.score.measures.filter((m) => m.status === 'matched');
  const skipped = result.score.measures.filter((m) => m.status === 'skipped');
  const issueCounts: Record<string, number> = {};
  for (const issue of result.issues) {
    issueCounts[issue.kind] = (issueCounts[issue.kind] ?? 0) + 1;
  }
  const structureIssueCounts: Record<string, number> = {};
  for (const issue of structureIssues) {
    structureIssueCounts[issue.kind] = (structureIssueCounts[issue.kind] ?? 0) + 1;
  }

  const summary: FixtureSummary = {
    movements: artifacts.movements.length,
    pages: artifacts.pages.length,
    parts: result.score.parts.map((p) => `${p.id}(${p.name})`),
    matchedMeasures: matched.length,
    skippedMeasures: skipped.length,
    notes: result.score.measures.reduce((sum, m) => sum + m.notes.length, 0),
    multiNoteColumnMeasures: matched.filter(hasMultiNoteColumn).length,
    issueCounts,
    structureIssueCounts,
    skippedRefs: skipped.map((m) => `${m.partId}:m${m.index}`),
  };
  return { artifacts, structure, structureIssues, result, summary };
}

/** 同一符頭中心 x を共有する音符が 2 つ以上ある＝和音・divisi の列が含まれる小節か */
function hasMultiNoteColumn(measure: { notes: { head: { x: number } }[] }): boolean {
  const byX = new Set<number>();
  for (const note of measure.notes) {
    byX.add(note.head.x);
  }
  return measure.notes.length > byX.size;
}

/** issue の種別だけを取り出す（詳細アサート用） */
export function issuesOfKind(result: BuildResult, kind: BuildIssue['kind']): BuildIssue[] {
  return result.issues.filter((issue) => issue.kind === kind);
}
