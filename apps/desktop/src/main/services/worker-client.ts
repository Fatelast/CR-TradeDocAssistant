import { randomUUID } from 'node:crypto';
import {
  type ChildProcessWithoutNullStreams,
  spawn,
} from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';

import {
  type ChangeTranslationTaskStateRequest,
  type CreateTranslationTaskRequest,
  type ImportRowsResult,
  type ListTranslationTasksRequest,
  type ProcessTranslationBatchRequest,
  PROTOCOL_VERSION,
  type TranslationTaskDetail,
  type TranslationTaskListResult,
  type UpdateTranslationRowRequest,
  type WorkerAction,
  type WorkerInfo,
  type WorkerRequest,
  type WorkerResponse,
  type WorkbookSummary,
  WORKER_ACTIONS,
  type WorksheetPreview,
} from '@rus-trade/shared';

interface PendingRequest<TData = unknown> {
  resolve: (response: WorkerResponse<TData>) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

type WorkerLogHandler = (
  level: 'info' | 'error',
  message: string,
) => void;

/**
 * 管理单个持久 Python Worker。
 *
 * Context：M0—V1 只允许一个 Worker 执行长任务，因此请求在一个进程内按
 * JSON Lines 传递；M2 以小批次请求实现暂停与恢复，不引入额外并发进程。
 */
export class WorkerClient {
  private childProcess?: ChildProcessWithoutNullStreams;

  private stdoutReader?: Interface;

  private readonly pendingRequests = new Map<string, PendingRequest>();

  private readonly workerEntry: string;

  private readonly pythonExecutable: string;

  private readonly dataDirectory: string;

  private readonly onLog: WorkerLogHandler;

  constructor(
    workerEntry: string,
    pythonExecutable: string,
    dataDirectory = '',
    onLog: WorkerLogHandler = () => undefined,
  ) {
    this.workerEntry = workerEntry;
    this.pythonExecutable = pythonExecutable;
    this.dataDirectory = dataDirectory;
    this.onLog = onLog;
  }

  async getWorkerInfo(): Promise<WorkerResponse<WorkerInfo>> {
    return this.request<WorkerInfo>(WORKER_ACTIONS.getWorkerInfo, {});
  }

  async parseWorkbook(
    filePath: string,
  ): Promise<WorkerResponse<WorkbookSummary>> {
    return this.request<WorkbookSummary>(
      WORKER_ACTIONS.parseWorkbook,
      { filePath },
      30_000,
    );
  }

  async previewSheet(
    filePath: string,
    sheetName: string,
    headerRow: number,
  ): Promise<WorkerResponse<WorksheetPreview>> {
    return this.request<WorksheetPreview>(
      WORKER_ACTIONS.previewSheet,
      {
        filePath,
        sheetName,
        headerRow,
      },
      15_000,
    );
  }

  async buildImportRows(
    filePath: string,
    sheetName: string,
    headerRow: number,
    sourceColumn: number,
    containerColumn?: number | null,
    targetColumn?: number | null,
  ): Promise<WorkerResponse<ImportRowsResult>> {
    return this.request<ImportRowsResult>(
      WORKER_ACTIONS.buildImportRows,
      {
        filePath,
        sheetName,
        headerRow,
        containerColumn: containerColumn ?? null,
        sourceColumn,
        targetColumn: targetColumn ?? null,
      },
      30_000,
    );
  }

  async createTranslationTask(
    filePath: string,
    request: Omit<CreateTranslationTaskRequest, 'workbookId'>,
  ): Promise<WorkerResponse<TranslationTaskDetail>> {
    return this.request<TranslationTaskDetail>(
      WORKER_ACTIONS.createTranslationTask,
      { ...request, filePath },
      30_000,
    );
  }

  async getTranslationTask(
    taskId: string,
  ): Promise<WorkerResponse<TranslationTaskDetail>> {
    return this.request<TranslationTaskDetail>(
      WORKER_ACTIONS.getTranslationTask,
      { taskId },
    );
  }

  async listTranslationTasks(
    request: ListTranslationTasksRequest = {},
  ): Promise<WorkerResponse<TranslationTaskListResult>> {
    return this.request<TranslationTaskListResult>(
      WORKER_ACTIONS.listTranslationTasks,
      { ...request },
    );
  }

  async processTranslationBatch(
    request: ProcessTranslationBatchRequest,
  ): Promise<WorkerResponse<TranslationTaskDetail>> {
    return this.request<TranslationTaskDetail>(
      WORKER_ACTIONS.processTranslationBatch,
      { ...request },
      30_000,
    );
  }

  async updateTranslationRow(
    request: UpdateTranslationRowRequest,
  ): Promise<WorkerResponse<TranslationTaskDetail>> {
    return this.request<TranslationTaskDetail>(
      WORKER_ACTIONS.updateTranslationRow,
      { ...request },
    );
  }

  async changeTranslationTaskState(
    request: ChangeTranslationTaskStateRequest,
  ): Promise<WorkerResponse<TranslationTaskDetail>> {
    return this.request<TranslationTaskDetail>(
      WORKER_ACTIONS.changeTranslationTaskState,
      { ...request },
    );
  }

  stop(): void {
    this.stdoutReader?.close();
    this.stdoutReader = undefined;

    if (this.childProcess && !this.childProcess.killed) {
      this.childProcess.stdin.end();
      this.childProcess.kill();
    }

    this.childProcess = undefined;
    this.rejectPendingRequests(new Error('WORKER_EXITED'));
  }

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.childProcess && !this.childProcess.killed) {
      return this.childProcess;
    }

    const childProcess = spawn(
      this.pythonExecutable,
      [this.workerEntry],
      {
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
          RUS_TRADE_DATA_DIR: this.dataDirectory,
        },
        stdio: 'pipe',
        windowsHide: true,
      },
    );

    this.childProcess = childProcess;
    this.stdoutReader = createInterface({
      input: childProcess.stdout,
      crlfDelay: Infinity,
    });

    this.stdoutReader.on('line', (line) => this.handleLine(line));
    childProcess.stderr.on('data', (chunk: Buffer) => {
      this.onLog('info', chunk.toString('utf8').trim());
    });
    childProcess.on('error', (error) => {
      this.onLog('error', `Worker start failed: ${error.message}`);
      this.rejectPendingRequests(error);
      this.childProcess = undefined;
    });
    childProcess.on('close', (code) => {
      this.onLog('info', `Worker exited with code ${code ?? 'unknown'}`);
      this.rejectPendingRequests(new Error('WORKER_EXITED'));
      this.childProcess = undefined;
    });

    return childProcess;
  }

  private request<TData>(
    action: WorkerAction,
    payload: Record<string, unknown>,
    timeoutMs = 5_000,
  ): Promise<WorkerResponse<TData>> {
    const childProcess = this.ensureStarted();
    const requestId = randomUUID();
    const request: WorkerRequest = {
      protocolVersion: PROTOCOL_VERSION,
      id: requestId,
      type: 'request',
      action,
      payload,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('WORKER_TIMEOUT'));
      }, timeoutMs);

      this.pendingRequests.set(requestId, {
        resolve: resolve as PendingRequest['resolve'],
        reject,
        timeout,
      });

      childProcess.stdin.write(`${JSON.stringify(request)}\n`, 'utf8');
    });
  }

  private handleLine(line: string): void {
    let response: WorkerResponse;

    try {
      response = JSON.parse(line) as WorkerResponse;
    } catch {
      this.onLog('error', 'Worker emitted a non-JSON stdout line');
      return;
    }

    if (
      response.protocolVersion !== PROTOCOL_VERSION
      || typeof response.id !== 'string'
      || !['completed', 'error'].includes(response.type)
    ) {
      this.onLog('error', 'Worker emitted an invalid protocol response');
      return;
    }

    const pendingRequest = this.pendingRequests.get(response.id);
    if (!pendingRequest) {
      this.onLog('error', 'Worker response has no pending request');
      return;
    }

    clearTimeout(pendingRequest.timeout);
    this.pendingRequests.delete(response.id);
    pendingRequest.resolve(response);
  }

  private rejectPendingRequests(error: Error): void {
    this.pendingRequests.forEach((pendingRequest) => {
      clearTimeout(pendingRequest.timeout);
      pendingRequest.reject(error);
    });
    this.pendingRequests.clear();
  }
}
