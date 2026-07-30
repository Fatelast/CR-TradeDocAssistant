import {
  appendFileSync,
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';

import { app } from 'electron';

let logFilePath: string | undefined;

const sanitize = (message: string): string => (
  message
    .replace(/[\r\n]+/g, ' ')
    .replace(/([A-Za-z]:\\)[^ ]+/g, '$1[…]')
    .slice(0, 800)
);

const writeLog = (level: 'INFO' | 'ERROR', message: string): void => {
  const line = `${new Date().toISOString()} ${level} ${sanitize(message)}\n`;

  if (!logFilePath) {
    process.stderr.write(line);
    return;
  }

  appendFileSync(logFilePath, line, { encoding: 'utf8' });
};

export const initializeLogger = (): void => {
  const logsDirectory = app.getPath('logs');
  mkdirSync(logsDirectory, { recursive: true });
  logFilePath = join(logsDirectory, 'main.log');
};

export const logInfo = (message: string): void => {
  writeLog('INFO', message);
};

export const logError = (message: string): void => {
  writeLog('ERROR', message);
};
