/** 階名（度数＋変位）を表示文字列にする際の音節体系（用語集「音節体系」） */
export type SyllableSystem = 'kodaly' | 'tonicSolfa';

/** 短調の階名の振り方の流儀（用語集「La基準 / Do基準」） */
export type MinorBasis = 'la' | 'do';

/** プロジェクト設定（PRD F-3 の決定事項） */
export interface ProjectSettings {
  /** デフォルト: 'kodaly' */
  syllableSystem: SyllableSystem;
  /** デフォルト: 'la' */
  minorBasis: MinorBasis;
  /** 幹音の階名の色。デフォルト: 濃赤 */
  diatonicColor: string;
  /** 半音変化した階名の色。デフォルト: 紫 */
  chromaticColor: string;
  /** 小サイズ判読性を選定基準とする（PRD F-4） */
  fontFamily: string;
  fontSizePt: number;
}
