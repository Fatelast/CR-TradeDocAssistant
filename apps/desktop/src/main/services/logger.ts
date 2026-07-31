import { createHash } from 'node:crypto';
import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';

import { app } from 'electron';

type LogLevel = 'info' | 'error';

const LOG_RETENTION_DAYS = 30;

let logsDirectory: string | undefined;
let activeDate = '';
let logFilePath: string | undefined;
let configuredLevel: LogLevel = 'info';

const sanitize = (message: string): string => (
  message
    .replace(/[\r\n]+/g, ' ')
    .replace(/([A-Za-z]:\\)[^ ]+/g, '$1[…]')
    .slice(0, 800)
);

const dateStamp = (date = new Date()): string => (
  date.toISOString().slice(0, 10)
);

const resolveLogFilePath = (): string | undefined => {
  if (!logsDirectory) {
    return undefined;
  }
  const today = dateStamp();
  if (today !== activeDate || !logFilePath) {
    activeDate = today;
    logFilePath = join(logsDirectory, `main-${today}.log`);
  }
  return logFilePath;
};

interface ExpiredLogFile {
  fileName: string;
  filePath: string;
  modifiedAt: number;
  sizeBytes: number;
}

export interface LogCleanupPreview {
  planHash: string;
  fileCount: number;
  sizeBytes: number;
}

export interface LogCleanupResult {
  fileCount: number;
  sizeBytes: number;
}

const findExpiredLogs = (): ExpiredLogFile[] => {
  if (!logsDirectory) {
    return [];
  }
  const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1_000;
  return readdirSync(logsDirectory)
    .filter((fileName) => /^main-\d{4}-\d{2}-\d{2}\.log$/.test(fileName))
    .map((fileName) => {
      const filePath = join(logsDirectory as string, fileName);
      const stats = statSync(filePath);
      return {
        fileName,
        filePath,
        modifiedAt: stats.mtimeMs,
        sizeBytes: stats.size,
      };
    })
    .filter((file) => file.modifiedAt < cutoff)
    .sort((left, right) => left.fileName.localeCompare(right.fileName));
};

const buildLogCleanupPreview = (
  files: ExpiredLogFile[],
): LogCleanupPreview => ({
  planHash: createHash('sha256')
    .update(JSON.stringify(files.map((file) => ({
      fileName: file.fileName,
      modifiedAt: file.modifiedAt,
      sizeBytes: file.sizeBytes,
    }))))
    .digest('hex'),
  fileCount: files.length,
  sizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
});

export const previewExpiredLogs = (): LogCleanupPreview => (
  buildLogCleanupPreview(findExpiredLogs())
);

export const runExpiredLogCleanup = (
  expectedPlanHash: string,
): LogCleanupResult => {
  const files = findExpiredLogs();
  const preview = buildLogCleanupPreview(files);
  if (preview.planHash !== expectedPlanHash) {
    throw new Error('CLEANUP_PLAN_CHANGED');
  }
  files.forEach((file) => unlinkSync(file.filePath));
  return {
    fileCount: preview.fileCount,
    sizeBytes: preview.sizeBytes,
  };
};

const writeLog = (level: 'INFO' | 'ERROR', message: string): void => {
  if (configuredLevel === 'error' && level === 'INFO') {
    return;
  }
  const line = `${new Date().toISOString()} ${level} ${sanitize(message)}\n`;
  const target = resolveLogFilePath();

  if (!target) {
    process.stderr.write(line);
    return;
  }

  try {
    appendFileSync(target, line, { encoding: 'utf8' });
  } catch {
    process.stderr.write(line);
  }
};

export const initializeLogger = (): void => {
  logsDirectory = app.getPath('logs');
  mkdirSync(logsDirectory, { recursive: true });
  try {
    const cleanup = previewExpiredLogs();
    runExpiredLogCleanup(cleanup.planHash);
  } catch (error) {
    process.stderr.write(`Log cleanup failed: ${String(error)}\n`);
  }
  resolveLogFilePath();
};

export const configureLogger = (level: LogLevel): void => {
  configuredLevel = level;
};

export const logInfo = (message: string): void => {
  writeLog('INFO', message);
};

export const logError = (message: string): void => {
  writeLog('ERROR', message);
};
