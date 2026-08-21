$ErrorActionPreference = 'Stop'

$DesktopRoot = Split-Path -Parent $PSScriptRoot
$RepoRoot = Split-Path -Parent $DesktopRoot
$BundleRoot = Join-Path $DesktopRoot 'bundle'
$DshRoot = Join-Path $BundleRoot 'dsh'
$NodeRoot = Join-Path $BundleRoot 'node-win-x64'
$HarnessCommit = '47f943859bef60e4160492346772ded9b24f765a'
$NodeVersion = 'v25.8.1'

if (Test-Path $DshRoot) { Remove-Item $DshRoot -Recurse -Force }
New-Item $BundleRoot -ItemType Directory -Force | Out-Null
git clone https://github.com/deepseek-ai/DeepSeek-Harness.git $DshRoot
git -C $DshRoot checkout $HarnessCommit

Copy-Item (Join-Path $DesktopRoot 'dsh-overlay\*') $DshRoot -Recurse -Force
Copy-Item (Join-Path $RepoRoot 'presets\kunpeng-smartbreed') (Join-Path $DshRoot 'apps\cli\config\agent-presets') -Recurse -Force
New-Item (Join-Path $DshRoot '.agents\skills') -ItemType Directory -Force | Out-Null
New-Item (Join-Path $DshRoot '.agents\knowledge') -ItemType Directory -Force | Out-Null
Copy-Item (Join-Path $RepoRoot 'skills\kunpeng-*') (Join-Path $DshRoot '.agents\skills') -Recurse -Force
Copy-Item (Join-Path $RepoRoot 'knowledge\md\*.md') (Join-Path $DshRoot '.agents\knowledge') -Force

$Version = (Get-Content (Join-Path $DesktopRoot 'package.json') -Raw | ConvertFrom-Json).version
Set-Content (Join-Path $DshRoot '.desktop-version') $Version -Encoding utf8NoBOM

if (Test-Path $NodeRoot) { Remove-Item $NodeRoot -Recurse -Force }
$ZipPath = Join-Path $env:RUNNER_TEMP "node-$NodeVersion-win-x64.zip"
$ExtractRoot = Join-Path $env:RUNNER_TEMP "node-$NodeVersion-win-x64"
Invoke-WebRequest "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip" -OutFile $ZipPath
Expand-Archive $ZipPath -DestinationPath $env:RUNNER_TEMP -Force
Move-Item $ExtractRoot $NodeRoot

Write-Host "Prepared Harness $HarnessCommit and Node $NodeVersion for Kunpeng $Version"
