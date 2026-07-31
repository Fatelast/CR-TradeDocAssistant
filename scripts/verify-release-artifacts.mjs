import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const releaseDirectory = join(projectRoot, 'release');
const unpackedDirectory = join(releaseDirectory, 'win-unpacked');
const appExecutable = join(
  unpackedDirectory,
  'CR-TradeDocAssistant.exe',
);
const workerDirectory = join(
  unpackedDirectory,
  'resources',
  'worker',
);
const workerExecutable = join(
  workerDirectory,
  'rus-trade-worker.exe',
);
const workerInternalDirectory = join(workerDirectory, '_internal');
const appArchive = join(unpackedDirectory, 'resources', 'app.asar');
const thirdPartyNotices = join(
  unpackedDirectory,
  'resources',
  'THIRD_PARTY_NOTICES.md',
);
const pyInstallerLicense = join(
  unpackedDirectory,
  'resources',
  'licenses',
  'PYINSTALLER-LICENSE.txt',
);

const requiredPaths = [
  releaseDirectory,
  unpackedDirectory,
  appExecutable,
  workerExecutable,
  workerInternalDirectory,
  appArchive,
  thirdPartyNotices,
  pyInstallerLicense,
];
for (const requiredPath of requiredPaths) {
  if (!existsSync(requiredPath)) {
    throw new Error(`Required release artifact is missing: ${requiredPath}`);
  }
}

const setupFiles = readdirSync(releaseDirectory)
  .filter((name) => /^CR-TradeDocAssistant-.*-setup\.exe$/u.test(name))
  .sort();
if (setupFiles.length !== 1) {
  throw new Error(`Expected one setup executable, received ${setupFiles.length}`);
}

const hashFile = (filePath) => new Promise((resolveHash, rejectHash) => {
  const hash = createHash('sha256');
  const input = createReadStream(filePath);
  input.on('error', rejectHash);
  input.on('data', (chunk) => hash.update(chunk));
  input.on('end', () => resolveHash(hash.digest('hex')));
});

const setupName = setupFiles[0];
const setupPath = join(releaseDirectory, setupName);
const setupSize = statSync(setupPath).size;
const workerSize = statSync(workerExecutable).size;
const setupHash = await hashFile(setupPath);
const maximumInstallerSize = 300 * 1024 * 1024;
if (setupSize > maximumInstallerSize) {
  throw new Error(`Installer exceeds 300 MiB: ${setupSize} bytes`);
}
writeFileSync(
  join(releaseDirectory, 'SHA256SUMS.txt'),
  `${setupHash}  ${setupName}\n`,
  'utf8',
);

process.stdout.write([
  'Release artifacts verified.',
  `Installer: ${setupName}`,
  `Installer bytes: ${setupSize}`,
  `Worker executable bytes: ${workerSize}`,
  `SHA-256: ${setupHash}`,
  '',
].join('\n'));
