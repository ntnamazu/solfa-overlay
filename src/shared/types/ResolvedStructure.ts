/**
 * 譜表構造の確定結果（v1 最小形）
 *
 * BookStructureResolver（未実装）がユーザー承認を経て出力する確定構造。現時点では
 * 「どの MusicXML（movement）がどのページ列に対応するか」のみを表現する。
 * 誤分割の統合・譜表→パート再割当の表現は BookStructureResolver 実装時に拡張する
 */
export interface ResolvedMovement {
  /** OmrArtifacts.movements の添字（この movement の MusicXML） */
  musicXmlIndex: number;
  /** この movement に属するページ（曲全体のページ順・0始まり） */
  pageIndices: number[];
}

export interface ResolvedStructure {
  /** 曲順。通し小節番号は movement を跨いで累積される */
  movements: ResolvedMovement[];
}
