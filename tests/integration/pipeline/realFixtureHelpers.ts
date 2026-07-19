import { parseBookXml, groupMovements } from '../../../src/domain/score/OmrSheetParser';
import { assembleArtifacts, unzipEntries } from '../../../src/main/omr/omrArchive';
import type { OmrArtifacts } from '../../../src/domain/score/ScoreModelBuilder';
import { ScoreModelBuilder } from '../../../src/domain/score/ScoreModelBuilder';
import type { BuildIssue, BuildResult } from '../../../src/domain/score/ScoreModelBuilder';
import type { ConfirmationState } from '../../../src/shared/types/Confirmation';
import type { ResolvedStructure } from '../../../src/shared/types/ResolvedStructure';

/**
 * 実 Audiveris フィクスチャ（.omr / .mxl）の回帰テスト用ヘルパー
 *
 * BookStructureResolver（別フェーズ）は未実装のため、book.xml の movement-start による
 * 素朴な分割で ResolvedStructure を組む（synthetic-mini 統合テストの resolveStructure と同方針）。
 * 確定構造の復元が入る Phase 2 までは、この素朴な構造が実データ検証の前提になる。
 */
const NO_CORRECTIONS: ConfirmationState = { items: [], completedAt: '2026-07-19T00:00:00Z' };

/** book.xml の movement 分割を「movement → 通しページ index」の ResolvedStructure に変換する */
function resolveStructure(bookXml: string, movementCount: number): ResolvedStructure {
  const movements = groupMovements(parseBookXml(bookXml));
  let pageCursor = 0;
  return {
    movements: movements.map((pages, index) => ({
      // .mxl が movement 数より少ない場合は末尾 movement に寄せる（実データの誤分割対策）
      musicXmlIndex: Math.min(index, movementCount - 1),
      pageIndices: pages.map(() => pageCursor++),
    })),
  };
}

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
  skippedRefs: string[];
}

export interface FixtureRun {
  artifacts: OmrArtifacts;
  structure: ResolvedStructure;
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
  const structure = resolveStructure(Buffer.from(bookBytes).toString('utf-8'), movements.length);
  const result = new ScoreModelBuilder().build(artifacts, structure, NO_CORRECTIONS);

  const matched = result.score.measures.filter((m) => m.status === 'matched');
  const skipped = result.score.measures.filter((m) => m.status === 'skipped');
  const issueCounts: Record<string, number> = {};
  for (const issue of result.issues) {
    issueCounts[issue.kind] = (issueCounts[issue.kind] ?? 0) + 1;
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
    skippedRefs: skipped.map((m) => `${m.partId}:m${m.index}`),
  };
  return { artifacts, structure, result, summary };
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
