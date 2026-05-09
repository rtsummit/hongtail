#!/usr/bin/env pwsh
<#
.SYNOPSIS
  hongtail Windows build helper (NSIS only).

.PARAMETER Publish
  electron-builder 의 --publish always 를 활성화. GH_TOKEN 환경변수가 필요.
  release.ps1 에서 자동으로 set 하니 직접 호출할 일은 거의 없음.

.PARAMETER Clean
  dist/ 와 electron-builder 캐시를 정리한 뒤 빌드.

.EXAMPLE
  .\scripts\build-win.ps1
  .\scripts\build-win.ps1 -Clean
  .\scripts\build-win.ps1 -Publish
#>
param(
  [switch]$Publish,
  [switch]$Clean
)

$ErrorActionPreference = 'Stop'
# git bash / npm script 에서 PowerShell 호출 시 한글 출력이 cp949 로 나가
# UTF-8 로 해석되는 자식 stdout 에서 깨진다. 명시적으로 UTF-8 강제.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
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

$cliArgs = @('--win')
if ($Publish) {
  if (-not $env:GH_TOKEN) {
    throw "Publish 모드인데 GH_TOKEN 이 비어있음. release.ps1 을 쓰거나 \$env:GH_TOKEN 을 직접 set."
  }
  $cliArgs += '--publish'
  $cliArgs += 'always'
}

Step ("electron-builder (nsis{0})" -f $(if ($Publish) { ', publish' } else { '' }))
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
