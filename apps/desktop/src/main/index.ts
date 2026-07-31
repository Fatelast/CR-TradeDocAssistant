import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  dirname,
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
  type AppSettings,
  type BuildWorkbookRowsRequest,
  type ChangeTranslationTaskStateRequest,
  type CreateTranslationTaskRequest,
  type ExportPreflightRequest,
  IPC_CHANNELS,
  type ListTranslationTasksRequest,
  type ProcessTranslationBatchRequest,
  type ReviewTranslationRowRequest,
  PROTOCOL_VERSION,
  type TranslationExportSelectionResult,
  type TranslationTaskIdRequest,
  type UpdateTranslationRowRequest,
  type WorkbookSelectionResult,
  type WorkbookSession,
  type WorkbookSheetRequest,
  type WorkerErrorCode,
  type WorkerErrorResponse,
  type WorkerResponse,
  WORKER_ACTIONS,
} from '@rus-trade/shared';

import {
  initializeLogger,
  logError,
  logInfo,
} from './services/logger';
import { registerM4Ipc } from './m4-ipc';
import { WorkerClient } from './services/worker-client';
import { resolveWorkerProcess } from './services/worker-runtime';

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

const registerTranslationIpc = (): void => {
  ipcMain.handle(
    IPC_CHANNELS.createTranslationTask,
    async (_event, rawRequest: unknown) => {
      if (!isRecord(rawRequest)) {
        return createLocalError('INVALID_MESSAGE', '创建翻译任务请求无效');
      }

      const request = rawRequest as Partial<CreateTranslationTaskRequest>;
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
        return createLocalError('INVALID_MESSAGE', '翻译任务配置无效');
      }

      try {
        return await workerClient?.createTranslationTask(filePath, {
          sheetName: request.sheetName,
          headerRow: request.headerRow,
          sourceColumn: request.sourceColumn,
          containerColumn: request.containerColumn,
          targetColumn: request.targetColumn,
          sourceLanguage: request.sourceLanguage ?? 'ru',
          targetLanguage: request.targetLanguage ?? 'zh-CN',
        }) ?? createLocalError('WORKER_START_FAILED', 'Worker 未初始化');
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : 'WORKER_START_FAILED';
        logError(`Create translation task failed: ${message}`);
        return createLocalError(
          mapWorkerErrorCode(message),
          '无法创建离线翻译任务',
        );
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.getTranslationTask,
    async (_event, rawRequest: unknown) => {
      if (!isRecord(rawRequest)) {
        return createLocalError('INVALID_MESSAGE', '任务查询请求无效');
      }
      const request = rawRequest as Partial<TranslationTaskIdRequest>;
      if (typeof request.taskId !== 'string') {
        return createLocalError('INVALID_MESSAGE', '任务 ID 无效');
      }

      try {
        return await workerClient?.getTranslationTask(request.taskId)
          ?? createLocalError('WORKER_START_FAILED', 'Worker 未初始化');
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : 'WORKER_START_FAILED';
        logError(`Get translation task failed: ${message}`);
        return createLocalError(mapWorkerErrorCode(message), '无法读取翻译任务');
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.listTranslationTasks,
    async (_event, rawRequest: unknown) => {
      const request = isRecord(rawRequest)
        ? rawRequest as ListTranslationTasksRequest
        : {};
      try {
        return await workerClient?.listTranslationTasks(request)
          ?? createLocalError('WORKER_START_FAILED', 'Worker 未初始化');
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : 'WORKER_START_FAILED';
        logError(`List translation tasks failed: ${message}`);
        return createLocalError(mapWorkerErrorCode(message), '无法读取任务列表');
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.processTranslationBatch,
    async (_event, rawRequest: unknown) => {
      if (!isRecord(rawRequest)) {
        return createLocalError('INVALID_MESSAGE', '批次处理请求无效');
      }
      const request = rawRequest as Partial<ProcessTranslationBatchRequest>;
      if (typeof request.taskId !== 'string') {
        return createLocalError('INVALID_MESSAGE', '任务 ID 无效');
      }

      try {
        return await workerClient?.processTranslationBatch({
          taskId: request.taskId,
          batchSize: request.batchSize,
        }) ?? createLocalError('WORKER_START_FAILED', 'Worker 未初始化');
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : 'WORKER_START_FAILED';
        logError(`Process translation batch failed: ${message}`);
        return createLocalError(mapWorkerErrorCode(message), '无法处理翻译批次');
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.updateTranslationRow,
    async (_event, rawRequest: unknown) => {
      if (!isRecord(rawRequest)) {
        return createLocalError('INVALID_MESSAGE', '译文保存请求无效');
      }
      const request = rawRequest as Partial<UpdateTranslationRowRequest>;
      if (
        typeof request.taskId !== 'string'
        || typeof request.rowId !== 'string'
        || typeof request.translation !== 'string'
      ) {
        return createLocalError('INVALID_MESSAGE', '译文保存参数无效');
      }

      try {
        return await workerClient?.updateTranslationRow({
          taskId: request.taskId,
          rowId: request.rowId,
          translation: request.translation,
          saveToCache: request.saveToCache,
        }) ?? createLocalError('WORKER_START_FAILED', 'Worker 未初始化');
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : 'WORKER_START_FAILED';
        logError(`Update translation row failed: ${message}`);
        return createLocalError(mapWorkerErrorCode(message), '无法保存人工译文');
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.changeTranslationTaskState,
    async (_event, rawRequest: unknown) => {
      if (!isRecord(rawRequest)) {
        return createLocalError('INVALID_MESSAGE', '任务状态请求无效');
      }
      const request = rawRequest as Partial<ChangeTranslationTaskStateRequest>;
      if (
        typeof request.taskId !== 'string'
        || !['pause', 'resume', 'cancel', 'retry_failed'].includes(
          request.action ?? '',
        )
      ) {
        return createLocalError('INVALID_MESSAGE', '任务状态操作无效');
      }

      try {
        return await workerClient?.changeTranslationTaskState({
          taskId: request.taskId,
          action: request.action as ChangeTranslationTaskStateRequest['action'],
        }) ?? createLocalError('WORKER_START_FAILED', 'Worker 未初始化');
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : 'WORKER_START_FAILED';
        logError(`Change translation task state failed: ${message}`);
        return createLocalError(mapWorkerErrorCode(message), '无法更新任务状态');
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.reviewTranslationRow,
    async (_event, rawRequest: unknown) => {
      if (!isRecord(rawRequest)) {
        return createLocalError('INVALID_MESSAGE', '审核操作请求无效');
      }
      const request = rawRequest as Partial<ReviewTranslationRowRequest>;
      if (
        typeof request.taskId !== 'string'
        || typeof request.rowId !== 'string'
        || !['ignore', 'restore_initial', 'rematch'].includes(
          request.action ?? '',
        )
      ) {
        return createLocalError('INVALID_MESSAGE', '审核操作参数无效');
      }

      try {
        return await workerClient?.reviewTranslationRow({
          taskId: request.taskId,
          rowId: request.rowId,
          action: request.action as ReviewTranslationRowRequest['action'],
        }) ?? createLocalError('WORKER_START_FAILED', 'Worker 未初始化');
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : 'WORKER_START_FAILED';
        logError(`Review translation row failed: ${message}`);
        return createLocalError(mapWorkerErrorCode(message), '无法更新审核状态');
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.preflightExport,
    async (_event, rawRequest: unknown) => {
      if (!isRecord(rawRequest)) {
        return createLocalError('INVALID_MESSAGE', '导出预检请求无效');
      }
      const request = rawRequest as Partial<ExportPreflightRequest>;
      if (typeof request.taskId !== 'string') {
        return createLocalError('INVALID_MESSAGE', '任务 ID 无效');
      }

      try {
        return await workerClient?.preflightExport({
          taskId: request.taskId,
        }) ?? createLocalError('WORKER_START_FAILED', 'Worker 未初始化');
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : 'WORKER_START_FAILED';
        logError(`Export preflight failed: ${message}`);
        return createLocalError(mapWorkerErrorCode(message), '导出预检失败');
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.exportTranslationTask,
    async (_event, rawRequest: unknown): Promise<TranslationExportSelectionResult> => {
      if (!isRecord(rawRequest)) {
        return {
          cancelled: false,
          response: createLocalError('INVALID_MESSAGE', '导出请求无效'),
        };
      }
      const request = rawRequest as Partial<ExportPreflightRequest>;
      if (typeof request.taskId !== 'string') {
        return {
          cancelled: false,
          response: createLocalError('INVALID_MESSAGE', '任务 ID 无效'),
        };
      }

      try {
        const preflight = await workerClient?.preflightExport({
          taskId: request.taskId,
        }) ?? createLocalError('WORKER_START_FAILED', 'Worker 未初始化');
        if (preflight.type === 'error') {
          return { cancelled: false, response: preflight };
        }

        let outputDirectory = dirname(preflight.data.sourceFilePath);
        const settings = await workerClient?.runAction<AppSettings>(
          WORKER_ACTIONS.getAppSettings,
        );
        if (
          settings?.type === 'completed'
          && settings.data.defaultOutputDirectory
          && existsSync(settings.data.defaultOutputDirectory)
        ) {
          outputDirectory = settings.data.defaultOutputDirectory;
        }
        const selection = await dialog.showSaveDialog({
          title: '导出 Excel 翻译副本',
          buttonLabel: '导出并校验',
          defaultPath: join(
            outputDirectory,
            preflight.data.suggestedFileName,
          ),
          filters: [
            {
              name: 'Excel 工作簿',
              extensions: ['xlsx'],
            },
          ],
        });
        if (selection.canceled || !selection.filePath) {
          return { cancelled: true };
        }

        const outputPath = resolve(selection.filePath);
        if (extname(outputPath).toLowerCase() !== '.xlsx') {
          return {
            cancelled: false,
            response: createLocalError(
              'EXPORT_PATH_INVALID',
              '输出文件必须使用 .xlsx 扩展名',
            ),
          };
        }
        if (existsSync(outputPath)) {
          return {
            cancelled: false,
            response: createLocalError(
              'EXPORT_PATH_EXISTS',
              '输出文件已存在，请重新命名',
            ),
          };
        }

        const response = await workerClient?.exportTranslationTask({
          taskId: request.taskId,
          outputPath,
        }) ?? createLocalError('WORKER_START_FAILED', 'Worker 未初始化');
        return { cancelled: false, response };
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : 'WORKER_START_FAILED';
        logError(`Export translation task failed: ${message}`);
        return {
          cancelled: false,
          response: createLocalError(
            mapWorkerErrorCode(message),
            '无法导出 Excel 翻译副本',
          ),
        };
      }
    },
  );
};
const registerWorkerIpc = (): void => {
  workerClient = new WorkerClient(
    resolveWorkerProcess({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      platform: process.platform,
    }),
    process.env.RUS_TRADE_DATA_DIR ?? join(app.getPath('userData'), 'data'),
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
  registerTranslationIpc();
  registerM4Ipc(workerClient);
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
