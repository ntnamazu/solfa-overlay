import type { Annotation } from '../../shared/types/Annotation';
import type { AnnotationIssue } from '../../shared/types/Issues';
import type { PageInfo } from '../../shared/types/Project';
import type { ProjectSettings } from '../../shared/types/ProjectSettings';
import type { Measure, NoteEvent, PageAnchor, ScoreModel } from '../../shared/types/ScoreModel';
import type { PageGeometry } from '../score/OmrSheetParser';
import { pxPerPt } from '../render/coordinateTransform';
import type { SolfaFonts } from '../render/fontMetrics';
import { solfaFonts } from '../render/fontMetrics';
import { syllableFor } from '../solfa/syllableTables';
import { PlacementSpace } from './placementResolver';

/**
 * 注釈レイヤーの生成と編集（機能設計書「AnnotationManager」）
 *
 * 階名の付いた `ScoreModel` から自動注釈を作り、手動で加えた注釈と削除の記録を保全する。
 * 描画は行わない（`OverlayRenderer` の責務）。
 *
 * **機能設計書の `regenerate(score, degrees)` から引数を変えている**:
 * `applyDegrees` 済みの `ScoreModel` が `note.solfa` を持つため `degrees` は不要で、
 * 代わりに配置に要る幾何情報・ページ寸法・設定と、保全のための既存注釈を受け取る。
 */

/** 自動注釈の id 接頭辞。音符 id から決まるため再生成しても同じ id になる */
const AUTO_ID_PREFIX = 'solfa-';

/**
 * `PageInfo` が無いページで使うフォントサイズの近似（譜線間隔比）
 *
 * 既定の 8pt は 300dpi で約 33px、譜線間隔 16〜17px の約 2 倍にあたる（実測）。
 * ページ寸法が分からない場合の当て推量であり、この経路は必ず issue として報告する
 */
const FALLBACK_FONT_PX_PER_INTERLINE = 2;

/**
 * 注釈生成で検出した問題
 *
 * 型の実体は `shared/types/Issues.ts`（Editor へ IPC 越しに送る表示用データのため）
 */
export type { AnnotationIssue };

export interface RegenerateInput {
  /** 階名を反映済みの楽譜モデル（`applyDegrees` の結果） */
  score: ScoreModel;
  /** `.omr` 由来のページ幾何。添字は Audiveris のページ番号 */
  geometry: readonly PageGeometry[];
  /** ページ寸法。`buildPageInfos` の結果 */
  pages: readonly PageInfo[];
  settings: ProjectSettings;
  /** 既存の注釈（手動注釈・削除フラグ・手動上書きの引き継ぎ元） */
  existing: readonly Annotation[];
}

export interface RegenerateResult {
  annotations: Annotation[];
  issues: AnnotationIssue[];
}

/** 音符 1 つに対する注釈の描画文字列（設定の音節体系に従う） */
export function syllableOf(note: NoteEvent, settings: ProjectSettings): string | null {
  return note.solfa === null ? null : syllableFor(note.solfa, settings.syllableSystem);
}

/** 自動注釈の id（音符 id から決まる） */
export function autoAnnotationId(noteId: string): string {
  return `${AUTO_ID_PREFIX}${noteId}`;
}

/** ページごとに音符を集め、決定的な順序（x → y → id）に並べる */
function notesByPage(score: ScoreModel): Map<number, NoteEvent[]> {
  const byPage = new Map<number, NoteEvent[]>();
  for (const measure of score.measures) {
    for (const note of measure.notes) {
      const bucket = byPage.get(note.head.pageIndex);
      if (bucket === undefined) {
        byPage.set(note.head.pageIndex, [note]);
      } else {
        bucket.push(note);
      }
    }
  }
  for (const notes of byPage.values()) {
    // 配置は「先に置いた注釈を避ける」ため順序で結果が変わる。
    // 入力の並びに依存しないよう、必ず同じ順序へ正規化する
    notes.sort((a, b) => a.head.x - b.head.x || a.head.y - b.head.y || (a.id < b.id ? -1 : 1));
  }
  return byPage;
}

/**
 * 階名から注釈を作り直す
 *
 * 自動注釈は毎回作り直すが、**ユーザーの手が入った情報（手動注釈・削除・文字の上書き）は
 * id で引き継ぐ**。認識結果が変わっても人の判断が消えないようにするための設計
 * （`confirmationItems.mergeCorrections` と同じ考え方）
 */
export function regenerateAnnotations(input: RegenerateInput): RegenerateResult {
  const { score, geometry, pages, settings, existing } = input;
  const fonts = solfaFonts(settings.fontFamily);
  const issues: AnnotationIssue[] = [];

  const previousById = new Map(existing.map((annotation) => [annotation.id, annotation]));
  const pageInfos = new Map(pages.map((page) => [page.pageIndex, page]));
  // 描画される手動注釈をページごとに引けるようにする（自動注釈が避ける障害物にするため）
  const manualByPage = new Map<number, Annotation[]>();
  for (const annotation of existing) {
    if (annotation.origin !== 'manual' || annotation.deleted) {
      continue;
    }
    const bucket = manualByPage.get(annotation.anchor.pageIndex);
    if (bucket === undefined) {
      manualByPage.set(annotation.anchor.pageIndex, [annotation]);
    } else {
      bucket.push(annotation);
    }
  }

  const annotations: Annotation[] = [];
  const generatedIds = new Set<string>();

  for (const [pageIndex, notes] of [...notesByPage(score)].sort((a, b) => a[0] - b[0])) {
    const pageGeometry = geometry[pageIndex];
    const pageInfo = pageInfos.get(pageIndex);
    const interlinePx = pageInfo?.interlinePx ?? pageGeometry?.image?.interlinePx ?? 0;
    const scale = pageInfo === undefined ? null : pxPerPt(pageInfo);
    const fontPx =
      scale === null ? interlinePx * FALLBACK_FONT_PX_PER_INTERLINE : settings.fontSizePt * scale;

    if (pageInfo === undefined || pageGeometry === undefined) {
      // 衝突回避なしで置くことになる。無言で品質を落とさず必ず報告する
      issues.push({ kind: 'missingPageGeometry', pageIndex });
    }

    const space = new PlacementSpace(pageGeometry?.symbols ?? [], interlinePx);

    // 既存の手動注釈を先に占有させ、自動注釈が真上へ重ならないようにする。
    // anchor は左端＋ベースラインなので、矩形の上端はベースラインからアセンダ分だけ上
    for (const manual of manualByPage.get(pageIndex) ?? []) {
      const height = fonts.regular.ascentPt(fontPx);
      space.occupy({
        x: manual.anchor.x,
        y: manual.anchor.y - height,
        w: fonts.regular.widthPt(manual.text ?? '', fontPx),
        h: height,
      });
    }

    for (const note of notes) {
      const syllable = syllableOf(note, settings);
      if (syllable === null) {
        continue; // 階名のない音符（休符等）には注釈を付けない
      }
      const id = autoAnnotationId(note.id);
      generatedIds.add(id);
      const previous = previousById.get(id);
      // 非表示にされた自動注釈は描画されない。place() へ通すと配置スペースを占有して
      // 見えている注釈を無駄に押し出し、placementUnresolved も水増しする。位置は前回値を
      // 引き継いで記録だけ作り直す（deleted と手動上書きの保全のため）
      if (previous?.deleted) {
        annotations.push(toAnnotation(id, note.id, previous.anchor, previous));
        continue;
      }
      // 手動で書き換えた文字があるならその幅で場所を取る（描画と配置で同じ文字列を使う）
      const text = previous?.text ?? syllable;
      const metrics =
        note.solfa !== null && note.solfa.alteration !== 0 ? fonts.bold : fonts.regular;
      // 幅・高さはフォントサイズに比例するため、px 単位のサイズを渡せば px 単位で返る
      // （pt→px の換算を別途掛けると、fontSizePt が 0 のときに 0 除算になる）
      const placement = space.place({
        headCenterX: note.head.x,
        headTopY: note.head.y,
        width: metrics.widthPt(text, fontPx),
        height: metrics.ascentPt(fontPx),
        interlinePx,
      });
      if (!placement.resolved) {
        issues.push({ kind: 'placementUnresolved', annotationId: id, pageIndex });
      }
      annotations.push(
        toAnnotation(
          id,
          note.id,
          { pageIndex: note.head.pageIndex, x: placement.x, y: placement.y },
          previous,
        ),
      );
    }
  }

  // 対応する音符が消えた自動注釈は捨てずに残し、孤立していることを伝える
  // （機能設計書「照合できない場合は孤立注釈として修正UIに提示する」）
  for (const annotation of existing) {
    if (annotation.origin === 'manual') {
      annotations.push(annotation);
      continue;
    }
    if (!generatedIds.has(annotation.id)) {
      issues.push({ kind: 'orphanAnnotation', annotationId: annotation.id });
      annotations.push(annotation);
    }
  }

  return { annotations, issues };
}

function toAnnotation(
  id: string,
  noteId: string,
  anchor: PageAnchor,
  previous: Annotation | undefined,
): Annotation {
  return {
    id,
    layer: 'solfa',
    anchor,
    noteId,
    // 手動で書き換えた文字と、非表示にした記録は再生成でも引き継ぐ
    text: previous?.text ?? null,
    origin: 'auto',
    deleted: previous?.deleted ?? false,
  };
}

/** 手動注釈を作る（F-5。UI は Phase 6 だが API は先に用意する） */
export function addAnnotation(anchor: PageAnchor, text: string, id: string): Annotation {
  return { id, layer: 'solfa', anchor, noteId: null, text, origin: 'manual', deleted: false };
}

/** 注釈を部分更新した新しい配列を返す（id は変更させない） */
export function updateAnnotation(
  annotations: readonly Annotation[],
  id: string,
  patch: Partial<Omit<Annotation, 'id'>>,
): Annotation[] {
  return annotations.map((annotation) =>
    annotation.id === id ? { ...annotation, ...patch } : annotation,
  );
}

/**
 * 注釈を削除する
 *
 * 自動注釈は**消さずに `deleted` を立てる**。実体を消すと次の再生成で復活してしまう
 * （機能設計書「自動生成注釈の非表示化（再生成で復活させない）」）
 */
export function removeAnnotation(annotations: readonly Annotation[], id: string): Annotation[] {
  const target = annotations.find((annotation) => annotation.id === id);
  if (target === undefined) {
    return [...annotations];
  }
  return target.origin === 'manual'
    ? annotations.filter((annotation) => annotation.id !== id)
    : updateAnnotation(annotations, id, { deleted: true });
}

/** 階名が欠落している小節（Editor のジャンプ先一覧） */
export function listSkippedMeasures(score: ScoreModel): Measure[] {
  return score.measures.filter((measure) => measure.status === 'skipped');
}

/** 機能設計書のクラス形に合わせた薄い入口（実体は上の純関数群） */
export class AnnotationManager {
  regenerate(input: RegenerateInput): RegenerateResult {
    return regenerateAnnotations(input);
  }

  add(anchor: PageAnchor, text: string, id: string): Annotation {
    return addAnnotation(anchor, text, id);
  }

  update(
    annotations: readonly Annotation[],
    id: string,
    patch: Partial<Omit<Annotation, 'id'>>,
  ): Annotation[] {
    return updateAnnotation(annotations, id, patch);
  }

  remove(annotations: readonly Annotation[], id: string): Annotation[] {
    return removeAnnotation(annotations, id);
  }

  listSkippedMeasures(score: ScoreModel): Measure[] {
    return listSkippedMeasures(score);
  }
}

export type { SolfaFonts };
