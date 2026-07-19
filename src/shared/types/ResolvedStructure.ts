/**
 * 譜表構造の確定結果
 *
 * BookStructureResolver がユーザー承認を経て出力する確定構造。
 * 「どの MusicXML（movement）がどのページ列に対応するか」に加えて、
 * **段（システム）ごとの通し小節番号アンカー**を持つ。
 *
 * アンカーを構造側で確定させることで、Audiveris の段検出のブレ（ある段だけ stack が 1 つ多い等）が
 * 以降の全小節へ波及するのを防ぐ（ScoreModelBuilder は stack 数を累積しない）
 */

/** 段（システム）1 つ分の確定小節割当 */
export interface ResolvedSystem {
  /** 曲全体のページ順（0始まり。OmrArtifacts.pages の添字） */
  pageIndex: number;
  /** ページ内の段番号（0始まり。OmrPageContent.systems の添字） */
  systemIndex: number;
  /** この段の先頭小節の通し小節番号 */
  firstMeasureIndex: number;
  /** この段が担当する論理小節数（MusicXML のレイアウト由来。なければ OMR の stack 数） */
  measureCount: number;
}

export interface ResolvedMovement {
  /** OmrArtifacts.movements の添字（この movement の MusicXML） */
  musicXmlIndex: number;
  /** この movement に属するページ（曲全体のページ順・0始まり。確認画面の表示材料） */
  pageIndices: number[];
  /** 段ごとの確定小節割当（ページ順・段順）。照合はこの順序で駆動される */
  systems: ResolvedSystem[];
}

export interface ResolvedStructure {
  /** 曲順。通し小節番号は movement を跨いで累積される */
  movements: ResolvedMovement[];
}
