# 鲲鹏智育 Kunpeng SmartBreed — 安装到 DeepSeek Harness (Windows)

$ErrorActionPreference = "Stop"

$Here = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

# 定位 dsh 目录
$DshDir = $env:DSH_DIR
if (-not $DshDir) {
    $RuntimeDsh = Join-Path $env:USERPROFILE ".dsh
untimedsh"
    if (Test-Path (Join-Path $RuntimeDsh "appscli")) {
        $DshDir = $RuntimeDsh
    } elseif (Test-Path (Join-Path $Here "..dshappscli")) {
        $DshDir = Join-Path $Here "..dsh"
    } else {
        Write-Host "错误：找不到 dsh 目录。请设置环境变量 DSH_DIR 指向 dsh 源码目录。" -ForegroundColor Red
        exit 1
    }
}

$PresetDir = Join-Path $DshDir "apps\cli\config\agent-presets"
$SkillDir = Join-Path $DshDir ".agents\skills"
$KnowledgeDir = Join-Path $DshDir ".agents\knowledge"

Write-Host "安装到: $DshDir"

# 1. 安装预设
if (Test-Path $PresetDir) {
    Copy-Item -Recurse -Force (Join-Path $Here "presets\kunpeng-smartbreed") $PresetDir
    Write-Host "✓ 预设已安装: 鲲鹏智育" -ForegroundColor Green
} else {
    Write-Warning "未找到 agent-presets 目录，跳过预设安装: $PresetDir"
}

# 2. 安装技能
if (Test-Path $SkillDir) {
    New-Item -ItemType Directory -Force -Path $KnowledgeDir | Out-Null
    Get-ChildItem (Join-Path $Here "skills") -Directory -Filter "kunpeng-*" | ForEach-Object {
        Copy-Item -Recurse -Force $_.FullName $SkillDir
    }
    Get-ChildItem (Join-Path $Here "knowledge\md") -Filter "*.md" | ForEach-Object {
        Copy-Item -Force $_.FullName $KnowledgeDir
    }
    Write-Host "✓ 技能已安装: kunpeng-literature / kunpeng-workflow / kunpeng-governance / kunpeng-mating / kunpeng-knowledge" -ForegroundColor Green
    Write-Host "✓ 知识库已安装: $KnowledgeDir" -ForegroundColor Green
} else {
    Write-Warning "未找到 skills 目录，跳过技能安装: $SkillDir"
}

Write-Host ""
Write-Host "完成！重启 dsh 后，在智能体界面选择预设「鲲鹏智育」即可使用。"
