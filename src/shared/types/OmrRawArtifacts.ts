/**
 * Audiveris が出力した生バイト列一式
 *
 * プロジェクトファイルへ同梱して**OMR を再実行せずにプロジェクトを再開する**ための最小単位。
 * `assembleArtifacts()` がこの 2 つから `OmrArtifacts`（パース済み構造）を完全に再現できる。
 * `book.xml` は `.omr`（zip）の内部にあるため別途持つ必要はない
 */
export interface OmrRawArtifacts {
  /** Audiveris の `.omr`（zip。sheet XML と book.xml を内包） */
  omr: Uint8Array;
  /** movement ごとの `.mxl`（zip）。曲順 */
  movements: Uint8Array[];
}
