import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc/channels';
import type { SolfaOverlayApi } from './api';

const api: SolfaOverlayApi = {
  getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.appGetVersion) as Promise<string>,
};

contextBridge.exposeInMainWorld('solfaOverlay', api);
