import { existsSync } from 'node:fs';
import {
  extname,
  join,
  resolve,
} from 'node:path';

import {
  app,
  dialog,
  ipcMain,
  shell,
} from 'electron';
import {
  type AppSettings,
  type ApplyGlossaryImportRequest,
  type ApplyGlossaryImportResult,
  type DataCleanupPreview,
  type DataCleanupRequest,
  type DataCleanupResult,
  type DirectorySelectionResult,
  type GlossaryImportPreflightResult,
  type GlossaryImportSelectionResult,
  type GlossaryTermListResult,
  type HistoryPathResult,
  IPC_CHANNELS,
  type ListGlossaryTermsRequest,
  type ListTaskHistoryRequest,
  type ListTranslationCacheRequest,
  type LocalExportResult,
  type LocalExportSelectionResult,
  type LogCleanupPreview,
  type LogCleanupResult,
  PROTOCOL_VERSION,
  type RunDataCleanupRequest,
  type RunLogCleanupRequest,
  type TaskHistoryDetail,
  type TaskHistoryListResult,
  type TranslationCacheListResult,
  type TranslationTaskDetail,
  type TranslationTaskIdRequest,
  type UpdateAppSettingsRequest,
  type UpsertGlossaryTermRequest,
  type UpsertGlossaryTermResult,
  type WorkerAction,
  type WorkerErrorCode,
  type WorkerErrorResponse,
  type WorkerResponse,
  WORKER_ACTIONS,
} from '@rus-trade/shared';

import {
  configureLogger,
  logError,
  logInfo,
  previewExpiredLogs,
  runExpiredLogCleanup,
} from './services/logger';
import { WorkerClient } from './services/worker-client';

interface GlossaryImportSession {
  filePath: string;
  fileSha256: string;
}

let glossaryImportSession: GlossaryImportSession | undefined;
let selectedOutputDirectory: string | undefined;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

const createLocalError = (
  code: WorkerErrorCode,
  message: string,
): WorkerErrorResponse => ({
  protocolVersion: PROTOCOL_VERSION,
  id: 'desktop-m4',
  type: 'error',
  error: { code, message },
});

const createLocalCompleted = <TData>(
  data: TData,
): WorkerResponse<TData> => ({
    protocolVersion: PROTOCOL_VERSION,
    id: 'desktop-m4',
    type: 'completed',
    data,
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

const runWorkerAction = async <TData>(
  workerClient: WorkerClient,
  action: WorkerAction,
  payload: Record<string, unknown> = {},
  timeoutMs = 10_000,
): Promise<WorkerResponse<TData>> => {
  try {
    return await workerClient.runAction<TData>(action, payload, timeoutMs);
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'WORKER_START_FAILED';
    logError(`M4 worker action ${action} failed: ${message}`);
    return createLocalError(
      mapWorkerErrorCode(message),
      '本地数据服务暂时不可用',
    );
  }
};

const ensureNewOutputPath = (
  filePath: string,
  extension: '.xlsx' | '.json',
): WorkerErrorResponse | undefined => {
  if (extname(filePath).toLowerCase() !== extension) {
    return createLocalError(
      'EXPORT_PATH_INVALID',
      `输出文件必须使用 ${extension} 扩展名`,
    );
  }
  if (existsSync(filePath)) {
    return createLocalError(
      'EXPORT_PATH_EXISTS',
      '输出文件已存在，请重新命名',
    );
  }
  return undefined;
};

const getDefaultOutputDirectory = async (
  workerClient: WorkerClient,
): Promise<string> => {
  const response = await runWorkerAction<AppSettings>(
    workerClient,
    WORKER_ACTIONS.getAppSettings,
  );
  if (
    response.type === 'completed'
    && response.data.defaultOutputDirectory
    && existsSync(response.data.defaultOutputDirectory)
  ) {
    return response.data.defaultOutputDirectory;
  }
  return app.getPath('documents');
};

const selectExportPath = async (
  workerClient: WorkerClient,
  extension: '.xlsx' | '.json',
  fileName: string,
  title: string,
): Promise<string | WorkerErrorResponse | undefined> => {
  const defaultDirectory = await getDefaultOutputDirectory(workerClient);
  const result = await dialog.showSaveDialog({
    title,
    buttonLabel: '导出并校验',
    defaultPath: join(defaultDirectory, fileName),
    filters: [{
      name: extension === '.xlsx' ? 'Excel 工作簿' : 'JSON 文件',
      extensions: [extension.slice(1)],
    }],
  });
  if (result.canceled || !result.filePath) {
    return undefined;
  }
  const outputPath = resolve(result.filePath);
  return ensureNewOutputPath(outputPath, extension) ?? outputPath;
};

const registerHistoryIpc = (workerClient: WorkerClient): void => {
  ipcMain.handle(IPC_CHANNELS.listTaskHistory, (_event, rawRequest) => (
    runWorkerAction<TaskHistoryListResult>(
      workerClient,
      WORKER_ACTIONS.listTaskHistory,
      isRecord(rawRequest) ? rawRequest : {},
    )
  ));

  ipcMain.handle(IPC_CHANNELS.getTaskHistoryDetail, (_event, rawRequest) => (
    runWorkerAction<TaskHistoryDetail>(
      workerClient,
      WORKER_ACTIONS.getTaskHistoryDetail,
      isRecord(rawRequest) ? rawRequest : {},
    )
  ));

  ipcMain.handle(IPC_CHANNELS.createRerunTask, (_event, rawRequest) => (
    runWorkerAction<TranslationTaskDetail>(
      workerClient,
      WORKER_ACTIONS.createRerunTask,
      isRecord(rawRequest) ? rawRequest : {},
      30_000,
    )
  ));

  ipcMain.handle(
    IPC_CHANNELS.openHistoryFile,
    async (_event, rawRequest): Promise<WorkerResponse<HistoryPathResult>> => {
      if (!isRecord(rawRequest)) {
        return createLocalError('INVALID_MESSAGE', '历史文件请求无效');
      }
      const response = await runWorkerAction<HistoryPathResult>(
        workerClient,
        WORKER_ACTIONS.resolveHistoryPath,
        rawRequest,
      );
      if (response.type === 'error' || !response.data.exists) {
        return response.type === 'error'
          ? response
          : createLocalError('FILE_NOT_FOUND', '历史文件已不存在');
      }
      const openError = await shell.openPath(response.data.path);
      if (openError) {
        return createLocalError('FILE_SELECTION_FAILED', '无法打开历史文件');
      }
      return {
        ...response,
        data: { ...response.data, opened: true },
      };
    },
  );
};

const registerGlossaryIpc = (workerClient: WorkerClient): void => {
  ipcMain.handle(IPC_CHANNELS.listGlossaryTerms, (_event, rawRequest) => (
    runWorkerAction<GlossaryTermListResult>(
      workerClient,
      WORKER_ACTIONS.listGlossaryTerms,
      isRecord(rawRequest) ? rawRequest : {},
    )
  ));

  ipcMain.handle(IPC_CHANNELS.upsertGlossaryTerm, (_event, rawRequest) => (
    runWorkerAction<UpsertGlossaryTermResult>(
      workerClient,
      WORKER_ACTIONS.upsertGlossaryTerm,
      isRecord(rawRequest) ? rawRequest : {},
    )
  ));

  ipcMain.handle(
    IPC_CHANNELS.selectGlossaryImport,
    async (): Promise<GlossaryImportSelectionResult> => {
      const result = await dialog.showOpenDialog({
        title: '选择标准术语库文件',
        buttonLabel: '预检术语库',
        properties: ['openFile'],
        filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
      });
      if (result.canceled || !result.filePaths[0]) {
        return { cancelled: true };
      }
      const filePath = resolve(result.filePaths[0]);
      const response = await runWorkerAction<GlossaryImportPreflightResult>(
        workerClient,
        WORKER_ACTIONS.preflightGlossaryImport,
        { filePath },
        30_000,
      );
      if (response.type === 'completed') {
        glossaryImportSession = {
          filePath,
          fileSha256: response.data.fileSha256,
        };
      }
      return { cancelled: false, response };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.applyGlossaryImport,
    async (_event, rawRequest): Promise<WorkerResponse<ApplyGlossaryImportResult>> => {
      const request = isRecord(rawRequest)
        ? rawRequest as Partial<ApplyGlossaryImportRequest>
        : {};
      if (
        !glossaryImportSession
        || request.expectedSha256 !== glossaryImportSession.fileSha256
      ) {
        return createLocalError(
          'GLOSSARY_IMPORT_CHANGED',
          '术语导入会话已失效，请重新选择文件',
        );
      }
      const response = await runWorkerAction<ApplyGlossaryImportResult>(
        workerClient,
        WORKER_ACTIONS.applyGlossaryImport,
        {
          filePath: glossaryImportSession.filePath,
          expectedSha256: request.expectedSha256,
        },
        30_000,
      );
      if (response.type === 'completed') {
        glossaryImportSession = undefined;
      }
      return response;
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.exportGlossary,
    async (): Promise<LocalExportSelectionResult> => {
      const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
      const selection = await selectExportPath(
        workerClient,
        '.xlsx',
        `中俄贸易术语库_${stamp}.xlsx`,
        '导出标准术语库',
      );
      if (selection === undefined) {
        return { cancelled: true };
      }
      if (typeof selection !== 'string') {
        return { cancelled: false, response: selection };
      }
      const response = await runWorkerAction<LocalExportResult>(
        workerClient,
        WORKER_ACTIONS.exportGlossary,
        { outputPath: selection },
        30_000,
      );
      return { cancelled: false, response };
    },
  );
};

const registerMaintenanceIpc = (workerClient: WorkerClient): void => {
  ipcMain.handle(IPC_CHANNELS.listTranslationCache, (_event, rawRequest) => (
    runWorkerAction<TranslationCacheListResult>(
      workerClient,
      WORKER_ACTIONS.listTranslationCache,
      isRecord(rawRequest) ? rawRequest : {},
    )
  ));

  ipcMain.handle(IPC_CHANNELS.previewDataCleanup, (_event, rawRequest) => (
    runWorkerAction<DataCleanupPreview>(
      workerClient,
      WORKER_ACTIONS.previewDataCleanup,
      isRecord(rawRequest) ? rawRequest : {},
    )
  ));

  ipcMain.handle(IPC_CHANNELS.runDataCleanup, (_event, rawRequest) => (
    runWorkerAction<DataCleanupResult>(
      workerClient,
      WORKER_ACTIONS.runDataCleanup,
      isRecord(rawRequest) ? rawRequest : {},
    )
  ));

  ipcMain.handle(
    IPC_CHANNELS.previewLogCleanup,
    (): WorkerResponse<LogCleanupPreview> => {
      try {
        return createLocalCompleted(previewExpiredLogs());
      } catch (error) {
        logError(`Log cleanup preview failed: ${String(error)}`);
        return createLocalError('DATABASE_ERROR', '无法预览过期日志');
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.runLogCleanup,
    (_event, rawRequest): WorkerResponse<LogCleanupResult> => {
      const request = isRecord(rawRequest)
        ? rawRequest as Partial<RunLogCleanupRequest>
        : {};
      if (typeof request.planHash !== 'string' || !request.planHash) {
        return createLocalError(
          'CLEANUP_PLAN_CHANGED',
          '日志清理计划缺失，请重新预览',
        );
      }
      try {
        return createLocalCompleted(
          runExpiredLogCleanup(request.planHash),
        );
      } catch (error) {
        if (error instanceof Error && error.message === 'CLEANUP_PLAN_CHANGED') {
          return createLocalError(
            'CLEANUP_PLAN_CHANGED',
            '日志文件已变化，请重新预览',
          );
        }
        logError(`Log cleanup failed: ${String(error)}`);
        return createLocalError('DATABASE_ERROR', '无法清理过期日志');
      }
    },
  );
};

const registerSettingsIpc = (workerClient: WorkerClient): void => {
  ipcMain.handle(IPC_CHANNELS.getAppSettings, () => (
    runWorkerAction<AppSettings>(
      workerClient,
      WORKER_ACTIONS.getAppSettings,
    )
  ));

  ipcMain.handle(
    IPC_CHANNELS.selectOutputDirectory,
    async (): Promise<DirectorySelectionResult> => {
      const result = await dialog.showOpenDialog({
        title: '选择默认输出目录',
        buttonLabel: '使用此目录',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || !result.filePaths[0]) {
        return { cancelled: true };
      }
      selectedOutputDirectory = resolve(result.filePaths[0]);
      return {
        cancelled: false,
        directoryPath: selectedOutputDirectory,
      };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.updateAppSettings,
    async (_event, rawRequest): Promise<WorkerResponse<AppSettings>> => {
      if (!isRecord(rawRequest)) {
        return createLocalError('INVALID_MESSAGE', '设置更新请求无效');
      }
      const requestedDirectory = rawRequest.defaultOutputDirectory;
      if (requestedDirectory !== null) {
        const current = await runWorkerAction<AppSettings>(
          workerClient,
          WORKER_ACTIONS.getAppSettings,
        );
        const currentDirectory = current.type === 'completed'
          ? current.data.defaultOutputDirectory
          : undefined;
        if (
          typeof requestedDirectory !== 'string'
          || (
            requestedDirectory !== selectedOutputDirectory
            && requestedDirectory !== currentDirectory
          )
        ) {
          return createLocalError(
            'SETTINGS_INVALID',
            '默认输出目录必须通过原生目录选择器设置',
          );
        }
      }
      const response = await runWorkerAction<AppSettings>(
        workerClient,
        WORKER_ACTIONS.updateAppSettings,
        rawRequest,
      );
      if (response.type === 'completed') {
        selectedOutputDirectory = undefined;
        configureLogger(response.data.logLevel);
      }
      return response;
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.exportAppSettings,
    async (): Promise<LocalExportSelectionResult> => {
      const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
      const selection = await selectExportPath(
        workerClient,
        '.json',
        `中俄贸易文件助手设置_${stamp}.json`,
        '导出应用设置',
      );
      if (selection === undefined) {
        return { cancelled: true };
      }
      if (typeof selection !== 'string') {
        return { cancelled: false, response: selection };
      }
      const response = await runWorkerAction<LocalExportResult>(
        workerClient,
        WORKER_ACTIONS.exportAppSettings,
        { outputPath: selection },
      );
      return { cancelled: false, response };
    },
  );
};

const initializeM4State = async (workerClient: WorkerClient): Promise<void> => {
  const [recovery, cleanup, settings] = await Promise.all([
    runWorkerAction<{ recovered: number; failed: number }>(
      workerClient,
      WORKER_ACTIONS.recoverPendingExports,
    ),
    runWorkerAction<Record<string, unknown>>(
      workerClient,
      WORKER_ACTIONS.runScheduledCleanup,
    ),
    runWorkerAction<AppSettings>(
      workerClient,
      WORKER_ACTIONS.getAppSettings,
    ),
  ]);
  if (settings.type === 'completed') {
    configureLogger(settings.data.logLevel);
  }
  if (recovery.type === 'completed') {
    logInfo(
      `Export recovery completed: recovered=${recovery.data.recovered}, failed=${recovery.data.failed}`,
    );
  }
  if (cleanup.type === 'completed') {
    logInfo(`Scheduled cleanup completed: ${JSON.stringify(cleanup.data)}`);
  }
};

/** 注册 M4 本地历史、术语、缓存和设置的最小权限 IPC。 */
export const registerM4Ipc = (workerClient: WorkerClient): void => {
  registerHistoryIpc(workerClient);
  registerGlossaryIpc(workerClient);
  registerMaintenanceIpc(workerClient);
  registerSettingsIpc(workerClient);
  void initializeM4State(workerClient);
};

export type {
  DataCleanupRequest,
  ListGlossaryTermsRequest,
  ListTaskHistoryRequest,
  ListTranslationCacheRequest,
  RunDataCleanupRequest,
  TranslationTaskIdRequest,
  UpdateAppSettingsRequest,
  UpsertGlossaryTermRequest,
};
