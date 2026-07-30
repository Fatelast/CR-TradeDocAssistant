const path = require('node:path');

const electronPackage = require('../node_modules/electron/package.json');

const customDirectory = process.env.ELECTRON_CUSTOM_DIR;

if (customDirectory?.includes('%%version%%')) {
  process.env.ELECTRON_CUSTOM_DIR = customDirectory.replaceAll(
    '%%version%%',
    electronPackage.version,
  );
}

require(path.join(
  __dirname,
  '..',
  'node_modules',
  'electron',
  'install.js',
));
