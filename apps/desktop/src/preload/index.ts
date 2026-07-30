import {
  contextBridge,
  ipcRenderer,
  webUtils,
} from 'electron';
import {
  type BuildWorkbookRowsRequest,
  type ChangeTranslationTaskStateRequest,
  type CreateTranslationTaskRequest,
  type DesktopApi,
  type ImportRowsResult,
  IPC_CHANNELS,
  type ListTranslationTasksRequest,
  type ProcessTranslationBatchRequest,
  type TranslationTaskDetail,
  type TranslationTaskIdRequest,
  type TranslationTaskListResult,
  type UpdateTranslationRowRequest,
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
};

contextBridge.exposeInMainWorld('tradeAssistant', desktopApi);
