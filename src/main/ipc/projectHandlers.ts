import type {
  ClefCorrections,
  IpcError,
  IpcResult,
  ProjectSnapshot,
} from '../../shared/ipc/contract';
import type { KeyRegionDecision } from '../../shared/types/KeyRegion';
import type { OmrProgress } from '../../shared/types/OmrProgress';
import type { Project } from '../../shared/types/Project';
import type { ProjectSettings } from '../../shared/types/ProjectSettings';
import type { StructureDecision } from '../../shared/types/StructureDecision';
import { ProjectFileError } from '../../storage/errors';
import type { ProjectSession } from '../ProjectSession';
import { OmrArchiveError, OmrRunError } from '../omr/errors';

/**
 * IPC ハンドラの実体（Electron の `ipcMain` に依存しない純粋な関数群）
 *
 * `ipcMain.handle` への登録は `main/index.ts` が行い、ここは
 * **セッション操作 → `IpcResult` への変換**だけを担う。こうすることで Electron を
 * 起動せずにハンドラの振る舞い（特にエラー分類）を単体テストできる
 */

/**
 * 例外を `IpcError` に翻訳する
 *
 * 種別ごとに UI が示す回復手段が違う（バックアップから開く／アプリを更新する／保存先を変える）。
 * すべてを `unexpected` に丸めると、ユーザーは「何をすれば直るのか」を判断できない
 */
export function toIpcError(error: unknown): IpcError {
  if (error instanceof ProjectFileError) {
    if (error.reason === 'version') {
      return { kind: 'projectVersion', message: error.message };
    }
    if (error.reason === 'io') {
      return { kind: 'io', message: error.message };
    }
    return { kind: 'projectFile', message: error.message };
  }
  if (error instanceof OmrRunError || error instanceof OmrArchiveError) {
    return { kind: 'omr', message: error.message };
  }
  if (error instanceof Error) {
    return { kind: 'unexpected', message: error.message };
  }
  return { kind: 'unexpected', message: '想定外のエラーが発生しました' };
}

/** 同期処理を `IpcResult` に包む */
function attempt<T>(run: () => T): IpcResult<T> {
  try {
    return { ok: true, value: run() };
  } catch (error) {
    return { ok: false, error: toIpcError(error) };
  }
}

/** 非同期処理を `IpcResult` に包む */
async function attemptAsync<T>(run: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error: toIpcError(error) };
  }
}

/**
 * ハンドラ群を組み立てる
 *
 * @param session - 操作対象のセッション
 * @param onProgress - OMR の進捗を Renderer へ中継する関数（`webContents.send` を包んだもの）
 */
export function createProjectHandlers(
  session: ProjectSession,
  onProgress: (progress: OmrProgress) => void,
) {
  return {
    importPdf: (pdfPath: string): Promise<IpcResult<ProjectSnapshot>> =>
      attemptAsync(() => session.importPdf(pdfPath, onProgress)),

    open: (path: string): Promise<IpcResult<ProjectSnapshot>> =>
      attemptAsync(() => session.open(path)),

    save: (path?: string): Promise<IpcResult<Project>> => attemptAsync(() => session.save(path)),

    cancelOmr: (): IpcResult<null> =>
      attempt(() => {
        session.cancelOmr();
        return null;
      }),

    setStructureDecisions: (decisions: StructureDecision[]): IpcResult<ProjectSnapshot> =>
      attempt(() => session.setStructureDecisions(decisions)),

    setClefCorrections: (corrections: ClefCorrections): IpcResult<ProjectSnapshot> =>
      // Renderer からは構造クローン可能な Record で受け取り、ここで Map へ変換する
      attempt(() => session.setClefCorrections(new Map(Object.entries(corrections)))),

    setKeyRegionDecisions: (decisions: KeyRegionDecision[]): IpcResult<ProjectSnapshot> =>
      attempt(() => session.setKeyRegionDecisions(decisions)),

    setSettings: (settings: ProjectSettings): IpcResult<ProjectSnapshot> =>
      attempt(() => session.setSettings(settings)),

    completeConfirmation: (): IpcResult<ProjectSnapshot> =>
      attempt(() => session.completeConfirmation()),
  };
}

export type ProjectHandlers = ReturnType<typeof createProjectHandlers>;
