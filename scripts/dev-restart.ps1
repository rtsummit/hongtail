#!/usr/bin/env pwsh
<#
.SYNOPSIS
  hongtail dev 재시작.
  기존 electron / vite / 자식 claude·pty 프로세스를 정리한 뒤 `npm run dev` 실행.

.PARAMETER Test
  Test 인스턴스로 띄움 (HONGTAIL_TEST=1, RPC 포트 9877).
  지정 시 9877 포트 + repo path 의 leaked 프로세스만 정리.

.EXAMPLE
  .\scripts\dev-restart.ps1
  .\scripts\dev-restart.ps1 -Test
#>
param([switch]$Test)

$ErrorActionPreference = 'Continue'
$repoRoot = (Resolve-Path "$PSScriptRoot\..").Path.TrimEnd('\')

function Stop-Tree($targetPid, $reason) {
  Write-Host ("  {0} → PID {1} (tree kill)" -f $reason, $targetPid)
  & taskkill /F /T /PID $targetPid *> $null
}

function Kill-ByPort($port) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    if ($c.OwningProcess) { Stop-Tree $c.OwningProcess "port $port" }
  }
}

function Kill-ByRepoPath($root) {
  $self = $PID
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ProcessId -ne $self -and (
      ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) -or
      ($_.CommandLine -and $_.CommandLine -like "*$root*")
    )
  } | ForEach-Object {
    Stop-Tree $_.ProcessId "repo ($($_.Name))"
  }
}

Write-Host "▸ 기존 hongtail dev 프로세스 정리" -ForegroundColor Cyan
$port = if ($Test) { 9877 } else { 9876 }
Kill-ByPort $port
Kill-ByRepoPath $repoRoot

Write-Host ""
$label = if ($Test) { 'test 인스턴스 (HONGTAIL_TEST=1, RPC 9877)' } else { 'main 인스턴스 (RPC 9876)' }
Write-Host "▸ dev 재시작 — $label" -ForegroundColor Cyan
Set-Location $repoRoot
if ($Test) { $env:HONGTAIL_TEST = '1' }
npm run dev
