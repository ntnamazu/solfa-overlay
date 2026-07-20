/** IPCチャネル名（Main / preload / Renderer で共有） */
export const IPC_CHANNELS = {
  appGetVersion: 'app:getVersion',

  /** ファイル選択ダイアログ（Main でしか開けないため IPC 越しに依頼する） */
  dialogOpenPdf: 'dialog:openPdf',
  dialogOpenProject: 'dialog:openProject',
  dialogSaveProject: 'dialog:saveProject',
  dialogSaveExportPdf: 'dialog:saveExportPdf',

  /** プロジェクト操作 */
  projectImportPdf: 'project:importPdf',
  projectOpen: 'project:open',
  projectSave: 'project:save',
  projectCancelOmr: 'project:cancelOmr',
  projectSetStructureDecisions: 'project:setStructureDecisions',
  projectSetClefCorrections: 'project:setClefCorrections',
  projectSetKeyRegionDecisions: 'project:setKeyRegionDecisions',
  projectSetSettings: 'project:setSettings',
  projectCompleteConfirmation: 'project:completeConfirmation',
  projectExportPdf: 'project:exportPdf',
} as const;

/** Main → Renderer の一方向イベント（`webContents.send`） */
export const IPC_EVENTS = {
  omrProgress: 'omr:progress',
} as const;
