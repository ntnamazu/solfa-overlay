import type { PageAnchor, StaffRef } from './ScoreModel';

/**
 * 確認画面（ClefKeyConfirm / StructureConfirm）の確認項目1件（機能設計書 F-2）
 *
 * detected / corrected の表記規則:
 * - clef: Audiveris の kind 表記（例: 'TREBLE', 'TREBLE_DOWN_8', 'BASS'）。
 *   ScoreModelBuilder が clefTable の逆算にそのまま使うため、表示用文字列ではなく kind を保持する
 * - keySignature: 調号の fifths を文字列化した値（例: '1', '-3'）
 */
export interface ConfirmationItem {
  id: string;
  kind: 'clef' | 'keySignature' | 'systemStructure';
  staffRef: StaffRef;
  /** 検出値 */
  detected: string;
  /** ユーザー修正値。null なら検出値を採用 */
  corrected: string | null;
  /** 元画像の切り抜き範囲（確認UIで検出値と目視照合するため） */
  clipRect: PageAnchor & { width: number; height: number };
}

/**
 * 音部記号・調号の確認状態（F-2）
 *
 * 制約: completedAt が null の間は階名生成・PDF出力に進めない（機能設計書の受け入れ条件。
 * ゲートは編成レイヤーが強制する）
 */
export interface ConfirmationState {
  items: ConfirmationItem[];
  /** ISO 8601。未完了なら null */
  completedAt: string | null;
}
