import { DEFAULT_SETTINGS } from '../../shared/constants/DEFAULT_SETTINGS';
import type { Annotation } from '../../shared/types/Annotation';
import type { AnnotationIssue } from '../../shared/types/Issues';
import type { KeyRegion } from '../../shared/types/KeyRegion';
import type { PageInfo } from '../../shared/types/Project';
import type { ProjectSettings } from '../../shared/types/ProjectSettings';
import type {
  ScorePreview,
  ScorePreviewMeasure,
  ScorePreviewPage,
  ScorePreviewRegion,
  ScorePreviewStyle,
} from '../../shared/types/ScorePreview';
import type { Measure, ScoreModel, SystemInfo } from '../../shared/types/ScoreModel';
import type { OmrPageContent, OmrStaff } from '../score/OmrSheetParser';
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
  /** 調文脈（区切りの印を描く） */
  keyRegions: readonly KeyRegion[];
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
      measures: [],
      keyChanges: [],
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

/** `.omr` px の矩形（左右・上下の端） */
interface PxRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * 譜表の譜線範囲を縦にまとめた範囲（`.omr` px）。スキップ小節の枠と小節の範囲が共有する
 *
 * 譜線ちょうどで切ると最上線・最下線の上の符頭が枠からはみ出すため、半譜線間隔ぶん広げる。
 * 譜線範囲が取れた譜表だけで決め、1 つも取れなければ null（推測で範囲を作らない）
 */
function stavesVerticalRange(
  staves: readonly OmrStaff[],
  interlinePx: number,
): { top: number; bottom: number } | null {
  const extents = staves.flatMap((staff) => (staff.extent === undefined ? [] : [staff.extent]));
  if (extents.length === 0) {
    return null;
  }
  const margin = interlinePx / 2;
  return {
    top: Math.min(...extents.map((extent) => extent.top)) - margin,
    bottom: Math.max(...extents.map((extent) => extent.bottom)) + margin,
  };
}

/** `.omr` px の矩形を画面座標（pt・左上原点）の位置と大きさへ変換する。変換できなければ null */
function toPreviewRect(
  info: PageInfo,
  rect: PxRect,
): { x: number; y: number; width: number; height: number } | null {
  const topLeft = toPreviewPoint(info, rect.left, rect.top);
  const bottomRight = toPreviewPoint(info, rect.right, rect.bottom);
  if (topLeft === null || bottomRight === null) {
    return null;
  }
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
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
): PxRect | null {
  const omrSystem = omrPages[system.pageIndex]?.systems[system.systemIndex];
  if (omrSystem === undefined) {
    return null;
  }
  const vertical = stavesVerticalRange(
    omrSystem.staves.filter((staff) => staff.partId === measure.partId),
    interlinePx,
  );
  const stack = omrSystem.stacks[measure.index - system.firstMeasureIndex];
  const first = omrSystem.stacks[0];
  const last = omrSystem.stacks[omrSystem.stacks.length - 1];
  const horizontal = stack ?? (first && last ? { left: first.left, right: last.right } : null);
  if (vertical === null || horizontal === null) {
    return null;
  }
  return { left: horizontal.left, right: horizontal.right, ...vertical };
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

  const measures = measureRegions(score.systems, omrPages, pageInfos);
  for (const { info, region } of measures.values()) {
    collector.pageFor(info).measures.push(region);
  }
  for (const keyRegion of input.keyRegions) {
    const located = measures.get(keyRegion.start.measureIndex);
    // 位置が取れない区切りは印を作らない（Editor の「調の区切り」一覧からは開ける）
    if (located === undefined) {
      continue;
    }
    collector.pageFor(located.info).keyChanges.push({
      measureIndex: keyRegion.start.measureIndex,
      x: located.region.x,
      y: located.region.y,
      height: located.region.height,
      tonicStep: keyRegion.tonicStep,
      tonicAlter: keyRegion.tonicAlter,
      mode: keyRegion.mode,
      source: keyRegion.source,
    });
  }

  return { style: resolveStyle(settings), pages: collector.toPages() };
}

/**
 * 小節ごとの範囲（段の全譜表の縦範囲 × stack の横範囲）を画面座標で求める
 *
 * 縦はスキップ小節の枠と同じく、譜線ちょうどで切らず半譜線間隔ぶん広げる。
 * 譜線範囲が取れた譜表だけで縦範囲を決める（一部の譜表だけ欠けた段では範囲が狭くなるが、
 * 押して小節を決める用途には足りる。実データでは全譜表に譜線範囲が出る）。
 * stack・譜線範囲・ページ寸法のいずれかが分からない小節は**推測で作らない**
 * （押しても小節が決まらないだけで、転調点は「調の区切り」一覧や他の小節から指定できる）
 *
 * @returns 通し小節番号 → 範囲（段は曲順のため、同じ番号が 2 度現れたら先の段を採る）
 */
function measureRegions(
  systems: readonly SystemInfo[],
  omrPages: readonly OmrPageContent[],
  pageInfos: ReadonlyMap<number, PageInfo>,
): Map<number, { info: PageInfo; region: ScorePreviewMeasure }> {
  const regions = new Map<number, { info: PageInfo; region: ScorePreviewMeasure }>();
  for (const system of systems) {
    const info = pageInfos.get(system.pageIndex);
    const omrSystem = omrPages[system.pageIndex]?.systems[system.systemIndex];
    const vertical =
      info === undefined || omrSystem === undefined
        ? null
        : stavesVerticalRange(omrSystem.staves, info.interlinePx);
    if (info === undefined || omrSystem === undefined || vertical === null) {
      continue;
    }
    for (let offset = 0; offset < system.measureCount; offset += 1) {
      const measureIndex = system.firstMeasureIndex + offset;
      const stack = omrSystem.stacks[offset];
      // 先の段で登録済みの小節は座標を変換するまでもなく捨てる
      if (stack === undefined || regions.has(measureIndex)) {
        continue;
      }
      const rect = toPreviewRect(info, { left: stack.left, right: stack.right, ...vertical });
      if (rect !== null) {
        regions.set(measureIndex, { info, region: { measureIndex, ...rect } });
      }
    }
  }
  return regions;
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
  const rect = px === null ? null : toPreviewRect(info, px);
  if (rect === null) {
    return null;
  }
  return { info, region: { partId: measure.partId, measureIndex: measure.index, ...rect } };
}
