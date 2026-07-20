import { randomUUID } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { ProjectFileError } from './errors';

/**
 * 注釈付きPDFの原子的な書き出し（機能設計書「writeExportPdf」）
 *
 * `OverlayRenderer` が生成したバイト列をユーザー指定のパスへ書く。
 * 一時ファイルへ書いてからリネームすることで、**書き込み途中で失敗しても
 * 壊れた PDF を残さない**（エラーハンドリング表「PDF出力失敗」）。
 *
 * `ProjectStore.save` と違い**世代バックアップは取らない**。出力PDFは中間成果物であり、
 * 失われても `.solfaproj` からいつでも作り直せるため。
 */

/**
 * ファイル操作の最小インターフェース（差し替え可能にするための継ぎ目）
 *
 * `ProjectStore.FileOps` と同じ方針。リネームだけが失敗する経路は実ファイルシステムでは
 * 狙って再現できないため、テストから失敗を注入できるようにしてある
 */
export interface ExportFileOps {
  rename(from: string, to: string): Promise<void>;
}

const DEFAULT_FILE_OPS: ExportFileOps = { rename };

/**
 * 注釈付きPDFを書き出す
 *
 * @param outPath - 出力先。既存ファイルがあれば置き換える
 * @param pdfBytes - `OverlayRenderer` が生成したバイト列
 * @throws ProjectFileError reason='io' 書き込み・リネームに失敗した場合
 */
export async function writeExportPdf(
  outPath: string,
  pdfBytes: Uint8Array,
  deps?: { fileOps?: ExportFileOps },
): Promise<void> {
  const fs = deps?.fileOps ?? DEFAULT_FILE_OPS;
  // 一時ファイルは**出力先と同じディレクトリ**に作る。OS のテンポラリ領域に置くと
  // 別デバイスをまたぐリネームになり失敗する（ProjectStore.save と同じ理由）
  const temporary = join(dirname(outPath), `.${basename(outPath)}.tmp-${randomUUID()}`);
  try {
    await writeFile(temporary, pdfBytes);
    await fs.rename(temporary, outPath);
  } catch (cause) {
    // 書きかけの一時ファイルを残さない（次回の出力の邪魔になり、容量も食う）
    await rm(temporary, { force: true }).catch(() => undefined);
    throw new ProjectFileError(`PDFの書き出しに失敗しました: ${outPath}`, 'io', { cause });
  }
}
