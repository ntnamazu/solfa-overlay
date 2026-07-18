import type { ProjectSettings } from '../types/ProjectSettings';

/**
 * プロジェクト設定の既定値（PRD F-3 / 機能設計書「カラーコーディング」）
 *
 * fontFamily / fontSizePt は仮値。書体は F-4（オーバーレイ描画）実装時に
 * 小サイズ判読性（小文字「l」の弁別）を基準に選定する
 */
export const DEFAULT_SETTINGS: ProjectSettings = {
  syllableSystem: 'kodaly',
  minorBasis: 'la',
  diatonicColor: '#8b0000',
  chromaticColor: '#6a0dad',
  fontFamily: 'sans-serif',
  fontSizePt: 8,
};
