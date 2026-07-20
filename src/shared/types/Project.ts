import type { Annotation } from './Annotation';
import type { ConfirmationState } from './Confirmation';
import type { KeyRegion, KeyRegionDecision } from './KeyRegion';
import type { ProjectSettings } from './ProjectSettings';
import type { ScoreModel } from './ScoreModel';
import type { StructureDecision } from './StructureDecision';

/**
 * ページごとの寸法（.omr のピクセル座標 → PDF ポイント座標の線形変換に使う）
 *
 * 実値の取得には PDF のページ寸法（pdf-lib / PDF.js）と .omr の画像寸法が必要なため、
 * populate は オーバーレイ描画を実装する Phase 5 で行う。現時点では空配列を永続化する
 */
export interface PageInfo {
  /** 0始まり */
  pageIndex: number;
  /** PDFポイント */
  widthPt: number;
  heightPt: number;
  /** .omr の座標基準（300dpi画像） */
  omrImageWidthPx: number;
  omrImageHeightPx: number;
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
