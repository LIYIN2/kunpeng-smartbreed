const { execFileSync } = require('child_process');
const path = require('path');

/**
 * Give local macOS builds a complete ad-hoc signature.
 *
 * Electron's linker signature covers only the executable. Gatekeeper rejects
 * that partial state once resources are bundled. A deep ad-hoc signature is
 * sufficient for this lab-internal build; public distribution still requires
 * an Apple Developer ID and notarization.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  // Excluded pnpm dependency trees may leave directory-link entries behind in
  // an extraResource copy. Remove only broken links inside this staged app.
  execFileSync(
    'find',
    [appPath, '-type', 'l', '!', '-exec', 'test', '-e', '{}', ';', '-delete'],
    { stdio: 'inherit' },
  );
  // Finder/File Provider metadata copied from a mounted DMG is rejected by
  // codesign as resource-fork detritus. Remove it from the staged app only.
  execFileSync('xattr', ['-cr', appPath], { stdio: 'inherit' });
  execFileSync(
    'codesign',
    ['--force', '--deep', '--sign', '-', '--timestamp=none', appPath],
    { stdio: 'inherit' },
  );
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], {
    stdio: 'inherit',
  });
};
