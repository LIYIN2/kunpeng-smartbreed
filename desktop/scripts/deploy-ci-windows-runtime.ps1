$ErrorActionPreference = 'Stop'

$DesktopRoot = Split-Path -Parent $PSScriptRoot
$BundleRoot = Join-Path $DesktopRoot 'bundle'
$SourceRoot = Join-Path $BundleRoot 'dsh'
$RuntimeRoot = Join-Path $BundleRoot 'dsh-runtime'

if (-not (Test-Path (Join-Path $SourceRoot 'apps\cli\lib\bin.js'))) {
  throw 'Built Harness CLI is missing before production deployment'
}
if (Test-Path $RuntimeRoot) { Remove-Item $RuntimeRoot -Recurse -Force }

Push-Location $SourceRoot
try {
  pnpm --filter @deepseek-ai/dsh deploy --prod --legacy $RuntimeRoot
} finally {
  Pop-Location
}

Copy-Item (Join-Path $SourceRoot '.agents') $RuntimeRoot -Recurse -Force
Copy-Item (Join-Path $SourceRoot '.desktop-version') $RuntimeRoot -Force

$required = @(
  (Join-Path $RuntimeRoot 'node_modules'),
  (Join-Path $RuntimeRoot 'lib\bin.js'),
  (Join-Path $RuntimeRoot 'config'),
  (Join-Path $RuntimeRoot '.agents\skills'),
  (Join-Path $RuntimeRoot '.agents\knowledge')
)
$missing = $required | Where-Object { -not (Test-Path $_) }
if ($missing.Count -gt 0) {
  throw "Production runtime is incomplete: $($missing -join ', ')"
}

$sourceBytes = (Get-ChildItem $SourceRoot -Recurse -File | Measure-Object Length -Sum).Sum
$runtimeBytes = (Get-ChildItem $RuntimeRoot -Recurse -File | Measure-Object Length -Sum).Sum
if ($runtimeBytes -ge $sourceBytes) {
  throw "Production runtime was not pruned: source=$sourceBytes runtime=$runtimeBytes"
}
Write-Host "Pruned Harness runtime: source=$sourceBytes bytes, runtime=$runtimeBytes bytes"
