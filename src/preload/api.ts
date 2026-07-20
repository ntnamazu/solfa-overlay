import type {
  ClefCorrections,
  ExportSummary,
  IpcResult,
  ProjectSnapshot,
} from '../shared/ipc/contract';
import type { KeyRegionDecision } from '../shared/types/KeyRegion';
import type { OmrProgress } from '../shared/types/OmrProgress';
import type { Project } from '../shared/types/Project';
import type { ProjectSettings } from '../shared/types/ProjectSettings';
import type { StructureDecision } from '../shared/types/StructureDecision';

/**
 * contextBridge で Renderer に公開する型付きAPI
 *
 * Renderer からは `import type` でのみ参照する（セキュリティ境界。実体は preload/index.ts）。
 * 失敗は例外ではなく `IpcResult` で返る（種別ごとに UI の回復案内を出し分けるため）
 */
export interface SolfaOverlayApi {
  getAppVersion(): Promise<string>;

  /** ファイル選択ダイアログ。キャンセルされたら null */
  chooseSourcePdf(): Promise<string | null>;
  chooseProjectFile(): Promise<string | null>;
  chooseSavePath(): Promise<string | null>;
  /** 注釈付きPDFの出力先を選ぶ。キャンセルされたら null */
  chooseExportPdfPath(): Promise<string | null>;

  importPdf(pdfPath: string): Promise<IpcResult<ProjectSnapshot>>;
  openProject(path: string): Promise<IpcResult<ProjectSnapshot>>;
  /** `path` 省略時は開いているファイルへ上書き保存する */
  saveProject(path?: string): Promise<IpcResult<Project>>;
  cancelOmr(): Promise<IpcResult<null>>;

  setStructureDecisions(decisions: StructureDecision[]): Promise<IpcResult<ProjectSnapshot>>;
  setClefCorrections(corrections: ClefCorrections): Promise<IpcResult<ProjectSnapshot>>;
  setKeyRegionDecisions(decisions: KeyRegionDecision[]): Promise<IpcResult<ProjectSnapshot>>;
  setSettings(settings: ProjectSettings): Promise<IpcResult<ProjectSnapshot>>;
  completeConfirmation(): Promise<IpcResult<ProjectSnapshot>>;
  /** 注釈付きPDFを書き出す（承認前は失敗する） */
  exportPdf(outPath: string): Promise<IpcResult<ExportSummary>>;

  /**
   * OMR の進捗を購読する
   *
   * @returns 購読解除関数。React の `useEffect` のクリーンアップで必ず呼ぶ
   *   （呼ばないと画面遷移のたびにリスナーが積み上がる）
   */
  onOmrProgress(listener: (progress: OmrProgress) => void): () => void;
}
