import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DEFAULT_SETTINGS } from '../shared/constants/DEFAULT_SETTINGS';
import type { OmrRawArtifacts } from '../shared/types/OmrRawArtifacts';
import type { Project } from '../shared/types/Project';
import { backupPath, planRotation } from './backupRotation';
import { ProjectFileError } from './errors';
import type { ProjectArchive } from './projectArchive';
import { packProject, unpackProject } from './projectArchive';
import { SCHEMA_VERSION } from './projectSchema';

/**
 * プロジェクトファイル（`.solfaproj`）の保存・読込（信頼性要件: 修正作業の永続化）
 *
 * データレイヤーのため domain には依存しない（アーキテクチャ設計書「依存方向」）。
 * 解析ロジックの呼び出しは編成レイヤー（`main/ProjectSession`）が行い、
 * ここは受け取ったデータをそのまま永続化することに徹する
 */
/**
 * ファイル操作の最小インターフェース（差し替え可能にするための継ぎ目）
 *
 * `OmrRunner` の `SpawnFn` と同じ方針。**退避後に最終リネームだけが失敗する**という
 * 復旧経路は、実ファイルシステムでは狙って再現できない（保存先を塞いでもローテーションが
 * 先に退避してしまう）ため、テストから失敗を注入できるようにしてある
 */
export interface FileOps {
  rename(from: string, to: string): Promise<void>;
}

const DEFAULT_FILE_OPS: FileOps = { rename };

export class ProjectStore {
  private readonly fs: FileOps;

  constructor(deps?: { fileOps?: FileOps }) {
    this.fs = deps?.fileOps ?? DEFAULT_FILE_OPS;
  }

  /**
   * 空のプロジェクトを作る（OMR 実行前の初期状態）
   *
   * この時点ではまだファイルに書かない。OMR が終わって成果物が揃ってから `save` する
   * （OMR に失敗したときに中身のないプロジェクトファイルを残さないため）
   *
   * 元PDF のパスを引数に取らないのは、`sourcePdf` が**プロジェクト内の固定相対パス**だから。
   * 取り込み元の絶対パスを持つと、ファイルを移動・共有した相手の環境で無効な参照になる
   */
  create(): Project {
    const now = new Date().toISOString();
    return {
      schemaVersion: SCHEMA_VERSION,
      id: randomUUID(),
      // プロジェクト内に取り込む固定パス。元PDFの原本は変更しない
      sourcePdf: 'source.pdf',
      pages: [],
      score: null,
      confirmation: { items: [], completedAt: null },
      structureDecisions: [],
      keyRegionDecisions: [],
      keyRegions: [],
      annotations: [],
      settings: { ...DEFAULT_SETTINGS },
      createdAt: now,
      updatedAt: now,
    };
  }

  /** 元PDFを読み込む（`create` したプロジェクトへ同梱するため） */
  async readSourcePdf(sourcePdfPath: string): Promise<Uint8Array> {
    try {
      return new Uint8Array(await readFile(sourcePdfPath));
    } catch (cause) {
      throw new ProjectFileError(`元PDFを読み込めませんでした: ${sourcePdfPath}`, 'io', { cause });
    }
  }

  /**
   * プロジェクトを保存する
   *
   * **原子的に書く**: 同ディレクトリの一時ファイルへ書いてからリネームする。
   * 一時ファイルを OS のテンポラリ領域に置くとクロスデバイスでリネームが失敗するため、
   * 必ず保存先と同じディレクトリに作る。保存前に直前版を世代バックアップへ退避する
   */
  async save(
    path: string,
    project: Project,
    sourcePdf: Uint8Array,
    omr: OmrRawArtifacts,
  ): Promise<Project> {
    // 版数は保存時に必ず現行値へ揃える。読み込んだ値をそのまま書き戻すと、
    // 旧版から移行したファイルが古い版数を名乗り続ける
    const saved: Project = {
      ...project,
      schemaVersion: SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
    };
    const bytes = await packProject({ project: saved, sourcePdf, omr });

    const temporary = join(dirname(path), `.${basename(path)}.tmp-${randomUUID()}`);
    let displaced = false;
    try {
      await writeFile(temporary, bytes);
      displaced = await this.rotateBackups(path);
      await this.fs.rename(temporary, path);
    } catch (cause) {
      // 書き込み途中の一時ファイルを残さない（次回保存の邪魔になり、容量も食う）
      await rm(temporary, { force: true }).catch(() => undefined);
      // 直前版を bak1 へ退避した**後**に最終リネームが失敗すると、保存先に実体がない状態になる。
      // 内容は bak1 にあるが、ユーザーから見れば「保存に失敗したらファイルが消えた」であり、
      // 手動復旧を強いるのは信頼性要件に反するため必ず戻す
      if (displaced) {
        await this.fs.rename(backupPath(path, 1), path).catch(() => undefined);
      }
      throw new ProjectFileError(`プロジェクトの保存に失敗しました: ${path}`, 'io', { cause });
    }
    return saved;
  }

  /**
   * プロジェクトを読み込む
   *
   * @throws ProjectFileError reason='io' 読み込み失敗 / 'zip' | 'schema' | 'version' 検証失敗
   */
  async load(path: string): Promise<ProjectArchive> {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(path));
    } catch (cause) {
      throw new ProjectFileError(`プロジェクトを読み込めませんでした: ${path}`, 'io', { cause });
    }
    // 検証エラー（zip/schema/version）は unpackProject が分類済みのためそのまま伝播させる。
    // ここで io に丸めると「アプリを更新すれば開ける」等の正しい案内ができなくなる
    return unpackProject(bytes);
  }

  /**
   * 世代バックアップをずらす
   *
   * @returns 直前版の本体を bak1 へ退避したか（失敗時に戻す必要があるかの判断に使う）
   */
  private async rotateBackups(path: string): Promise<boolean> {
    let displaced = false;
    for (const operation of planRotation(path, existsSync)) {
      if (operation.kind === 'remove') {
        await rm(operation.path, { force: true });
      } else {
        await this.fs.rename(operation.from, operation.to);
        displaced ||= operation.from === path;
      }
    }
    return displaced;
  }
}
