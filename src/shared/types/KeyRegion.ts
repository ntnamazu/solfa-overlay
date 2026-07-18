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
