import {
  contextBridge,
  ipcRenderer,
  webUtils,
} from 'electron';
import {
  type AppSettings,
  type ApplyGlossaryImportRequest,
  type ApplyGlossaryImportResult,
  type BuildWorkbookRowsRequest,
  type ChangeTranslationTaskStateRequest,
  type CreateTranslationTaskRequest,
  type DataCleanupPreview,
  type DataCleanupRequest,
  type DataCleanupResult,
  type DesktopApi,
  type DirectorySelectionResult,
  type ExportPreflightRequest,
  type ExportPreflightResult,
  type GlossaryImportSelectionResult,
  type GlossaryTermListResult,
  type HistoryPathRequest,
  type HistoryPathResult,
  type ImportRowsResult,
  IPC_CHANNELS,
  type ListGlossaryTermsRequest,
  type ListTaskHistoryRequest,
  type ListTranslationCacheRequest,
  type ListTranslationTasksRequest,
  type LocalExportSelectionResult,
  type LogCleanupPreview,
  type LogCleanupResult,
  type ProcessTranslationBatchRequest,
  type ReviewTranslationRowRequest,
  type RunDataCleanupRequest,
  type RunLogCleanupRequest,
  type TaskHistoryDetail,
  type TaskHistoryListResult,
  type TranslationCacheListResult,
  type TranslationExportSelectionResult,
  type TranslationTaskDetail,
  type TranslationTaskIdRequest,
  type TranslationTaskListResult,
  type UpdateAppSettingsRequest,
  type UpdateTranslationRowRequest,
  type UpsertGlossaryTermRequest,
  type UpsertGlossaryTermResult,
  type WorkbookSelectionResult,
  type WorkbookSheetRequest,
  type WorkerInfo,
  type WorkerResponse,
  type WorksheetPreview,
} from '@rus-trade/shared';

const desktopApi: DesktopApi = {
  getWorkerInfo: () => ipcRenderer.invoke(
    IPC_CHANNELS.getWorkerInfo,
  ) as Promise<WorkerResponse<WorkerInfo>>,
  selectWorkbook: () => ipcRenderer.invoke(
    IPC_CHANNELS.selectWorkbook,
  ) as Promise<WorkbookSelectionResult>,
  openDroppedWorkbook: (file: unknown) => {
    let filePath = '';

    try {
      filePath = webUtils.getPathForFile(file as File);
    } catch {
      filePath = '';
    }

    return ipcRenderer.invoke(
      IPC_CHANNELS.openDroppedWorkbook,
      filePath,
    ) as Promise<WorkbookSelectionResult>;
  },
  previewWorkbookSheet: (request: WorkbookSheetRequest) => (
    ipcRenderer.invoke(
      IPC_CHANNELS.previewWorkbookSheet,
      request,
    ) as Promise<WorkerResponse<WorksheetPreview>>
  ),
  buildWorkbookRows: (request: BuildWorkbookRowsRequest) => (
    ipcRenderer.invoke(
      IPC_CHANNELS.buildWorkbookRows,
      request,
    ) as Promise<WorkerResponse<ImportRowsResult>>
  ),
  createTranslationTask: (request: CreateTranslationTaskRequest) => (
    ipcRenderer.invoke(
      IPC_CHANNELS.createTranslationTask,
      request,
    ) as Promise<WorkerResponse<TranslationTaskDetail>>
  ),
  getTranslationTask: (request: TranslationTaskIdRequest) => (
    ipcRenderer.invoke(
      IPC_CHANNELS.getTranslationTask,
      request,
    ) as Promise<WorkerResponse<TranslationTaskDetail>>
  ),
  listTranslationTasks: (request: ListTranslationTasksRequest = {}) => (
    ipcRenderer.invoke(
      IPC_CHANNELS.listTranslationTasks,
      request,
    ) as Promise<WorkerResponse<TranslationTaskListResult>>
  ),
  processTranslationBatch: (request: ProcessTranslationBatchRequest) => (
    ipcRenderer.invoke(
      IPC_CHANNELS.processTranslationBatch,
      request,
    ) as Promise<WorkerResponse<TranslationTaskDetail>>
  ),
  updateTranslationRow: (request: UpdateTranslationRowRequest) => (
    ipcRenderer.invoke(
      IPC_CHANNELS.updateTranslationRow,
      request,
    ) as Promise<WorkerResponse<TranslationTaskDetail>>
  ),
  changeTranslationTaskState: (
    request: ChangeTranslationTaskStateRequest,
  ) => (
    ipcRenderer.invoke(
      IPC_CHANNELS.changeTranslationTaskState,
      request,
    ) as Promise<WorkerResponse<TranslationTaskDetail>>
  ),
  reviewTranslationRow: (request: ReviewTranslationRowRequest) => (
    ipcRenderer.invoke(
      IPC_CHANNELS.reviewTranslationRow,
      request,
    ) as Promise<WorkerResponse<TranslationTaskDetail>>
  ),
  preflightExport: (request: ExportPreflightRequest) => (
    ipcRenderer.invoke(
      IPC_CHANNELS.preflightExport,
      request,
    ) as Promise<WorkerResponse<ExportPreflightResult>>
  ),
  exportTranslationTask: (request: ExportPreflightRequest) => (
    ipcRenderer.invoke(
      IPC_CHANNELS.exportTranslationTask,
      request,
    ) as Promise<TranslationExportSelectionResult>
  ),
  listTaskHistory: (request: ListTaskHistoryRequest = {}) => (
    ipcRenderer.invoke(
      IPC_CHANNELS.listTaskHistory,
      request,
    ) as Promise<WorkerResponse<TaskHistoryListResult>>
  ),
  getTaskHistoryDetail: (request: TranslationTaskIdRequest) => (
    ipcRenderer.invoke(
      IPC_CHANNELS.getTaskHistoryDetail,
      request,
    ) as Promise<WorkerResponse<TaskHistoryDetail>>
  ),
  createRerunTask: (request: TranslationTaskIdRequest) => (
    ipcRenderer.invoke(
      IPC_CHANNELS.createRerunTask,
      request,
    ) as Promise<WorkerResponse<TranslationTaskDetail>>
  ),
  openHistoryFile: (request: HistoryPathRequest) => (
    ipcRenderer.invoke(
      IPC_CHANNELS.openHistoryFile,
      request,
    ) as Promise<WorkerResponse<HistoryPathResult>>
  ),
  listGlossaryTerms: (request: ListGlossaryTermsRequest = {}) => (
    ipcRenderer.invoke(
      IPC_CHANNELS.listGlossaryTerms,
      request,
    ) as Promise<WorkerResponse<GlossaryTermListResult>>
  ),
  upsertGlossaryTerm: (request: UpsertGlossaryTermRequest) => (
    ipcRenderer.invoke(
      IPC_CHANNELS.upsertGlossaryTerm,
      request,
    ) as Promise<WorkerResponse<UpsertGlossaryTermResult>>
  ),
  selectGlossaryImport: () => (
    ipcRenderer.invoke(
      IPC_CHANNELS.selectGlossaryImport,
    ) as Promise<GlossaryImportSelectionResult>
  ),
  applyGlossaryImport: (request: ApplyGlossaryImportRequest) => (
    ipcRenderer.invoke(
      IPC_CHANNELS.applyGlossaryImport,
      request,
    ) as Promise<WorkerResponse<ApplyGlossaryImportResult>>
  ),
  exportGlossary: () => (
    ipcRenderer.invoke(
      IPC_CHANNELS.exportGlossary,
    ) as Promise<LocalExportSelectionResult>
  ),
  listTranslationCache: (request: ListTranslationCacheRequest = {}) => (
    ipcRenderer.invoke(
      IPC_CHANNELS.listTranslationCache,
      request,
    ) as Promise<WorkerResponse<TranslationCacheListResult>>
  ),
  previewDataCleanup: (request: DataCleanupRequest) => (
    ipcRenderer.invoke(
      IPC_CHANNELS.previewDataCleanup,
      request,
    ) as Promise<WorkerResponse<DataCleanupPreview>>
  ),
  runDataCleanup: (request: RunDataCleanupRequest) => (
    ipcRenderer.invoke(
      IPC_CHANNELS.runDataCleanup,
      request,
    ) as Promise<WorkerResponse<DataCleanupResult>>
  ),
  previewLogCleanup: () => (
    ipcRenderer.invoke(
      IPC_CHANNELS.previewLogCleanup,
    ) as Promise<WorkerResponse<LogCleanupPreview>>
  ),
  runLogCleanup: (request: RunLogCleanupRequest) => (
    ipcRenderer.invoke(
      IPC_CHANNELS.runLogCleanup,
      request,
    ) as Promise<WorkerResponse<LogCleanupResult>>
  ),
  getAppSettings: () => (
    ipcRenderer.invoke(
      IPC_CHANNELS.getAppSettings,
    ) as Promise<WorkerResponse<AppSettings>>
  ),
  selectOutputDirectory: () => (
    ipcRenderer.invoke(
      IPC_CHANNELS.selectOutputDirectory,
    ) as Promise<DirectorySelectionResult>
  ),
  updateAppSettings: (request: UpdateAppSettingsRequest) => (
    ipcRenderer.invoke(
      IPC_CHANNELS.updateAppSettings,
      request,
    ) as Promise<WorkerResponse<AppSettings>>
  ),
  exportAppSettings: () => (
    ipcRenderer.invoke(
      IPC_CHANNELS.exportAppSettings,
    ) as Promise<LocalExportSelectionResult>
  ),
};

contextBridge.exposeInMainWorld('tradeAssistant', desktopApi);
