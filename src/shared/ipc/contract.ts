import type { IPC_CHANNELS } from './channels';

/**
 * IPCチャネルごとのハンドラ型契約
 *
 * Main のハンドラ実装（handleIpc）と preload の呼び出し（invoke）の両方が
 * この定義から型を導出することで、チャネルの引数・戻り値の契約を単一の正とする。
 * 戻り値は Main 側ハンドラの同期戻り値の型で書く（Renderer 側では Promise に包まれる）
 */
export interface IpcContract {
  [IPC_CHANNELS.appGetVersion]: () => string;
}
