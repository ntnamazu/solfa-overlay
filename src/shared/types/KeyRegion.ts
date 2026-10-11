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

/**
 * 転調点の指定（F-6）。Editor の楽譜プレビューで指定し、**小節の頭から**適用する
 *
 * 確認画面の訂正（`KeyRegionDecision`）が既存区間の訂正しか行わないのに対し、こちらは
 * 区間の挿入・上書き・削除を行う。調号が変わらない一時転調や読み替えは歌い手の解釈であり、
 * 自動検出では拾えないため（用語集「転調 / 転調点」）。
 *
 * 調は `KeyRegionDecision` と同じく**調号（fifths）＋旋法**で持つ。主音で持つと
 * 異名同音（C♭ 長調と B 長調など）の扱いと範囲の検証を別に決める必要があるが、
 * 調号なら主音表（`tonicForFifths`）で一意に決まる。
 *
 * 1 小節につき指定は 1 件（同じ小節への編集は置き換える）。小節の途中（拍位置）からの転調は
 * 扱わない: `NoteEvent` が小節内オフセットを持たず、パートごとに divisions も異なるため
 */
export type KeyChange =
  /** この小節から指定の調で読む（区切りが無ければ挿入し、あれば上書きする） */
  | { kind: 'set'; measureIndex: number; fifths: number; mode: 'major' | 'minor' }
  /** この小節で始まる区切りを取り除く（前の区間の調が続く）。曲頭は取り除けない */
  | { kind: 'remove'; measureIndex: number };

/**
 * Editor から送る転調点の編集 1 件（F-6）
 *
 * 保存する `KeyChange` と同じ `set` / `remove` に、**指定を取り消して自動判定に戻す** `revert` を足したもの。
 * 削除（`remove`）と自動判定に戻す（`revert`）は、自動判定の区切りを上書きした小節で結果が違う:
 * 削除はその区切りごと取り除き（前の区間の調が続く）、戻すは自動判定の調に戻す。
 *
 * `remove` の保存のされ方は Main が決める。自動判定の区切りが無い小節（書き足した転調点）の削除は
 * 指定の記録を消すだけにする。`remove` を残すと、取り除く区切りが無いため毎回
 * 「適用できなかった指定」として報告されてしまう
 */
export type KeyChangeEdit = KeyChange | { kind: 'revert'; measureIndex: number };
