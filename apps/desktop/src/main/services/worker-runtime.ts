import { join } from 'node:path';

import type { WorkerProcessConfig } from './worker-client';

interface ResolveWorkerProcessOptions {
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
  platform: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
}

/**
 * 解析开发环境与安装环境的 Worker 启动命令。
 *
 * Context：安装包不能依赖系统 Python，因此生产环境只允许执行随应用分发的
 * Worker；开发环境保留解释器覆盖能力，便于使用虚拟环境调试。
 */
export const resolveWorkerProcess = ({
  isPackaged,
  resourcesPath,
  appPath,
  platform,
  environment = process.env,
}: ResolveWorkerProcessOptions): WorkerProcessConfig => {
  if (isPackaged) {
    return {
      executable: join(
        resourcesPath,
        'worker',
        platform === 'win32'
          ? 'rus-trade-worker.exe'
          : 'rus-trade-worker',
      ),
      arguments: [],
    };
  }

  const pythonExecutable = environment.RUS_TRADE_PYTHON
    ?? (platform === 'win32' ? 'python' : 'python3');
  const workerEntry = join(
    appPath,
    '..',
    '..',
    'workers',
    'excel-worker',
    'src',
    'main.py',
  );

  return {
    executable: pythonExecutable,
    arguments: [workerEntry],
  };
};
