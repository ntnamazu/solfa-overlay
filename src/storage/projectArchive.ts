import { strFromU8, strToU8 } from 'fflate';
import type { OmrRawArtifacts } from '../shared/types/OmrRawArtifacts';
import type { Project } from '../shared/types/Project';
import { ProjectFileError } from './errors';
import { parseProject } from './projectSchema';
import { ZipError, unzipEntries, zipEntriesAsync } from './zipArchive';

/**
 * `.solfaproj`（zip）の構成と読み書き（機能設計書「ファイル構造」）
 *
 * ```
 * project.json      Project エンティティ
 * source.pdf        取り込んだ元PDF（原本は変更しない）
 * omr/score.omr     Audiveris 出力（book.xml を内包）
 * omr/score.mxl     movement 0
 * omr/score.2.mxl   movement 1（複数 movement 曲。Victoria は 2 つ）
 * ```
 *
 * 中間データを同梱することで OMR 再実行なしにプロジェクトを再開でき、
 * 楽譜由来のデータがすべてこの 1 ファイル内に閉じる（ローカル完結要件）
 */

const PROJECT_JSON = 'project.json';
const SOURCE_PDF = 'source.pdf';
const OMR_FILE = 'omr/score.omr';

/** movement の `.mxl` エントリ名（1 つ目は添字なし。1始まりの通番で読みやすくする） */
function movementEntryName(index: number): string {
  return index === 0 ? 'omr/score.mxl' : `omr/score.${index + 1}.mxl`;
}

/** `.solfaproj` の中身一式 */
export interface ProjectArchive {
  project: Project;
  sourcePdf: Uint8Array;
  omr: OmrRawArtifacts;
}

/**
 * `.solfaproj` のバイト列を組み立てる
 *
 * 非同期なのは、圧縮を Main プロセスの同期処理にすると自動保存のたびに UI が固まるため
 * （`zipEntriesAsync` の TSDoc 参照）
 */
export async function packProject(archive: ProjectArchive): Promise<Uint8Array> {
  const entries = new Map<string, Uint8Array>();
  entries.set(PROJECT_JSON, strToU8(JSON.stringify(archive.project, null, 2)));
  entries.set(SOURCE_PDF, archive.sourcePdf);
  entries.set(OMR_FILE, archive.omr.omr);
  for (const [index, movement] of archive.omr.movements.entries()) {
    entries.set(movementEntryName(index), movement);
  }
  try {
    return await zipEntriesAsync(entries);
  } catch (cause) {
    /* v8 ignore next 2 -- エントリ名は固定文字列のため検証に落ちない */
    throw new ProjectFileError('プロジェクトファイルの生成に失敗しました', 'zip', { cause });
  }
}

/**
 * `.solfaproj` のバイト列から中身を復元する
 *
 * @throws ProjectFileError reason='zip' 展開失敗・必須エントリの欠落
 * @throws ProjectFileError reason='schema' | 'version' project.json の検証失敗
 */
export function unpackProject(bytes: Uint8Array): ProjectArchive {
  let entries: Map<string, Uint8Array>;
  try {
    entries = unzipEntries(bytes);
  } catch (cause) {
    if (cause instanceof ZipError) {
      throw new ProjectFileError(cause.message, 'zip', { cause });
    }
    /* v8 ignore next -- unzipEntries は ZipError 以外を投げない */
    throw cause;
  }

  const projectJson = requireEntry(entries, PROJECT_JSON);
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(projectJson));
  } catch (cause) {
    // JSON として壊れているのは構造以前の問題だが、ユーザーから見れば
    // 「project.json が読めない」であり schema と同じ回復手段（バックアップから開く）になる
    throw new ProjectFileError('project.json を解析できません', 'schema', { cause });
  }

  return {
    project: parseProject(raw),
    sourcePdf: requireEntry(entries, SOURCE_PDF),
    omr: {
      omr: requireEntry(entries, OMR_FILE),
      movements: collectMovements(entries),
    },
  };
}

function requireEntry(entries: ReadonlyMap<string, Uint8Array>, name: string): Uint8Array {
  const data = entries.get(name);
  if (data === undefined) {
    throw new ProjectFileError(`プロジェクトファイルに ${name} がありません`, 'zip');
  }
  return data;
}

/**
 * movement の `.mxl` を曲順に集める
 *
 * 添字の連番が途切れたところで打ち切る。歯抜けを黙って詰めると movement の対応が
 * 1 つずれ、`ResolvedStructure.musicXmlIndex` が別の楽章を指してしまう
 */
function collectMovements(entries: ReadonlyMap<string, Uint8Array>): Uint8Array[] {
  const movements: Uint8Array[] = [];
  for (let index = 0; ; index += 1) {
    const data = entries.get(movementEntryName(index));
    if (data === undefined) {
      break;
    }
    movements.push(data);
  }
  if (movements.length === 0) {
    throw new ProjectFileError('プロジェクトファイルに MusicXML がありません', 'zip');
  }
  return movements;
}
