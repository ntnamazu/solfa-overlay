import type {
  ExportSummary,
  SolfaPreviewRow,
  UnmatchedCorrection,
} from '../../../shared/ipc/contract';
import type { AnnotationIssue, PageInfoIssue } from '../../../shared/types/Issues';
import type { Project } from '../../../shared/types/Project';
import type { Measure } from '../../../shared/types/ScoreModel';
import { partDisplayName } from '../../labels/scoreLabels';

/**
 * Editor 画面（画面遷移図の Editor）
 *
 * Phase 5 は**テキストによる最小表示**に留める。元PDF のページ画像に注釈を重ねる
 * キャンバス表示（PDF.js）と、注釈の手動編集・転調点の指定は Phase 6（F-5 / F-6）の担当。
 * ここで担保するのは「階名が付いたことを人が確認し、PDF として出せる」ところまで。
 */

/** スキップ小節の一覧に出す上限（3,500 音符の曲では 100 件を超えることがある） */
const SKIPPED_LIST_LIMIT = 50;

export interface EditorProps {
  project: Project;
  /** 階名プレビュー（Main が文字列まで確定させて渡す） */
  preview: SolfaPreviewRow[];
  pageIssues: PageInfoIssue[];
  annotationIssues: AnnotationIssue[];
  unmatchedCorrections: UnmatchedCorrection[];
  /** 直近の出力結果（未出力なら null） */
  exportSummary: ExportSummary | null;
  onExportPdf: () => void;
  onBackToConfirm: () => void;
  busy: boolean;
}

function describePageIssue(issue: PageInfoIssue): string {
  switch (issue.kind) {
    case 'sourcePageMissing':
      return `${issue.pageIndex + 1}ページ目に対応する元PDFのページ（${issue.sourcePageNumber}）がありません`;
    case 'sheetGeometryMissing':
      return `${issue.pageIndex + 1}ページ目の寸法を確定できませんでした`;
    case 'sourcePdfUnreadable':
      return `元PDFを読み込めませんでした（${issue.message}）。PDF出力はできません`;
  }
}

function describeUnmatched(correction: UnmatchedCorrection): string {
  return correction.kind === 'clef'
    ? `音部記号の訂正「${correction.itemId}」の適用先が見つかりませんでした`
    : `${correction.pageIndex + 1}ページ ${correction.systemIndex + 1}段目への訂正の適用先が見つかりませんでした`;
}

export function Editor({
  project,
  preview,
  pageIssues,
  annotationIssues,
  unmatchedCorrections,
  exportSummary,
  onExportPdf,
  onBackToConfirm,
  busy,
}: EditorProps) {
  const approved = project.confirmation.completedAt !== null;
  const score = project.score;
  const skipped: Measure[] = score?.measures.filter((m) => m.status === 'skipped') ?? [];
  const unresolved = annotationIssues.filter((issue) => issue.kind === 'placementUnresolved');
  const orphans = annotationIssues.filter((issue) => issue.kind === 'orphanAnnotation');
  const noteCount = score?.measures.reduce((sum, measure) => sum + measure.notes.length, 0) ?? 0;
  // 同じ画面の 2 つの一覧が同じパートを別の名前で呼ぶと、行同士を対応付けられなくなる
  const partNames = new Map(score?.parts.map((part) => [part.id, part.name]) ?? []);

  return (
    <main>
      <h1>階名の確認と出力</h1>
      {/* 全画面共通ルール: h1 の直下に「あなたが今すべきこと」を 1 文置く */}
      <p>階名を見て問題がなければ、「注釈付きPDFを出力」で楽譜を書き出してください。</p>

      <section>
        <h2>概要</h2>
        <ul>
          <li>パート数: {score?.parts.length ?? 0}</li>
          <li>照合できた音符: {noteCount}</li>
          <li>注釈: {project.annotations.length}</li>
          <li>スキップ小節: {skipped.length}</li>
        </ul>
      </section>

      <section>
        <h2>階名プレビュー</h2>
        {preview.length === 0 ? (
          <p>表示できる階名がありません。</p>
        ) : (
          <>
            <table>
              <caption>曲の先頭部分の階名</caption>
              <thead>
                <tr>
                  <th scope="col">パート</th>
                  <th scope="col">小節</th>
                  <th scope="col">階名</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row) => (
                  <tr key={`${row.partId}-${row.measureIndex}`}>
                    <td>{partDisplayName(row.partId, row.partName)}</td>
                    <td>{row.measureIndex + 1}</td>
                    <td>{row.syllables.join(' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>全体は出力したPDFで確認してください。</p>
          </>
        )}
      </section>

      {skipped.length > 0 && (
        <section>
          <h2>階名が付かなかった小節（{skipped.length} 件）</h2>
          <ul>
            {skipped.slice(0, SKIPPED_LIST_LIMIT).map((measure) => (
              <li key={`${measure.partId}-${measure.index}`}>
                {partDisplayName(measure.partId, partNames.get(measure.partId))}の{' '}
                {measure.index + 1} 小節目
              </li>
            ))}
          </ul>
          {skipped.length > SKIPPED_LIST_LIMIT && (
            <p>ほか {skipped.length - SKIPPED_LIST_LIMIT} 件</p>
          )}
        </section>
      )}

      {unresolved.length > 0 && (
        <section>
          <h2>配置を調整できなかった注釈（{unresolved.length} 件）</h2>
          <p>まわりの記号と重なるため、符頭の真上に置いています。印刷して確認してください。</p>
        </section>
      )}

      {orphans.length > 0 && (
        <section>
          <h2>対応する音符が見つからない注釈（{orphans.length} 件）</h2>
          <p>再解析で音符が変わったため、これらの注釈は出力されません。</p>
        </section>
      )}

      {pageIssues.length > 0 && (
        <section>
          <h2>ページの問題（{pageIssues.length} 件）</h2>
          <ul>
            {pageIssues.map((issue) => (
              <li key={`${issue.kind}-${'pageIndex' in issue ? issue.pageIndex : 'pdf'}`}>
                {describePageIssue(issue)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {unmatchedCorrections.length > 0 && (
        <section>
          <h2>適用されなかった訂正（{unmatchedCorrections.length} 件）</h2>
          <ul>
            {unmatchedCorrections.map((correction) => (
              <li
                key={
                  correction.kind === 'clef'
                    ? `clef-${correction.itemId}`
                    : `structure-${correction.pageIndex}-${correction.systemIndex}`
                }
              >
                {describeUnmatched(correction)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>PDF出力</h2>
        {!approved && (
          <p role="alert">
            音部記号・調の確認が完了していないため出力できません。確認画面で承認してください。
          </p>
        )}
        <button type="button" onClick={onExportPdf} disabled={busy || !approved}>
          注釈付きPDFを出力
        </button>
        {exportSummary !== null && (
          <p>
            {exportSummary.outPath} に {exportSummary.drawnCount} 件の階名を出力しました。
            {exportSummary.renderIssues.length > 0 &&
              `（${exportSummary.renderIssues.length} 件の注意事項があります）`}
          </p>
        )}
      </section>

      <button type="button" onClick={onBackToConfirm} disabled={busy}>
        確認画面へ戻る
      </button>
    </main>
  );
}
