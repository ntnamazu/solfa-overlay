import type { OmrPhase, OmrProgress } from '../../shared/types/OmrProgress';

/**
 * Audiveris ヘッドレス実行のコマンド組み立てと進捗ログ解釈（副作用なしの純粋関数群）
 *
 * 子プロセス起動そのものは OmrRunner が行う。ここでは「何を渡すか」「ログをどう読むか」だけを
 * 純粋に決め、Audiveris 非搭載の環境でも単体テストできるようにする。
 */

/**
 * Audiveris CLI へ渡す引数配列を組み立てる
 *
 * セキュリティ要件（機能設計書・アーキテクチャ）: ユーザー入力（PDF パス）はシェル文字列に
 * 連結せず配列要素として渡す。`--` 以降を入力ファイルとして分離し、パスがオプションと誤認
 * されないようにする。
 *
 * - `-batch`  GUI を開かずバッチ実行
 * - `-save`   book（`.omr`＝座標情報）を保存
 * - `-export` MusicXML（`.mxl`）を書き出し
 * - `-output` 出力先ディレクトリ
 */
export function buildAudiverisArgs(pdfPath: string, outputDir: string): string[] {
  return ['-batch', '-save', '-export', '-output', outputDir, '--', pdfPath];
}

/**
 * ヘッドレス実行に必要な環境変数を付与した env を返す（元の env は破壊しない）
 *
 * - `-Djava.awt.headless=true`（プロトタイプで確認済み。GUI を持たない環境で AWT を無効化）
 * - Linux では `GDK_SCALE=1`（HiDPI スケール由来の座標ずれを避ける。プロトタイプで確認済み）
 *
 * 既存の `JAVA_TOOL_OPTIONS` は保持し、headless 指定を追記する。
 */
export function buildAudiverisEnv(
  platform: NodeJS.Platform,
  base: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const headless = '-Djava.awt.headless=true';
  const existing = base.JAVA_TOOL_OPTIONS?.trim();
  const env: NodeJS.ProcessEnv = {
    ...base,
    JAVA_TOOL_OPTIONS: existing ? `${existing} ${headless}` : headless,
  };
  if (platform === 'linux') {
    env.GDK_SCALE = '1';
  }
  return env;
}

/** シート番号を表すログ断片（例: "sheet#2" / "Sheet #2"）から番号を取り出す */
function extractSheetNumber(line: string): number | null {
  const match = /sheet\s*#?(\d+)/i.exec(line);
  if (match === null) {
    return null;
  }
  const value = Number.parseInt(match[1] ?? '', 10);
  return Number.isNaN(value) ? null : value;
}

/** ログ行に含まれるキーワードから局面を推定する（判定できなければ null） */
function detectPhase(line: string, hasSheet: boolean): OmrPhase | null {
  const lower = line.toLowerCase();
  if (/export|exported|exporting/.test(lower)) {
    return 'exporting';
  }
  if (/loading|loaded|\bload\b/.test(lower)) {
    return 'loading';
  }
  // シート番号を伴う処理ログは認識（transcribing）とみなす
  if (hasSheet) {
    return 'transcribing';
  }
  return null;
}

/**
 * Audiveris のログ 1 行を進捗イベントへ変換する（該当しなければ null）
 *
 * Audiveris のログ書式に依存するヒューリスティック。実 Audiveris ログでの調整余地があるため、
 * 解釈できない行は null（進捗欠落）に留め、クラッシュや誤進捗を出さないことを優先する。
 */
export function parseProgressLine(line: string): OmrProgress | null {
  const trimmed = line.trim();
  if (trimmed === '') {
    return null;
  }
  const sheet = extractSheetNumber(trimmed);
  const phase = detectPhase(trimmed, sheet !== null);
  if (phase === null) {
    return null;
  }
  return { phase, sheet, totalSheets: null, message: trimmed };
}
