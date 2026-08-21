const fs = require('fs');
const path = require('path');

/**
 * A Windows installer must be produced on Windows with its dependency tree
 * already installed. Cross-building on macOS creates an EXE whose first run
 * still needs network installation and can contain incompatible native files.
 */
exports.default = async function beforePack(context) {
  if (context.electronPlatformName !== 'win32') return;
  if (process.platform !== 'win32') {
    throw new Error('Windows release builds must run on a Windows runner; macOS cross-builds are not releasable.');
  }
  const dsh = path.join(context.packager.projectDir, 'bundle', 'dsh');
  const required = [
    path.join(dsh, 'node_modules'),
    path.join(dsh, 'apps', 'cli', 'lib', 'bin.js'),
    path.join(dsh, 'apps', 'web', 'dist'),
  ];
  const missing = required.filter((target) => !fs.existsSync(target));
  if (missing.length > 0) {
    throw new Error('Offline Windows runtime is incomplete:\n' + missing.join('\n'));
  }
};
