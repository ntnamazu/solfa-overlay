/**
 * OMR（Audiveris ヘッドレス実行）の進捗イベント
 *
 * OmrRunner が子プロセスのログを解釈してコールバック通知する。Main→Renderer の IPC 越し
 * 表示（OmrProgress 画面, 別フェーズ）を見据えて shared に置き、副作用フリーの純データにする。
 */

/** 進捗の局面（Audiveris の処理ステップを粗く分類したもの） */
export type OmrPhase =
  | 'starting' // プロセス起動〜最初のログ受信まで
  | 'loading' // 入力（PDF）の読み込み
  | 'transcribing' // シート（ページ）の認識処理
  | 'exporting' // MusicXML / book の書き出し
  | 'completed'; // 正常終了

export interface OmrProgress {
  phase: OmrPhase;
  /** 処理中のシート番号（1始まり）。特定できなければ null */
  sheet: number | null;
  /** 総シート数（判明していれば）。不明なら null */
  totalSheets: number | null;
  /** 由来となったログ行（UI 表示・デバッグ用の生テキスト） */
  message: string;
}
