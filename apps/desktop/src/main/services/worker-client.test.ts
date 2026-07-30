import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { WorkerClient } from './worker-client';

const workerEntry = fileURLToPath(
  new URL('../../../../../workers/excel-worker/src/main.py', import.meta.url),
);
const standardWorkbook = fileURLToPath(
  new URL('../../../../../resources/samples/m1-standard.xlsx', import.meta.url),
);
const pythonExecutable = process.env.RUS_TRADE_PYTHON
  ?? (process.platform === 'win32' ? 'python' : 'python3');
const workerTestDataRoot = fileURLToPath(
  new URL('../../../../../workers/excel-worker/.test-data', import.meta.url),
);

describe('WorkerClient', () => {
  it('returns worker information through JSON Lines', async () => {
    const workerClient = new WorkerClient(workerEntry, pythonExecutable);

    try {
      const response = await workerClient.getWorkerInfo();

      expect(response.type).toBe('completed');
      if (response.type === 'completed') {
        expect(response.data.protocolVersion).toBe('1.0');
        expect(response.data.workerVersion).toBeTruthy();
        expect(response.data.pythonVersion).toBeTruthy();
      }
    } finally {
      workerClient.stop();
    }
  });

  it('parses, previews, and builds stable import rows', async () => {
    const workerClient = new WorkerClient(workerEntry, pythonExecutable);

    try {
      const workbook = await workerClient.parseWorkbook(standardWorkbook);

      expect(workbook.type).toBe('completed');
      if (workbook.type !== 'completed') {
        return;
      }

      expect(workbook.data.defaultSheetName).toBe('问题反馈');
      expect(workbook.data.sheets[0].recommendedHeaderRow).toBe(2);

      const preview = await workerClient.previewSheet(
        standardWorkbook,
        '问题反馈',
        2,
      );

      expect(preview.type).toBe('completed');
      if (preview.type !== 'completed') {
        return;
      }

      expect(preview.data.recommendations.sourceColumn).toBe(3);
      expect(preview.data.recommendations.targetColumn).toBe(4);

      const rows = await workerClient.buildImportRows(
        standardWorkbook,
        '问题反馈',
        2,
        3,
        1,
        4,
      );

      expect(rows.type).toBe('completed');
      if (rows.type === 'completed') {
        expect(rows.data.totalRows).toBe(5);
        expect(rows.data.rows[0]).toMatchObject({
          sourceCell: 'C3',
          targetCell: 'D3',
          containerCell: 'A3',
        });
      }
    } finally {
      workerClient.stop();
    }
  });
  it('creates and processes a persistent offline translation task', async () => {
    const workerClient = new WorkerClient(
      workerEntry,
      pythonExecutable,
      join(workerTestDataRoot, `vitest-${randomUUID()}`),
    );

    try {
      const created = await workerClient.createTranslationTask(
        standardWorkbook,
        {
          sheetName: '问题反馈',
          headerRow: 2,
          sourceColumn: 3,
          containerColumn: 1,
          targetColumn: 4,
          sourceLanguage: 'ru',
          targetLanguage: 'zh-CN',
        },
      );

      expect(created.type).toBe('completed');
      if (created.type !== 'completed') {
        return;
      }

      expect(created.data.task).toMatchObject({
        status: 'draft',
        totalRows: 5,
        pendingRows: 4,
        completedRows: 1,
      });

      const processed = await workerClient.processTranslationBatch({
        taskId: created.data.task.taskId,
        batchSize: 50,
      });

      expect(processed.type).toBe('completed');
      if (processed.type !== 'completed') {
        return;
      }

      expect(processed.data.task.status).toBe('awaiting_manual');
      expect(processed.data.task.pendingRows).toBe(0);
      expect(
        processed.data.task.candidateRows + processed.data.task.manualRows,
      ).toBe(4);

      const listed = await workerClient.listTranslationTasks();
      expect(listed.type).toBe('completed');
      if (listed.type === 'completed') {
        expect(listed.data.tasks[0].taskId).toBe(created.data.task.taskId);
      }
    } finally {
      workerClient.stop();
    }
  });
  it('preflights and exports a verified Excel copy', async () => {
    const dataDirectory = join(
      workerTestDataRoot,
      `vitest-${randomUUID()}`,
    );
    const workerClient = new WorkerClient(
      workerEntry,
      pythonExecutable,
      dataDirectory,
    );

    try {
      const created = await workerClient.createTranslationTask(
        standardWorkbook,
        {
          sheetName: '问题反馈',
          headerRow: 2,
          sourceColumn: 3,
          containerColumn: 1,
          targetColumn: 4,
          sourceLanguage: 'ru',
          targetLanguage: 'zh-CN',
        },
      );
      expect(created.type).toBe('completed');
      if (created.type !== 'completed') {
        return;
      }

      const { taskId } = created.data.task;
      const processed = await workerClient.processTranslationBatch({
        taskId,
        batchSize: 50,
      });
      expect(processed.type).toBe('completed');
      if (processed.type !== 'completed') {
        return;
      }

      const openRows = processed.data.rows.filter(
        (row) => row.status !== 'completed',
      );
      const updates = await Promise.all(openRows.map((row, index) => (
        workerClient.updateTranslationRow({
          taskId,
          rowId: row.rowId,
          translation: `桌面确认译文 ${index + 1}`,
        })
      )));
      expect(updates.every((response) => response.type === 'completed')).toBe(
        true,
      );

      const preflight = await workerClient.preflightExport({ taskId });
      expect(preflight.type).toBe('completed');
      if (preflight.type !== 'completed') {
        return;
      }
      expect(preflight.data).toMatchObject({
        ready: true,
        targetColumnLetter: 'D',
        writableRows: 4,
      });

      const outputPath = join(dataDirectory, 'desktop-export.xlsx');
      const exported = await workerClient.exportTranslationTask({
        taskId,
        outputPath,
      });
      expect(exported.type).toBe('completed');
      if (exported.type === 'completed') {
        expect(exported.data).toMatchObject({
          writtenRows: 4,
          validated: true,
        });
        expect(existsSync(outputPath)).toBe(true);
      }
    } finally {
      workerClient.stop();
    }
  });
});
