import { useState } from 'react';
import type {
  ExportSummary,
  SolfaPreviewRow,
  UnmatchedCorrection,
} from '../../../shared/ipc/contract';
import type { Annotation, AnnotationEdit } from '../../../shared/types/Annotation';
import type { AnnotationIssue, PageInfoIssue } from '../../../shared/types/Issues';
import type { Project } from '../../../shared/types/Project';
import type { ProjectSettings } from '../../../shared/types/ProjectSettings';
import type { Measure } from '../../../shared/types/ScoreModel';
import type { ScorePreview } from '../../../shared/types/ScorePreview';
import { partDisplayName } from '../../labels/scoreLabels';
import type { PdfLoader } from '../../viewer/pdfDocument';
import type { ScorePick } from '../../viewer/ScorePage';
import type { ScoreViewerFocus } from '../../viewer/ScoreViewer';
import { ScoreViewer } from '../../viewer/ScoreViewer';
import type { AnnotationEditTarget } from './AnnotationEditPanel';
import { AnnotationEditPanel } from './AnnotationEditPanel';
import { SolfaNotationSettings } from './SolfaNotationSettings';

/**
 * Editor 画面（画面遷移図の Editor）
 *
 * 元PDF に階名を重ねた楽譜プレビュー（#4）で、出力PDFを書き出さなくても
 * 階名の位置・スキップ小節・配置警告を確かめられる。楽譜の上の階名を押すと書き換え・削除でき、
 * 階名の無い位置を押すとそこへ書き足せる（F-5・#5）。転調点の指定（F-6）は後続の担当。
 *
 * **楽譜プレビューは最後の区画に置く**（#17）。全ページを縦に並べるため、後ろに置いた区画
 * （スキップ小節の一覧・PDF出力）が画面のずっと下に隠れてしまう
 */

/** スキップ小節の一覧に出す上限（3,500 音符の曲では 100 件を超えることがある） */
const SKIPPED_LIST_LIMIT = 50;

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
  /** 楽譜プレビューからの注釈の編集（追加・書き換え・削除・取り消し） */
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
  const [focus, setFocus] = useState<ScoreViewerFocus | null>(null);
  const jumpTo = (measure: Measure) => {
    setFocus((previous) => ({
      partId: measure.partId,
      measureIndex: measure.index,
      seq: (previous?.seq ?? 0) + 1,
    }));
  };

  /**
   * 楽譜の上で選んだもの
   *
   * 階名は id だけを持ち、中身は毎回最新の `scorePreview` から引く（編集や表記の切り替えで
   * 文字が変わっても古い内容を見せない。消えた階名は選択が外れたものとして扱う）
   */
  const [selection, setSelection] = useState<
    | { kind: 'annotation'; id: string }
    | { kind: 'point'; sourcePageIndex: number; x: number; y: number }
    | null
  >(null);
  /** 直前に削除した注釈（「元に戻す」で削除前の内容をそのまま送る） */
  const [removed, setRemoved] = useState<{ annotation: Annotation; text: string } | null>(null);

  const previewAnnotations = new Map(
    scorePreview.pages.flatMap((page) =>
      page.annotations.map((annotation) => [annotation.id, annotation] as const),
    ),
  );
  const selectedAnnotation =
    selection?.kind === 'annotation' ? previewAnnotations.get(selection.id) : undefined;
  const target: AnnotationEditTarget | null =
    selectedAnnotation !== undefined
      ? { kind: 'annotation', annotation: selectedAnnotation }
      : selection?.kind === 'point'
        ? { kind: 'point' }
        : null;
  // 対象が変わったらパネルを作り直す（入力欄の初期値を対象に合わせるため）
  const panelKey =
    selection === null
      ? 'none'
      : selection.kind === 'annotation'
        ? `annotation:${selection.id}`
        : `point:${selection.sourcePageIndex}:${selection.x}:${selection.y}`;

  const pick = (picked: ScorePick) => {
    setRemoved(null);
    setSelection(
      picked.kind === 'annotation'
        ? { kind: 'annotation', id: picked.annotation.id }
        : { kind: 'point', sourcePageIndex: picked.sourcePageIndex, x: picked.x, y: picked.y },
    );
  };
  const closePanel = () => {
    setSelection(null);
    setRemoved(null);
  };
  const addAt = (text: string) => {
    if (selection?.kind === 'point') {
      onEditAnnotation({
        kind: 'add',
        sourcePageIndex: selection.sourcePageIndex,
        x: selection.x,
        y: selection.y,
        text,
      });
    }
    closePanel();
  };
  const setSelectedText = (text: string | null) => {
    if (selectedAnnotation !== undefined) {
      onEditAnnotation({ kind: 'setText', id: selectedAnnotation.id, text });
    }
    closePanel();
  };
  const removeSelected = () => {
    const annotation = project.annotations.find((item) => item.id === selectedAnnotation?.id);
    if (selectedAnnotation === undefined || annotation === undefined) {
      closePanel();
      return;
    }
    onEditAnnotation({ kind: 'remove', id: annotation.id });
    setSelection(null);
    setRemoved({ annotation, text: selectedAnnotation.text });
  };
  const undoRemove = () => {
    if (removed !== null) {
      onEditAnnotation({ kind: 'restore', annotation: removed.annotation });
    }
    closePanel();
  };

  return (
    <main>
      <h1>階名の確認と出力</h1>
      {/* 全画面共通ルール: h1 の直下に「あなたが今すべきこと」を 1 文置く */}
      <p>楽譜の上の階名を確かめて必要なら直し、「注釈付きPDFを出力」で楽譜を書き出してください。</p>

      <section>
        <h2>概要</h2>
        <ul>
          <li>パート数: {score?.parts.length ?? 0}</li>
          <li>照合できた音符: {noteCount}</li>
          <li>注釈: {project.annotations.length}</li>
          <li>スキップ小節: {skipped.length}</li>
        </ul>
      </section>

      {skipped.length > 0 && (
        <section>
          <h2>階名が付かなかった小節（{skipped.length} 件）</h2>
          <p>押すと、楽譜の黄色く囲んだ位置へ移動します。枠の中を押すと、階名を書き足せます。</p>
          <ul>
            {skipped.slice(0, SKIPPED_LIST_LIMIT).map((measure) => {
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
          {skipped.length > SKIPPED_LIST_LIMIT && (
            <p>ほか {skipped.length - SKIPPED_LIST_LIMIT} 件</p>
          )}
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

      {/* 切り替えた結果がすぐ下のプレビューで見えるよう、プレビューの直前に置く */}
      <SolfaNotationSettings
        settings={project.settings}
        onChange={onChangeSettings}
        disabled={busy}
      />

      <section>
        <h2>楽譜プレビュー</h2>
        <p>
          階名を押すと、書き換え・削除できます。階名の無い位置を押すと、そこに階名を書き足せます。
        </p>
        <ScoreViewer
          sourcePdf={sourcePdf}
          sourcePdfError={sourcePdfError}
          preview={scorePreview}
          focus={focus}
          loadPdf={loadPdf}
          onPick={busy ? undefined : pick}
          selectedAnnotationId={selectedAnnotation?.id ?? null}
          pendingPoint={selection?.kind === 'point' ? selection : null}
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

      <AnnotationEditPanel
        key={panelKey}
        target={target}
        removedText={removed?.text ?? null}
        busy={busy}
        onAdd={addAt}
        onSetText={setSelectedText}
        onRevert={() => {
          setSelectedText(null);
        }}
        onRemove={removeSelected}
        onUndoRemove={undoRemove}
        onClose={closePanel}
      />
    </main>
  );
}
