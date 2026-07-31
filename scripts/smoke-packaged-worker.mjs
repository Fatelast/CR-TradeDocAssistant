import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const projectRoot = resolve(import.meta.dirname, '..');
const executableName = process.platform === 'win32'
  ? 'rus-trade-worker.exe'
  : 'rus-trade-worker';
const workerExecutable = join(
  projectRoot,
  'workers',
  'excel-worker',
  'dist',
  'rus-trade-worker',
  executableName,
);
const sampleWorkbook = join(
  projectRoot,
  'resources',
  'samples',
  'm1-standard.xlsx',
);
const dataDirectory = join(
  projectRoot,
  'workers',
  'excel-worker',
  'dist',
  `smoke-data-打包测试-${randomUUID()}`,
);

if (!existsSync(workerExecutable)) {
  throw new Error(`Packaged worker not found: ${workerExecutable}`);
}

mkdirSync(dataDirectory, { recursive: true });

const requests = [
  {
    protocolVersion: '1.0',
    id: 'packaged-info',
    type: 'request',
    action: 'get_worker_info',
    payload: {},
  },
  {
    protocolVersion: '1.0',
    id: 'packaged-workbook',
    type: 'request',
    action: 'parse_workbook',
    payload: { filePath: sampleWorkbook },
  },
];

const childProcess = spawn(workerExecutable, [], {
  env: {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    RUS_TRADE_DATA_DIR: dataDirectory,
  },
  stdio: 'pipe',
  windowsHide: true,
});

let stdout = '';
let stderr = '';
childProcess.stdout.setEncoding('utf8');
childProcess.stderr.setEncoding('utf8');
childProcess.stdout.on('data', (chunk) => {
  stdout += chunk;
});
childProcess.stderr.on('data', (chunk) => {
  stderr += chunk;
});

const completed = new Promise((resolveProcess, rejectProcess) => {
  const timeout = setTimeout(() => {
    childProcess.kill();
    rejectProcess(new Error('Packaged worker smoke test timed out'));
  }, 30_000);

  childProcess.once('error', (error) => {
    clearTimeout(timeout);
    rejectProcess(error);
  });
  childProcess.once('close', (code) => {
    clearTimeout(timeout);
    if (code !== 0) {
      rejectProcess(new Error(
        `Packaged worker exited with ${code}: ${stderr.trim()}`,
      ));
      return;
    }
    resolveProcess();
  });
});

try {
  childProcess.stdin.end(
    `${requests.map((request) => JSON.stringify(request)).join('\n')}\n`,
    'utf8',
  );
  await completed;

  const responses = stdout
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  if (responses.length !== requests.length) {
    throw new Error(`Expected 2 responses, received ${responses.length}`);
  }

  const workerInfo = responses.find(({ id }) => id === 'packaged-info');
  if (workerInfo?.type !== 'completed'
    || workerInfo.data?.protocolVersion !== '1.0') {
    throw new Error('Packaged worker protocol check failed');
  }

  const workbook = responses.find(({ id }) => id === 'packaged-workbook');
  if (workbook?.type !== 'completed'
    || workbook.data?.defaultSheetName !== '问题反馈') {
    throw new Error(`Packaged worker openpyxl check failed: ${JSON.stringify(workbook)}`);
  }

  process.stdout.write(
    `Packaged worker smoke test passed (${workerInfo.data.workerVersion}).\n`,
  );
} finally {
  rmSync(dataDirectory, { recursive: true, force: true });
}
