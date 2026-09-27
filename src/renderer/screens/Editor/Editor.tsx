import { useState } from 'react';
import type {
  AnnotationEdit,
  ExportSummary,
  SolfaPreviewRow,
  UnmatchedCorrection,
} from '../../../shared/ipc/contract';
import type { AnnotationIssue, PageInfoIssue } from '../../../shared/types/Issues';
import type { Project } from '../../../shared/types/Project';
import type { ProjectSettings } from '../../../shared/types/ProjectSettings';
import type { Measure, NoteEvent } from '../../../shared/types/ScoreModel';
import type { ScorePreview } from '../../../shared/types/ScorePreview';
import { partDisplayName } from '../../labels/scoreLabels';
import type { PdfLoader } from '../../viewer/pdfDocument';
import type { ScoreViewerFocus } from '../../viewer/ScoreViewer';
import { ScoreViewer } from '../../viewer/ScoreViewer';
import { SolfaNotationSettings } from './SolfaNotationSettings';

/**
 * Editor 画面（画面遷移図の Editor）
 *
 * 元PDF に階名を重ねた楽譜プレビュー（Phase 6 #4）で、出力PDFを書き出さなくても
 * 階名の位置・スキップ小節・配置警告を確かめられる。楽譜の上で階名を足す・直す・消すこともできる（F-5 #5）。
 * 転調点の指定（F-6）は後続の担当。
 *
 * 楽譜プレビューは全ページを縦に並べて長いため、**画面の最後**に置く（#17）。
 * 一覧・警告・PDF出力をその下に置くと、全ページ分スクロールしないと届かない
 */

/** スキップ小節・削除した階名の一覧に出す上限（3,500 音符の曲では 100 件を超えることがある） */
const LIST_LIMIT = 50;

export interface EditorProps {
  project: Project;
  /** 階名プレビュー（Main が文字列まで確定させて渡す） */
  preview: SolfaPreviewRow[];
  /** 楽譜プレビューに重ねる内容（Main が位置・文字まで確定させて渡す） */
  scorePreview: ScorePreview;
  /** 元PDF のバイト列（取得中は null） */
  sourcePdf: Uint8Array | null;
  /** 元PDF を取得できなかった理由 */
  sourcePdfError: string | null;
  /** PDF の読み込み方法（画面テストで差し替える。省略時は PDF.js） */
  loadPdf?: PdfLoader;
  pageIssues: PageInfoIssue[];
  annotationIssues: AnnotationIssue[];
  unmatchedCorrections: UnmatchedCorrection[];
  /** 直近の出力結果（未出力なら null） */
  exportSummary: ExportSummary | null;
  onExportPdf: () => void;
  /** 階名の表記（音節体系・短調の基準）を切り替える。設定全体を渡す */
  onChangeSettings: (settings: ProjectSettings) => void;
  /** 楽譜の上で階名を足す・直す・消す・元に戻す（F-5） */
  onEditAnnotation: (edit: AnnotationEdit) => void;
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
  scorePreview,
  sourcePdf,
  sourcePdfError,
  loadPdf,
  pageIssues,
  annotationIssues,
  unmatchedCorrections,
  exportSummary,
  onExportPdf,
  onChangeSettings,
  onEditAnnotation,
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
  // 楽譜上に位置を持つスキップ小節（一覧からジャンプできるもの）
  const locatedSkipped = new Set(
    scorePreview.pages.flatMap((page) =>
      page.skippedMeasures.map((region) => `${region.partId}:${region.measureIndex}`),
    ),
  );
  // 削除した自動の階名（楽譜から消えて押せなくなるため、戻す入口をここに残す）。
  // 対応する音符が無いものは戻しても描かれないため出さない
  const notes = new Map<string, { note: NoteEvent; order: number }>();
  for (const measure of score?.measures ?? []) {
    measure.notes.forEach((note, order) => notes.set(note.id, { note, order }));
  }
  const hidden = project.annotations.flatMap((annotation) => {
    const found =
      annotation.deleted && annotation.noteId !== null ? notes.get(annotation.noteId) : undefined;
    return found === undefined ? [] : [{ annotation, ...found }];
  });
  const shownAnnotations = project.annotations.filter((annotation) => !annotation.deleted).length;
  const [editing, setEditing] = useState(false);
  const [focus, setFocus] = useState<ScoreViewerFocus | null>(null);
  const jumpTo = (measure: Measure) => {
    setFocus((previous) => ({
      partId: measure.partId,
      measureIndex: measure.index,
      seq: (previous?.seq ?? 0) + 1,
    }));
  };

  return (
    <main>
      <h1>階名の確認と出力</h1>
      {/* 全画面共通ルール: h1 の直下に「あなたが今すべきこと」を 1 文置く */}
      <p>
        楽譜の上の階名を確かめ、必要なら直してから、「注釈付きPDFを出力」で楽譜を書き出してください。
      </p>

      <section>
        <h2>概要</h2>
        <ul>
          <li>パート数: {score?.parts.length ?? 0}</li>
          <li>照合できた音符: {noteCount}</li>
          {/* 削除した階名を数えると、削除しても件数が減らず効いたか分からない */}
          <li>注釈: {shownAnnotations}</li>
          <li>スキップ小節: {skipped.length}</li>
        </ul>
      </section>

      {skipped.length > 0 && (
        <section>
          <h2>階名が付かなかった小節（{skipped.length} 件）</h2>
          <p>
            押すと、楽譜の黄色く囲んだ位置へ移動します。「楽譜の上で階名を直す」をオンにすると、その場で階名を書き足せます。
          </p>
          <ul>
            {skipped.slice(0, LIST_LIMIT).map((measure) => {
              const label = `${partDisplayName(measure.partId, partNames.get(measure.partId))}の ${measure.index + 1} 小節目`;
              return (
                <li key={`${measure.partId}-${measure.index}`}>
                  {locatedSkipped.has(`${measure.partId}:${measure.index}`) ? (
                    <button type="button" onClick={() => jumpTo(measure)}>
                      {label}
                    </button>
                  ) : (
                    // 位置を特定できない小節も一覧からは消さない（無言で欠落させない）
                    <>{label}（楽譜上の位置を特定できません）</>
                  )}
                </li>
              );
            })}
          </ul>
          {skipped.length > LIST_LIMIT && <p>ほか {skipped.length - LIST_LIMIT} 件</p>}
        </section>
      )}

      {unresolved.length > 0 && (
        <section>
          <h2>配置を調整できなかった注釈（{unresolved.length} 件）</h2>
          <p>
            まわりの記号と重なるため、符頭の真上に置いています。楽譜の「!」の印の位置を確認してください。
          </p>
        </section>
      )}

      {orphans.length > 0 && (
        <section>
          <h2>対応する音符が見つからない注釈（{orphans.length} 件）</h2>
          <p>再解析で音符が変わったため、これらの注釈は出力されません。</p>
        </section>
      )}

      {hidden.length > 0 && (
        <section>
          <h2>削除した階名（{hidden.length} 件）</h2>
          <p>削除した階名は出力されません。戻すと元の位置に表示されます。</p>
          <ul>
            {hidden.slice(0, LIST_LIMIT).map(({ annotation, note, order }) => (
              <li key={annotation.id}>
                {partDisplayName(note.partId, partNames.get(note.partId))}の {note.measureIndex + 1}{' '}
                小節目・{order + 1} 番目の音符の階名{' '}
                <button
                  type="button"
                  onClick={() => {
                    onEditAnnotation({ kind: 'restore', id: annotation.id });
                  }}
                  disabled={busy}
                >
                  元に戻す
                </button>
              </li>
            ))}
          </ul>
          {hidden.length > LIST_LIMIT && <p>ほか {hidden.length - LIST_LIMIT} 件</p>}
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

      {/* 楽譜プレビューは全ページを縦に並べて長いため、その下に置くと届かない（#17） */}
      <button type="button" onClick={onBackToConfirm} disabled={busy}>
        確認画面へ戻る
      </button>

      {/*
        楽譜プレビューは最後に置く（全ページを縦に並べるため、下にある一覧や出力ボタンが埋もれる。#17）。
        表記の切り替えは、結果がすぐ下で見えるようプレビューの直前に置く
      */}
      <SolfaNotationSettings
        settings={project.settings}
        onChange={onChangeSettings}
        disabled={busy}
      />

      <section>
        <h2>楽譜プレビュー</h2>
        <label>
          <input
            type="checkbox"
            checked={editing}
            onChange={(event) => {
              setEditing(event.target.checked);
            }}
          />
          楽譜の上で階名を直す
        </label>
        {/* 常に押せると、スクロールやフォーカスのためのクリックで意図しない階名が増える */}
        {editing && (
          <p>
            何も無い位置を押すと、そこに階名を書き足せます。階名を押すと、書き換え・削除ができます。
          </p>
        )}
        <ScoreViewer
          sourcePdf={sourcePdf}
          sourcePdfError={sourcePdfError}
          preview={scorePreview}
          focus={focus}
          loadPdf={loadPdf}
          editable={editing && !busy}
          onEditAnnotation={onEditAnnotation}
        />
        {/* 楽譜を表示できない場合の代わりとして、文字の一覧も残す（既定は畳む） */}
        <details>
          <summary>先頭部分の階名を文字で見る</summary>
          {preview.length === 0 ? (
            <p>表示できる階名がありません。</p>
          ) : (
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
          )}
        </details>
      </section>
    </main>
  );
}
