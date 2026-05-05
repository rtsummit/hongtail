#!/usr/bin/env pwsh
<#
.SYNOPSIS
  hongtail 릴리즈 발행 — version bump + commit + push + Windows 빌드.

.PARAMETER Target
  portable / setup / both. Default: both.

.PARAMETER BumpType
  patch / minor / major. Default: patch.

.PARAMETER SkipPush
  bump·commit 만 하고 push 와 빌드는 건너뜀 (점검용).

.PARAMETER Clean
  build-win.ps1 의 -Clean 을 그대로 forward.

.EXAMPLE
  .\scripts\release.ps1
  .\scripts\release.ps1 -Target portable
  .\scripts\release.ps1 -BumpType minor -Clean
#>
param(
  [ValidateSet('portable', 'setup', 'both')]
  [string]$Target = 'both',
  [ValidateSet('patch', 'minor', 'major')]
  [string]$BumpType = 'patch',
  [switch]$SkipPush,
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
  Write-Host "⚠ -SkipPush — push 와 빌드 건너뜀. 끝." -ForegroundColor Yellow
  exit 0
}
Step "push"
git push
if ($LASTEXITCODE -ne 0) { throw "git push 실패" }

# 5. build
# splat (@buildArgs) 으로 넘기면 PS 5.1 에서 자식 ps1 의 ValidateSet 검증이
# 깨지는 케이스가 있다 (Target 인자가 array 로 넘어가서 매칭 실패). 명시적으로
# named 인자로 호출.
Step "build ($Target)"
if ($Clean) {
  & "$PSScriptRoot\build-win.ps1" -Target $Target -Clean
} else {
  & "$PSScriptRoot\build-win.ps1" -Target $Target
}
if ($LASTEXITCODE -ne 0) { throw "build 실패" }

Write-Host ""
Write-Host "✓ release v$newVer 완료" -ForegroundColor Green
