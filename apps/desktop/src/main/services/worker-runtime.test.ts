import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { classifyWorkerStderr } from './worker-client';
import { resolveWorkerProcess } from './worker-runtime';

describe('Worker process runtime', () => {
  it('classifies tracebacks and error logs for diagnostics', () => {
    expect(classifyWorkerStderr('2026-07-31 INFO Worker started')).toBe('info');
    expect(classifyWorkerStderr('2026-07-31 ERROR Open failed')).toBe('error');
    expect(classifyWorkerStderr('Traceback (most recent call last)')).toBe('error');
  });

  it('uses the configured Python interpreter in development', () => {
    const processConfig = resolveWorkerProcess({
      isPackaged: false,
      resourcesPath: 'unused',
      appPath: join('D:', 'CR-TradeDocAssistant', 'apps', 'desktop'),
      platform: 'win32',
      environment: {
        RUS_TRADE_PYTHON: join('D:', 'Python Env', 'python.exe'),
      },
    });

    expect(processConfig.executable).toBe(
      join('D:', 'Python Env', 'python.exe'),
    );
    expect(processConfig.arguments).toEqual([
      join(
        'D:',
        'CR-TradeDocAssistant',
        'workers',
        'excel-worker',
        'src',
        'main.py',
      ),
    ]);
  });

  it('uses the bundled executable without Python in packaged mode', () => {
    const resourcesPath = join(
      'C:',
      'Program Files',
      '中俄贸易文件助手',
      'resources',
    );
    const processConfig = resolveWorkerProcess({
      isPackaged: true,
      resourcesPath,
      appPath: 'unused',
      platform: 'win32',
      environment: {
        RUS_TRADE_PYTHON: join('D:', 'must-not-be-used', 'python.exe'),
      },
    });

    expect(processConfig).toEqual({
      executable: join(resourcesPath, 'worker', 'rus-trade-worker.exe'),
      arguments: [],
    });
  });
});
