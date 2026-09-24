import { DEFAULT_SETTINGS } from '../../shared/constants/DEFAULT_SETTINGS';
import type { Annotation } from '../../shared/types/Annotation';
import type { AnnotationIssue } from '../../shared/types/Issues';
import type { PageInfo } from '../../shared/types/Project';
import type { ProjectSettings } from '../../shared/types/ProjectSettings';
import type {
  ScorePreview,
  ScorePreviewPage,
  ScorePreviewRegion,
  ScorePreviewStyle,
} from '../../shared/types/ScorePreview';
import type { Measure, ScoreModel, SystemInfo } from '../../shared/types/ScoreModel';
import type { OmrPageContent } from '../score/OmrSheetParser';
import {
  annotationContent,
  isDrawnAnnotation,
  normalizeHexColor,
  notesById,
} from './annotationContent';
import { toPreviewPoint } from './coordinateTransform';
import { genericFontFamily, solfaFonts } from './fontMetrics';
import { pageInfoByIndex } from './pageInfo';

/**
 * Editor の楽譜プレビューに重ねる内容を組み立てる（機能設計書「Phase 6 で追加する」）
 *
 * **出力PDFと同じ位置・同じ文字**になることが要点。そのため:
 *
 * - 注釈の文字列・変化音の判定は `annotationContent`（OverlayRenderer と共有）で決める
 * - 描けない文字の置換も出力PDFと同じ `displayText` を通す
 * - 座標は OverlayRenderer と同じ縮尺（`toPreviewPoint`。y を反転しないだけ）で変換する
 *
 * ページは**元PDFのページ**でまとめる。Audiveris は 1 つの sheet の中で movement 境界を
 * 見つけるとページを分けるため（Victoria は Audiveris 4 ページ → 元PDF 3 ページ）、
 * Audiveris のページでまとめると元PDFの同じページが二重に並ぶ。
 */

export interface ScorePreviewInput {
  /** `applyDegrees` 済み（`note.solfa` が入っている） */
  score: ScoreModel;
  /** `.omr` の段・小節の物理構造（`OmrArtifacts.pages`）。添字は Audiveris ページ */
  omrPages: readonly OmrPageContent[];
  pages: readonly PageInfo[];
  annotations: readonly Annotation[];
  annotationIssues: readonly AnnotationIssue[];
  settings: ProjectSettings;
}

/** 設定の見た目を、出力PDFが実際に使う値へ正規化する */
function resolveStyle(settings: ProjectSettings): ScorePreviewStyle {
  return {
    fontFamily: genericFontFamily(settings.fontFamily),
    fontSizePt: settings.fontSizePt,
    // OverlayRenderer と同じく、解釈できない色は既定色へ落とす
    diatonicColor:
      normalizeHexColor(settings.diatonicColor) ??
      (normalizeHexColor(DEFAULT_SETTINGS.diatonicColor) as string),
    chromaticColor:
      normalizeHexColor(settings.chromaticColor) ??
      (normalizeHexColor(DEFAULT_SETTINGS.chromaticColor) as string),
  };
}

/** 元PDFページごとの入れ物を必要になった時点で作る */
class PageCollector {
  private readonly bySource = new Map<number, ScorePreviewPage>();

  pageFor(info: PageInfo): ScorePreviewPage {
    const existing = this.bySource.get(info.sourcePageIndex);
    if (existing !== undefined) {
      return existing;
    }
    const page: ScorePreviewPage = {
      sourcePageIndex: info.sourcePageIndex,
      widthPt: info.widthPt,
      heightPt: info.heightPt,
      annotations: [],
      skippedMeasures: [],
      placementWarnings: [],
    };
    this.bySource.set(info.sourcePageIndex, page);
    return page;
  }

  toPages(): ScorePreviewPage[] {
    return [...this.bySource.values()].sort((a, b) => a.sourcePageIndex - b.sourcePageIndex);
  }
}

/** 通し小節番号を含む段を探す */
function systemOf(systems: readonly SystemInfo[], measureIndex: number): SystemInfo | undefined {
  return systems.find(
    (system) =>
      system.firstMeasureIndex <= measureIndex &&
      measureIndex < system.firstMeasureIndex + system.measureCount,
  );
}

/**
 * スキップ小節のハイライト範囲（`.omr` px）を求める
 *
 * 横は小節の stack、縦はその段でパートに属する譜表の譜線範囲。stack が無い小節
 * （`measureNotDetected`）は段全体の横範囲へ広げる。段や譜線の位置が分からない小節は
 * **推測で描かず** null を返す（一覧側が「位置を特定できない」行として残す）
 */
function skippedRegionPx(
  measure: Measure,
  system: SystemInfo,
  omrPages: readonly OmrPageContent[],
  interlinePx: number,
): { left: number; right: number; top: number; bottom: number } | null {
  const omrSystem = omrPages[system.pageIndex]?.systems[system.systemIndex];
  if (omrSystem === undefined) {
    return null;
  }
  const extents = omrSystem.staves
    .filter((staff) => staff.partId === measure.partId)
    .flatMap((staff) => (staff.extent === undefined ? [] : [staff.extent]));
  const stack = omrSystem.stacks[measure.index - system.firstMeasureIndex];
  const first = omrSystem.stacks[0];
  const last = omrSystem.stacks[omrSystem.stacks.length - 1];
  const horizontal = stack ?? (first && last ? { left: first.left, right: last.right } : null);
  if (extents.length === 0 || horizontal === null) {
    return null;
  }
  // 譜線ちょうどで切ると最上線・最下線の上の符頭が枠からはみ出すため、半譜線間隔ぶん広げる
  const margin = interlinePx / 2;
  return {
    left: horizontal.left,
    right: horizontal.right,
    top: Math.min(...extents.map((extent) => extent.top)) - margin,
    bottom: Math.max(...extents.map((extent) => extent.bottom)) + margin,
  };
}

/** Editor の楽譜プレビューに重ねる内容を組み立てる */
export function buildScorePreview(input: ScorePreviewInput): ScorePreview {
  const { score, omrPages, settings } = input;
  const pageInfos = pageInfoByIndex(input.pages);
  const notes = notesById(score);
  const fonts = solfaFonts(settings.fontFamily);
  const collector = new PageCollector();

  for (const annotation of input.annotations) {
    if (!isDrawnAnnotation(annotation)) {
      continue;
    }
    const content = annotationContent(annotation, notes, settings.syllableSystem);
    const info = pageInfos.get(annotation.anchor.pageIndex);
    const point =
      info === undefined ? null : toPreviewPoint(info, annotation.anchor.x, annotation.anchor.y);
    // 出力PDFに描かれない注釈（文字が決まらない・ページ寸法が無い）は画面にも出さない
    if (content === null || info === undefined || point === null) {
      continue;
    }
    // 変化音は太字で描くため、置換も太字の書体で判定する（OverlayRenderer と同じ）
    const metrics = content.chromatic ? fonts.bold : fonts.regular;
    collector.pageFor(info).annotations.push({
      id: annotation.id,
      x: point.x,
      y: point.y,
      text: metrics.displayText(content.text).text,
      chromatic: content.chromatic,
      origin: annotation.origin,
      textOverridden: annotation.origin === 'auto' && annotation.text !== null,
    });
  }

  const annotationsById = new Map(
    input.annotations.map((annotation) => [annotation.id, annotation]),
  );
  for (const issue of input.annotationIssues) {
    if (issue.kind !== 'placementUnresolved') {
      continue;
    }
    const anchor = annotationsById.get(issue.annotationId)?.anchor;
    const info = anchor === undefined ? undefined : pageInfos.get(anchor.pageIndex);
    const point =
      anchor === undefined || info === undefined ? null : toPreviewPoint(info, anchor.x, anchor.y);
    if (info === undefined || point === null) {
      continue;
    }
    collector.pageFor(info).placementWarnings.push({ annotationId: issue.annotationId, ...point });
  }

  for (const measure of score.measures) {
    if (measure.status !== 'skipped') {
      continue;
    }
    const region = skippedRegion(measure, score.systems, omrPages, pageInfos);
    if (region !== null) {
      collector.pageFor(region.info).skippedMeasures.push(region.region);
    }
  }

  return { style: resolveStyle(settings), pages: collector.toPages() };
}

/** スキップ小節 1 つのハイライト範囲を画面座標で求める */
function skippedRegion(
  measure: Measure,
  systems: readonly SystemInfo[],
  omrPages: readonly OmrPageContent[],
  pageInfos: ReadonlyMap<number, PageInfo>,
): { info: PageInfo; region: ScorePreviewRegion } | null {
  const system = systemOf(systems, measure.index);
  const info = system === undefined ? undefined : pageInfos.get(system.pageIndex);
  if (system === undefined || info === undefined) {
    return null;
  }
  const px = skippedRegionPx(measure, system, omrPages, info.interlinePx);
  const topLeft = px === null ? null : toPreviewPoint(info, px.left, px.top);
  const bottomRight = px === null ? null : toPreviewPoint(info, px.right, px.bottom);
  if (topLeft === null || bottomRight === null) {
    return null;
  }
  return {
    info,
    region: {
      partId: measure.partId,
      measureIndex: measure.index,
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    },
  };
}
