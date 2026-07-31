import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

interface DesktopPackageBuild {
  asar: boolean;
  executableName: string;
  extraResources: Array<{
    from: string;
    to: string;
  }>;
  win: {
    icon: string;
    artifactName: string;
  };
  nsis: {
    oneClick: boolean;
    perMachine: boolean;
    deleteAppDataOnUninstall: boolean;
  };
}

const desktopPackagePath = resolve(import.meta.dirname, '../../../package.json');
const desktopPackage = JSON.parse(
  readFileSync(desktopPackagePath, 'utf8'),
) as {
  version: string;
  productName: string;
  build: DesktopPackageBuild;
};
const expectedArtifactName = [
  'CR-TradeDocAssistant-',
  '$',
  '{version}-',
  '$',
  '{arch}-setup.',
  '$',
  '{ext}',
].join('');

describe('Windows packaging configuration', () => {
  it('bundles the frozen worker outside ASAR', () => {
    expect(desktopPackage.version).toBe('0.6.0-beta.1');
    expect(desktopPackage.productName).toBe('中俄贸易文件助手');
    expect(desktopPackage.build.asar).toBe(true);
    expect(desktopPackage.build.extraResources).toContainEqual({
      from: '../../workers/excel-worker/dist/rus-trade-worker',
      to: 'worker',
      filter: ['**/*'],
    });
    expect(desktopPackage.build.extraResources).toContainEqual({
      from: '../../resources/licenses',
      to: 'licenses',
      filter: ['**/*'],
    });
  });

  it('preserves application data during per-user uninstall', () => {
    expect(desktopPackage.build.nsis).toMatchObject({
      oneClick: false,
      perMachine: false,
      deleteAppDataOnUninstall: false,
    });
  });

  it('uses a stable installer name and application icon', () => {
    expect(desktopPackage.build.executableName).toBe(
      'CR-TradeDocAssistant',
    );
    expect(desktopPackage.build.win).toMatchObject({
      icon: '../../resources/icons/app-icon.ico',
      artifactName: expectedArtifactName,
    });
  });
});
