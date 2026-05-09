#!/usr/bin/env pwsh
<#
.SYNOPSIS
  hongtail 릴리즈 발행 — version bump + commit + push + Windows NSIS 빌드 + GitHub release publish.

.PARAMETER BumpType
  patch / minor / major. Default: patch.

.PARAMETER SkipPush
  bump·commit 만 하고 push / 빌드 / publish 는 건너뜀 (점검용).

.PARAMETER NoPublish
  build 까지만. GitHub release 자동 업로드는 건너뜀 (네트워크 없는 점검용).

.PARAMETER Clean
  build-win.ps1 의 -Clean 을 그대로 forward.

.EXAMPLE
  .\scripts\release.ps1
  .\scripts\release.ps1 -BumpType minor -Clean
  .\scripts\release.ps1 -NoPublish
#>
param(
  [ValidateSet('patch', 'minor', 'major')]
  [string]$BumpType = 'patch',
  [switch]$SkipPush,
  [switch]$NoPublish,
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

# 1. preflight
Step "preflight"
$status = git status --porcelain
if ($status) {
  Write-Host $status
  throw "working tree 가 dirty — release 전에 정리하세요."
}
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'main') {
  Write-Warning "현재 브랜치가 main 이 아닙니다 ($branch). 계속 진행합니다."
}
Write-Host "  branch: $branch"

if (-not $NoPublish -and -not $SkipPush) {
  # gh CLI 가 깔려있고 로그인 되어있어야 GH_TOKEN 을 자동 주입 가능.
  $ghPath = Get-Command gh -ErrorAction SilentlyContinue
  if (-not $ghPath) {
    throw "gh CLI 가 없음. https://cli.github.com 에서 설치하거나 -NoPublish 로 빌드만."
  }
  $ghStatus = gh auth status 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Host $ghStatus
    throw "gh auth 미완료. 'gh auth login' 후 다시. (또는 -NoPublish)"
  }
  Write-Host "  gh: ok"
}

# 2. version bump
Step "version bump ($BumpType)"
$pkgPath = Join-Path $repoRoot 'package.json'
# PS 5.1 의 Get-Content -Raw 는 BOM 없는 파일을 시스템 기본 인코딩 (한글 Windows
# 의 cp949) 로 읽어서 description 의 한글이 깨진 채 메모리에 들어온다. UTF-8 로
# 명시 읽기.
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
$pkgRaw = [System.IO.File]::ReadAllText($pkgPath, $utf8NoBom)
$old = if ($pkgRaw -match '"version"\s*:\s*"(\d+)\.(\d+)\.(\d+)"') {
  @{ major = [int]$Matches[1]; minor = [int]$Matches[2]; patch = [int]$Matches[3] }
} else {
  throw "package.json 에서 version 을 못 찾음"
}
$new = switch ($BumpType) {
  'patch' { @{ major = $old.major; minor = $old.minor; patch = $old.patch + 1 } }
  'minor' { @{ major = $old.major; minor = $old.minor + 1; patch = 0 } }
  'major' { @{ major = $old.major + 1; minor = 0; patch = 0 } }
}
$oldVer = "$($old.major).$($old.minor).$($old.patch)"
$newVer = "$($new.major).$($new.minor).$($new.patch)"
Write-Host "  $oldVer → $newVer"
$pkgRaw = $pkgRaw -replace '"version"\s*:\s*"\d+\.\d+\.\d+"', "`"version`": `"$newVer`""
# package.json 끝에 trailing newline 보존. PS 5.1 의 -Encoding utf8 은 BOM 을
# 넣어서 vite/node 의 JSON parser 가 깨진다 (PostCSS config 도 같이). .NET API
# 로 BOM 없는 UTF-8 으로 직접 쓴다.
[System.IO.File]::WriteAllText($pkgPath, $pkgRaw, $utf8NoBom)

# 3. commit
Step "commit"
git add package.json
if ($LASTEXITCODE -ne 0) { throw "git add 실패" }
git commit -m "chore: bump version to $newVer"
if ($LASTEXITCODE -ne 0) { throw "git commit 실패" }

# 4. push
if ($SkipPush) {
  Write-Host ""
  Write-Host "⚠ -SkipPush — push / 빌드 / publish 건너뜀. 끝." -ForegroundColor Yellow
  exit 0
}
Step "push"
git push
if ($LASTEXITCODE -ne 0) { throw "git push 실패" }

# 5. build (+ optional publish)
$buildArgs = @{}
if ($Clean) { $buildArgs.Clean = $true }
if (-not $NoPublish) {
  $buildArgs.Publish = $true
  # electron-builder 는 GH_TOKEN 을 읽음. gh CLI 의 토큰을 그대로 재사용해서
  # 사용자가 별도 PAT 발급 안 해도 되게.
  $env:GH_TOKEN = (gh auth token).Trim()
  if (-not $env:GH_TOKEN) { throw "gh auth token 이 비어있음." }
}

Step ("build{0}" -f $(if ($buildArgs.Publish) { ' + publish' } else { '' }))
& "$PSScriptRoot\build-win.ps1" @buildArgs
if ($LASTEXITCODE -ne 0) { throw "build 실패" }

Write-Host ""
if ($NoPublish) {
  Write-Host "✓ release v$newVer 빌드 완료 (publish 건너뜀)" -ForegroundColor Green
} else {
  Write-Host "✓ release v$newVer publish 완료" -ForegroundColor Green
  Write-Host "  → https://github.com/rtsummit/hongtail/releases/tag/v$newVer" -ForegroundColor DarkGray
}
