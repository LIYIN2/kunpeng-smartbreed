$ErrorActionPreference = 'Stop'

$DesktopRoot = Split-Path -Parent $PSScriptRoot
$BundleRoot = Join-Path $DesktopRoot 'bundle'
$SourceRoot = Join-Path $BundleRoot 'dsh'
$RuntimeRoot = Join-Path $BundleRoot 'dsh-runtime'

if (-not (Test-Path (Join-Path $SourceRoot 'apps\cli\lib\bin.js'))) {
  throw 'Built Harness CLI is missing before production deployment'
}
if (Test-Path $RuntimeRoot) { Remove-Item $RuntimeRoot -Recurse -Force }

# The reviewed postinstall only restores a macOS executable bit and has already
# run during the source install. In pnpm's injected deploy tree its relative
# allowBuilds key becomes an absolute file:// key, which strictDepBuilds rejects.
# Remove only this exact, known script from the disposable Windows source clone;
# all other lifecycle-script approvals remain enforced.
$SubprocessPackagePath = Join-Path $SourceRoot 'packages\subprocess\subprocess-local\package.json'
$SubprocessPackage = Get-Content $SubprocessPackagePath -Raw | ConvertFrom-Json
$ExpectedPostinstall = 'node scripts/ensure-spawn-helper.mjs'
if ($SubprocessPackage.scripts.postinstall -ne $ExpectedPostinstall) {
  throw "Unexpected subprocess-local postinstall: $($SubprocessPackage.scripts.postinstall)"
}
$SubprocessPackage.scripts.PSObject.Properties.Remove('postinstall')
$SubprocessPackage | ConvertTo-Json -Depth 100 | Set-Content $SubprocessPackagePath -Encoding utf8NoBOM

Push-Location $SourceRoot
try {
  pnpm --filter @deepseek-ai/dsh deploy --prod $RuntimeRoot
} finally {
  Pop-Location
}

Copy-Item (Join-Path $SourceRoot '.agents') $RuntimeRoot -Recurse -Force
Copy-Item (Join-Path $SourceRoot '.desktop-version') $RuntimeRoot -Force

$required = @(
  (Join-Path $RuntimeRoot 'node_modules'),
  (Join-Path $RuntimeRoot 'lib\bin.js'),
  (Join-Path $RuntimeRoot 'config'),
  (Join-Path $RuntimeRoot 'node_modules\@deepseek-ai\dsh-web-app\lib\index.js'),
  (Join-Path $RuntimeRoot '.agents\skills'),
  (Join-Path $RuntimeRoot '.agents\knowledge')
)
$missing = $required | Where-Object { -not (Test-Path $_) }
if ($missing.Count -gt 0) {
  throw "Production runtime is incomplete: $($missing -join ', ')"
}

$webApp = (Resolve-Path (Join-Path $RuntimeRoot 'node_modules\@deepseek-ai\dsh-web-app')).Path
$runtimePrefix = (Resolve-Path $RuntimeRoot).Path + [IO.Path]::DirectorySeparatorChar
if (-not $webApp.StartsWith($runtimePrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Workspace dependency escaped the production runtime: $webApp"
}

$sourceBytes = (Get-ChildItem $SourceRoot -Recurse -File | Measure-Object Length -Sum).Sum
$runtimeBytes = (Get-ChildItem $RuntimeRoot -Recurse -File | Measure-Object Length -Sum).Sum
if ($runtimeBytes -ge $sourceBytes) {
  throw "Production runtime was not pruned: source=$sourceBytes runtime=$runtimeBytes"
}
Write-Host "Pruned Harness runtime: source=$sourceBytes bytes, runtime=$runtimeBytes bytes"
