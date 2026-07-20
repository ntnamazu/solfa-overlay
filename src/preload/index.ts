import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, IPC_EVENTS } from '../shared/ipc/channels';
import type { IpcContract } from '../shared/ipc/contract';
import type { OmrProgress } from '../shared/types/OmrProgress';
import type { SolfaOverlayApi } from './api';

/**
 * 引数・戻り値の型を IpcContract から導出する invoke ラッパー
 *
 * ipcRenderer.invoke 自体は unknown を返すため型表明は残るが、表明先を
 * 契約（contract.ts）に一本化することで Main 側実装との手動リンクをなくす
 */
function invoke<C extends keyof IpcContract>(
  channel: C,
  ...args: Parameters<IpcContract[C]>
): Promise<Awaited<ReturnType<IpcContract[C]>>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<Awaited<ReturnType<IpcContract[C]>>>;
}

const api: SolfaOverlayApi = {
  getAppVersion: () => invoke(IPC_CHANNELS.appGetVersion),

  chooseSourcePdf: () => invoke(IPC_CHANNELS.dialogOpenPdf),
  chooseProjectFile: () => invoke(IPC_CHANNELS.dialogOpenProject),
  chooseSavePath: () => invoke(IPC_CHANNELS.dialogSaveProject),

  importPdf: (pdfPath) => invoke(IPC_CHANNELS.projectImportPdf, pdfPath),
  openProject: (path) => invoke(IPC_CHANNELS.projectOpen, path),
  saveProject: (path) => invoke(IPC_CHANNELS.projectSave, path),
  cancelOmr: () => invoke(IPC_CHANNELS.projectCancelOmr),

  setStructureDecisions: (decisions) =>
    invoke(IPC_CHANNELS.projectSetStructureDecisions, decisions),
  setClefCorrections: (corrections) => invoke(IPC_CHANNELS.projectSetClefCorrections, corrections),
  setKeyRegionDecisions: (decisions) =>
    invoke(IPC_CHANNELS.projectSetKeyRegionDecisions, decisions),
  setSettings: (settings) => invoke(IPC_CHANNELS.projectSetSettings, settings),
  completeConfirmation: () => invoke(IPC_CHANNELS.projectCompleteConfirmation),

  onOmrProgress: (listener) => {
    // ipcRenderer のイベント引数（第1引数は IpcRendererEvent）は Renderer へ渡さない。
    // 送信元情報を含むオブジェクトであり、公開 API の面を最小に保つ
    const handler = (_event: unknown, progress: OmrProgress): void => {
      listener(progress);
    };
    ipcRenderer.on(IPC_EVENTS.omrProgress, handler);
    return () => {
      ipcRenderer.off(IPC_EVENTS.omrProgress, handler);
    };
  },
};

contextBridge.exposeInMainWorld('solfaOverlay', api);
