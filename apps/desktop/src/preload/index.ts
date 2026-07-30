import {
  contextBridge,
  ipcRenderer,
  webUtils,
} from 'electron';
import {
  type BuildWorkbookRowsRequest,
  type DesktopApi,
  type ImportRowsResult,
  IPC_CHANNELS,
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
};

contextBridge.exposeInMainWorld('tradeAssistant', desktopApi);
