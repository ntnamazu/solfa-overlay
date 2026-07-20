/**
 * 確認画面（StructureConfirm）での譜表構造に関するユーザー判断
 *
 * `BookStructureResolver.resolve()` へ渡して確定構造に反映するほか、
 * プロジェクトファイルへ永続化して再開時に同じ構造を復元する。
 * このため domain ではなく shared に置く（storage は domain へ依存できない）
 */
export type StructureDecision =
  /** 段の小節数を上書きする */
  | { kind: 'systemMeasureCount'; pageIndex: number; systemIndex: number; measureCount: number }
  /** movement（ページ群）に対応づける MusicXML を上書きする */
  | { kind: 'movementAssignment'; movementIndex: number; musicXmlIndex: number };
