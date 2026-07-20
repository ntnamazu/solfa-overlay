import type { BuildIssue, KeyRegionIssue, StructureIssue } from '../types/Issues';
import type { KeyRegionDecision } from '../types/KeyRegion';
import type { Project } from '../types/Project';
import type { ProjectSettings } from '../types/ProjectSettings';
import type { StructureDecision } from '../types/StructureDecision';
import type { IPC_CHANNELS } from './channels';

/**
 * IPCチャネルごとのハンドラ型契約
 *
 * Main のハンドラ実装（handleIpc）と preload の呼び出し（invoke）の両方が
 * この定義から型を導出することで、チャネルの引数・戻り値の契約を単一の正とする。
 * 戻り値は Main 側ハンドラの同期戻り値の型で書く（Renderer 側では Promise に包まれる）
 */

/**
 * 解析結果と提示すべき問題点（Renderer へ送る形）
 *
 * `main/ProjectSession` の `SessionSnapshot` と同じ内容だが、契約は shared 側を正とする
 * （Renderer は main を import できないため）。構造クローン可能な純データのみで構成する
 */
export interface ProjectSnapshot {
  project: Project;
  /** 保存先（未保存なら null）。UI が「上書き保存」と「名前を付けて保存」を分けるのに使う */
  filePath: string | null;
  structureIssues: StructureIssue[];
  buildIssues: BuildIssue[];
  keyRegionIssues: KeyRegionIssue[];
  /**
   * 対象が見つからず適用されなかった訂正
   *
   * 「訂正したのに反映されない」を無言で起こさないための報告
   */
  unmatchedCorrections: UnmatchedCorrection[];
}

/** 適用先が見つからなかった訂正 1 件 */
export type UnmatchedCorrection =
  { kind: 'clef'; itemId: string } | { kind: 'structure'; pageIndex: number; systemIndex: number };

/**
 * 失敗を値として返すための結果型
 *
 * IPC 越しに例外を投げるとクラス情報が失われ、Renderer 側では文字列化された
 * メッセージしか受け取れない。回復手段の案内（バックアップから開く／アプリを更新する等）を
 * 出し分けるには**種別が構造として残る**必要があるため、成否を値で表す
 */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: IpcError };

/** 失敗の種別。UI がユーザーへ示す回復手段の分岐に使う */
export type IpcErrorKind =
  /** プロジェクトファイルが壊れている・必須データがない → バックアップから開く */
  | 'projectFile'
  /** アプリより新しい版数のファイル → アプリを更新する */
  | 'projectVersion'
  /** OMR の起動・実行の失敗、またはキャンセル → 入力PDFを見直す／やり直す */
  | 'omr'
  /** ディスク・権限などの入出力エラー → 保存先を変える */
  | 'io'
  /** 上記に当てはまらない想定外 → 詳細を表示して報告を促す */
  | 'unexpected';

export interface IpcError {
  kind: IpcErrorKind;
  /** ユーザーへそのまま提示できる日本語メッセージ */
  message: string;
}

/** 音部記号の訂正（確認項目 id → 訂正後の Audiveris kind。null は訂正の取り消し） */
export type ClefCorrections = Record<string, string | null>;

export interface IpcContract {
  [IPC_CHANNELS.appGetVersion]: () => string;

  // ダイアログ: キャンセルされたら null
  [IPC_CHANNELS.dialogOpenPdf]: () => Promise<string | null>;
  [IPC_CHANNELS.dialogOpenProject]: () => Promise<string | null>;
  [IPC_CHANNELS.dialogSaveProject]: () => Promise<string | null>;

  [IPC_CHANNELS.projectImportPdf]: (pdfPath: string) => Promise<IpcResult<ProjectSnapshot>>;
  [IPC_CHANNELS.projectOpen]: (path: string) => Promise<IpcResult<ProjectSnapshot>>;
  /** `path` 省略時は開いているファイルへ上書き保存する */
  [IPC_CHANNELS.projectSave]: (path?: string) => Promise<IpcResult<Project>>;
  [IPC_CHANNELS.projectCancelOmr]: () => IpcResult<null>;
  [IPC_CHANNELS.projectSetStructureDecisions]: (
    decisions: StructureDecision[],
  ) => IpcResult<ProjectSnapshot>;
  [IPC_CHANNELS.projectSetClefCorrections]: (
    corrections: ClefCorrections,
  ) => IpcResult<ProjectSnapshot>;
  [IPC_CHANNELS.projectSetKeyRegionDecisions]: (
    decisions: KeyRegionDecision[],
  ) => IpcResult<ProjectSnapshot>;
  [IPC_CHANNELS.projectSetSettings]: (settings: ProjectSettings) => IpcResult<ProjectSnapshot>;
  [IPC_CHANNELS.projectCompleteConfirmation]: () => IpcResult<ProjectSnapshot>;
}
