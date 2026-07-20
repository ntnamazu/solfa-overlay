import type { Annotation } from './Annotation';
import type { ConfirmationState } from './Confirmation';
import type { KeyRegion, KeyRegionDecision } from './KeyRegion';
import type { ProjectSettings } from './ProjectSettings';
import type { ScoreModel } from './ScoreModel';
import type { StructureDecision } from './StructureDecision';

/**
 * ページごとの寸法（.omr のピクセル座標 → PDF ポイント座標の線形変換に使う）
 *
 * `domain/render/pageInfo.ts` の `buildPageInfos` が、元PDF と `.omr` の両方を見て組み立てる。
 */
export interface PageInfo {
  /** Audiveris のページ添字（= `PageAnchor.pageIndex`）。0始まり */
  pageIndex: number;
  /**
   * 元PDF のページ添字。0始まり
   *
   * **`pageIndex` とは一致しない。** Audiveris は 1 つの sheet（＝元PDFの1ページ）の中で
   * movement 境界を検出すると page を分割するため、1 つの元PDFページに複数の Audiveris
   * ページが対応し得る（Victoria フィクスチャは 3 sheet に対し 4 page で、sheet#1 が
   * page 0 と page 1 を含む）。この対応を取り違えると注釈が丸ごと別ページへ描かれる
   */
  sourcePageIndex: number;
  /** 元PDFページの寸法（PDFポイント）。ページ回転 90/270 は適用済み */
  widthPt: number;
  heightPt: number;
  /** .omr の座標基準（sheet 単位の画像。同一 sheet の全ページが共有する） */
  omrImageWidthPx: number;
  omrImageHeightPx: number;
  /** 譜線間隔（px）。注釈の配置オフセットの基準 */
  interlinePx: number;
}

/**
 * プロジェクト全体（`.solfaproj` 内 `project.json` のルート）
 *
 * `score` / `keyRegions` は解析結果のキャッシュであり、**正は decisions 側**にある。
 * 確定構造・照合・調文脈は `structureDecisions` / `confirmation` / `keyRegionDecisions` と
 * 同梱した OMR 成果物から再現できるため、認識ロジックを改善しても保存済みプロジェクトの
 * ユーザー判断は生き続ける（信頼性要件「修正作業の永続化」）
 */
export interface Project {
  /** project.json のスキーマ版数（v1 = 1）。互換性判定に使う */
  schemaVersion: number;
  id: string;
  /** プロジェクト内に取り込んだ元PDFの相対パス */
  sourcePdf: string;
  pages: PageInfo[];
  /** OMR＋照合の結果（OMR未実行なら null） */
  score: ScoreModel | null;
  /** 音部記号の確認状態。completedAt が null の間は階名生成・PDF出力に進めない */
  confirmation: ConfirmationState;
  /** 譜表構造に対するユーザー判断 */
  structureDecisions: StructureDecision[];
  /** 調文脈に対するユーザー判断（旋法・調号の訂正） */
  keyRegionDecisions: KeyRegionDecision[];
  /** 調文脈（自動検出＋ユーザー訂正の反映結果） */
  keyRegions: KeyRegion[];
  /** 注釈レイヤー（自動生成＋手動。Phase 5 で使用） */
  annotations: Annotation[];
  settings: ProjectSettings;
  /** ISO 8601 */
  createdAt: string;
  updatedAt: string;
}
