/**
 * プロジェクトファイルの読み書きの失敗
 *
 * `reason` の種別は用語集「プロジェクトファイルエラー」の定義を正とする:
 * - `zip`: アーカイブとして壊れている／必須エントリがない
 * - `schema`: `project.json` が構造検証に通らない
 * - `version`: アプリより新しい `schemaVersion`。**ファイルを変更せず**アプリ更新を案内する
 * - `io`: ディスク・権限などの入出力エラー
 *
 * いずれも UI で回復可能に扱う（機能設計書「エラーハンドリング」）。
 * `cause` は `Error` の標準オプションとして別に渡す
 */
export class ProjectFileError extends Error {
  constructor(
    message: string,
    public readonly reason: 'zip' | 'schema' | 'version' | 'io',
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ProjectFileError';
  }
}
