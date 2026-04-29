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

# 포트가 모두 풀릴 때까지 대기. 점유 중이면 다시 kill 후 재시도.
# (Kill-ByPort/Kill-ByRepoPath 직후엔 OS 가 포트 release 를 안 끝낸 경우가 있어서
#  곧바로 npm run dev 로 들어가면 web 서버가 'address in use' 로 disabled 됨.)
function Wait-PortsFree {
  param([int[]]$Ports, [int]$MaxAttempts = 8, [int]$DelayMs = 750)
  for ($i = 1; $i -le $MaxAttempts; $i++) {
    $busy = [System.Collections.Generic.List[hashtable]]::new()
    foreach ($p in $Ports) {
      $conns = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
      if ($conns) { $busy.Add(@{ Port = $p; Conns = @($conns) }) }
    }
    if ($busy.Count -eq 0) { return $true }

    $portList = ($busy | ForEach-Object { $_.Port }) -join ', '
    Write-Host ("  포트 점유 중 {0}/{1}: {2}" -f $i, $MaxAttempts, $portList) -ForegroundColor Yellow
    foreach ($entry in $busy) {
      foreach ($c in $entry.Conns) {
        if ($c.OwningProcess) { Stop-Tree $c.OwningProcess "port $($entry.Port) (재시도 $i)" }
      }
    }
    Start-Sleep -Milliseconds $DelayMs
  }
  return $false
}

Write-Host "▸ 기존 hongtail dev 프로세스 정리" -ForegroundColor Cyan
$rpcPort = if ($Test) { 9877 } else { 9876 }
$webPort = 9888  # web-settings.json 기본 — main 과 test 둘 다 사용 (test 는 충돌 시 disabled)
Kill-ByPort $rpcPort
Kill-ByRepoPath $repoRoot

Write-Host ""
Write-Host "▸ 포트 release 대기 (RPC $rpcPort, web $webPort)" -ForegroundColor Cyan
$portsToFree = if ($Test) { @($rpcPort) } else { @($rpcPort, $webPort) }
$freed = Wait-PortsFree -Ports $portsToFree
if (-not $freed) {
  Write-Host "  ⚠ 포트가 끝까지 release 안 됨 — 그래도 진행. dev 시작 후 web/rpc 가 disabled 되면 한 번 더 실행하세요." -ForegroundColor Yellow
}

Write-Host ""
$label = if ($Test) { 'test 인스턴스 (HONGTAIL_TEST=1, RPC 9877)' } else { 'main 인스턴스 (RPC 9876)' }
Write-Host "▸ dev 재시작 — $label" -ForegroundColor Cyan
Set-Location $repoRoot
if ($Test) { $env:HONGTAIL_TEST = '1' }
npm run dev
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
  Write-Host ("⚠ npm run dev exited with code {0}" -f $exitCode) -ForegroundColor Yellow
}
exit $exitCode
