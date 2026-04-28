#!/usr/bin/env pwsh
<#
.SYNOPSIS
  hongtail Windows build helper.

.PARAMETER Target
  portable / setup / both. Default: portable.

.PARAMETER Clean
  dist/ 와 electron-builder 캐시를 정리한 뒤 빌드.

.EXAMPLE
  .\scripts\build-win.ps1
  .\scripts\build-win.ps1 -Target setup
  .\scripts\build-win.ps1 -Target both -Clean
#>
param(
  [ValidateSet('portable', 'setup', 'both')]
  [string]$Target = 'portable',
  [switch]$Clean
)

$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path "$PSScriptRoot\.."
Set-Location $repoRoot

function Step($msg) {
  Write-Host ""
  Write-Host "▸ $msg" -ForegroundColor Cyan
}

if ($Clean) {
  Step "이전 빌드 결과 정리"
  if (Test-Path .\dist) {
    Remove-Item -Recurse -Force .\dist
    Write-Host "  removed dist/"
  }
  $cache = "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign"
  if (Test-Path $cache) {
    Remove-Item -Recurse -Force $cache
    Write-Host "  removed winCodeSign cache"
  }
}

Step "타입체크 + Vite 번들"
npm run build
if ($LASTEXITCODE -ne 0) { throw "build (typecheck/vite) 실패" }

# electron-builder targets
$cliArgs = @('--win')
switch ($Target) {
  'portable' { $cliArgs += '--config.win.target=portable' }
  'setup'    { $cliArgs += '--config.win.target=nsis' }
  'both'     { $cliArgs += '--config.win.target=portable'; $cliArgs += '--config.win.target=nsis' }
}

Step "electron-builder ($Target)"
& npx electron-builder @cliArgs
if ($LASTEXITCODE -ne 0) { throw "electron-builder 실패" }

Step "결과"
$exes = Get-ChildItem .\dist\*.exe -ErrorAction SilentlyContinue
if (-not $exes) {
  Write-Warning "dist 에 .exe 가 없습니다."
  exit 1
}
foreach ($exe in $exes) {
  $sizeMB = [math]::Round($exe.Length / 1MB, 1)
  Write-Host ("  {0}  ({1} MB)" -f $exe.Name, $sizeMB) -ForegroundColor Green
  Write-Host ("  → $($exe.FullName)") -ForegroundColor DarkGray
}
