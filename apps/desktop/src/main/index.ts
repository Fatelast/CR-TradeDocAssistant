import { randomUUID } from 'node:crypto';
import {
  extname,
  join,
  resolve,
} from 'node:path';

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  session,
} from 'electron';
import {
  type BuildWorkbookRowsRequest,
  IPC_CHANNELS,
  PROTOCOL_VERSION,
  type WorkbookSelectionResult,
  type WorkbookSession,
  type WorkbookSheetRequest,
  type WorkerErrorCode,
  type WorkerErrorResponse,
  type WorkerResponse,
} from '@rus-trade/shared';

import {
  initializeLogger,
  logError,
  logInfo,
} from './services/logger';
import { WorkerClient } from './services/worker-client';

interface ActiveWorkbook {
  id: string;
  filePath: string;
}

let mainWindow: BrowserWindow | null = null;
let workerClient: WorkerClient | undefined;
let activeWorkbook: ActiveWorkbook | undefined;

const createLocalError = (
  code: WorkerErrorCode,
  message: string,
): WorkerErrorResponse => ({
  protocolVersion: PROTOCOL_VERSION,
  id: 'desktop',
  type: 'error',
  error: {
    code,
    message,
  },
});

const mapWorkerErrorCode = (message: string): WorkerErrorCode => {
  if (message === 'WORKER_TIMEOUT') {
    return 'WORKER_TIMEOUT';
  }

  if (message === 'WORKER_EXITED') {
    return 'WORKER_EXITED';
  }

  return 'WORKER_START_FAILED';
};

const resolveWorkerEntry = (): string => {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'worker', 'main.py');
  }

  return join(
    app.getAppPath(),
    '..',
    '..',
    'workers',
    'excel-worker',
    'src',
    'main.py',
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

const getActiveWorkbookPath = (workbookId: unknown): string | undefined => {
  if (
    typeof workbookId !== 'string'
    || workbookId !== activeWorkbook?.id
  ) {
    return undefined;
  }

  return activeWorkbook.filePath;
};

const analyzeWorkbookPath = async (
  rawFilePath: unknown,
): Promise<WorkbookSelectionResult> => {
  if (typeof rawFilePath !== 'string' || !rawFilePath.trim()) {
    return {
      cancelled: false,
      response: createLocalError(
        'FILE_SELECTION_FAILED',
        '未获得有效文件路径',
      ),
    };
  }

  const filePath = resolve(rawFilePath);
  if (extname(filePath).toLowerCase() !== '.xlsx') {
    return {
      cancelled: false,
      response: createLocalError(
        'FILE_UNSUPPORTED',
        '仅支持 .xlsx 文件',
      ),
    };
  }

  try {
    const response = await workerClient?.parseWorkbook(filePath)
      ?? createLocalError('WORKER_START_FAILED', 'Worker 未初始化');

    if (response.type === 'error') {
      return { cancelled: false, response };
    }

    const workbookId = randomUUID();
    activeWorkbook = { id: workbookId, filePath };
    const sessionResponse: WorkerResponse<WorkbookSession> = {
      ...response,
      data: {
        ...response.data,
        workbookId,
        filePath,
      },
    };

    return { cancelled: false, response: sessionResponse };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'WORKER_START_FAILED';
    const errorCode = mapWorkerErrorCode(message);

    logError(`Workbook parse failed: ${message}`);
    return {
      cancelled: false,
      response: createLocalError(errorCode, '无法解析 Excel 文件'),
    };
  }
};

const registerWorkbookIpc = (): void => {
  ipcMain.handle(IPC_CHANNELS.selectWorkbook, async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: '选择 Excel 文件',
        buttonLabel: '导入并预检',
        properties: ['openFile'],
        filters: [
          {
            name: 'Excel 工作簿',
            extensions: ['xlsx'],
          },
        ],
      });

      if (result.canceled || !result.filePaths[0]) {
        return { cancelled: true } satisfies WorkbookSelectionResult;
      }

      return analyzeWorkbookPath(result.filePaths[0]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError(`File selection failed: ${message}`);
      return {
        cancelled: false,
        response: createLocalError(
          'FILE_SELECTION_FAILED',
          '无法打开文件选择器',
        ),
      } satisfies WorkbookSelectionResult;
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.openDroppedWorkbook,
    (_event, filePath: unknown) => analyzeWorkbookPath(filePath),
  );

  ipcMain.handle(
    IPC_CHANNELS.previewWorkbookSheet,
    async (_event, rawRequest: unknown) => {
      if (!isRecord(rawRequest)) {
        return createLocalError('INVALID_MESSAGE', '工作表预览请求无效');
      }

      const request = rawRequest as Partial<WorkbookSheetRequest>;
      const filePath = getActiveWorkbookPath(request.workbookId);
      if (!filePath) {
        return createLocalError(
          'WORKBOOK_SESSION_INVALID',
          '工作簿会话已失效，请重新选择文件',
        );
      }
      if (
        typeof request.sheetName !== 'string'
        || typeof request.headerRow !== 'number'
      ) {
        return createLocalError('INVALID_MESSAGE', '工作表或表头行无效');
      }

      try {
        return await workerClient?.previewSheet(
          filePath,
          request.sheetName,
          request.headerRow,
        ) ?? createLocalError('WORKER_START_FAILED', 'Worker 未初始化');
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : 'WORKER_START_FAILED';
        logError(`Worksheet preview failed: ${message}`);
        return createLocalError(
          mapWorkerErrorCode(message),
          '无法预览工作表',
        );
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.buildWorkbookRows,
    async (_event, rawRequest: unknown) => {
      if (!isRecord(rawRequest)) {
        return createLocalError('INVALID_MESSAGE', '数据行请求无效');
      }

      const request = rawRequest as Partial<BuildWorkbookRowsRequest>;
      const filePath = getActiveWorkbookPath(request.workbookId);
      if (!filePath) {
        return createLocalError(
          'WORKBOOK_SESSION_INVALID',
          '工作簿会话已失效，请重新选择文件',
        );
      }
      if (
        typeof request.sheetName !== 'string'
        || typeof request.headerRow !== 'number'
        || typeof request.sourceColumn !== 'number'
      ) {
        return createLocalError('INVALID_MESSAGE', '数据行配置无效');
      }

      try {
        return await workerClient?.buildImportRows(
          filePath,
          request.sheetName,
          request.headerRow,
          request.sourceColumn,
          request.containerColumn,
          request.targetColumn,
        ) ?? createLocalError('WORKER_START_FAILED', 'Worker 未初始化');
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : 'WORKER_START_FAILED';
        logError(`Build import rows failed: ${message}`);
        return createLocalError(
          mapWorkerErrorCode(message),
          '无法生成导入数据行',
        );
      }
    },
  );
};

const registerWorkerIpc = (): void => {
  const pythonExecutable = process.env.RUS_TRADE_PYTHON
    ?? (process.platform === 'win32' ? 'python' : 'python3');

  workerClient = new WorkerClient(
    resolveWorkerEntry(),
    pythonExecutable,
    (level, message) => {
      if (level === 'error') {
        logError(message);
      } else {
        logInfo(message);
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.getWorkerInfo, async () => {
    try {
      return await workerClient?.getWorkerInfo()
        ?? createLocalError('WORKER_START_FAILED', 'Worker 未初始化');
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'WORKER_START_FAILED';
      const errorCode = mapWorkerErrorCode(message);

      logError(`Worker request failed: ${message}`);
      return createLocalError(errorCode, '无法连接 Python Worker');
    }
  });

  registerWorkbookIpc();
};

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 960,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#102624',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(
      join(__dirname, '../renderer/index.html'),
    );
  }
};

app.whenReady().then(() => {
  initializeLogger();
  logInfo('Desktop application starting');

  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  registerWorkerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Desktop startup failed: ${message}\n`);
  app.quit();
});

app.on('before-quit', () => {
  activeWorkbook = undefined;
  workerClient?.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
