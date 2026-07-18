import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc/channels';
import type { IpcContract } from '../shared/ipc/contract';
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
};

contextBridge.exposeInMainWorld('solfaOverlay', api);
