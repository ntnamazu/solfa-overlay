import type { PitchStep } from './Pitch';

/** 楽譜上の位置（小節＋小節内オフセット） */
export interface ScorePosition {
  measureIndex: number;
  /** 小節内オフセット（divisions基準）。小節頭は0 */
  offset: number;
}

/**
 * 調文脈。転調点で区切られた区間ごとに1つ
 *
 * 制約: KeyRegion は start 昇順で重複なし。先頭要素は曲頭（measureIndex=0, offset=0）に必ず存在する
 * （機能設計書「データモデル定義」の制約）
 */
export interface KeyRegion {
  id: string;
  /** この調が始まる位置 */
  start: ScorePosition;
  /** 主音 */
  tonicStep: PitchStep;
  tonicAlter: number;
  mode: 'major' | 'minor';
  /** 自動検出（調号変更）かユーザー指定か */
  source: 'auto' | 'user';
}

/**
 * 確認画面（ClefKeyConfirm）での調文脈の訂正
 *
 * **旋法（mode）の指定が本アプリの主目的に直結する**: Audiveris は `<key><fifths>` のみを
 * 出力し `<mode>` を書かないため、自動生成される調文脈は必ず長調になる。
 * 長調では La 基準と Do 基準で do の位置が変わらないため、**ユーザーが短調を指定するまで
 * La 基準の移動ドは一切機能しない**（用語集「La基準 / Do基準」）。
 *
 * 対象は**自動検出済みの区間のみ**で、`measureIndex` は既存 `KeyRegion` の開始位置と一致させる。
 * 区間そのものの新規追加（小節途中の転調指定）は F-6 の担当であり、一致しない decision は
 * 例外にせず `unmatchedKeyDecision` として報告される
 */
export interface KeyRegionDecision {
  /** 訂正対象の KeyRegion の開始通し小節番号 */
  measureIndex: number;
  /** 調号（五度圏 -7〜+7）の上書き。省略時は自動検出値を採用 */
  fifths?: number;
  /** 旋法の上書き。省略時は自動検出値（＝Audiveris 由来では常に 'major'） */
  mode?: 'major' | 'minor';
}
