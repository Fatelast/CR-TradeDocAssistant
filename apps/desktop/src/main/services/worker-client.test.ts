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
});
