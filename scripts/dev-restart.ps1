#!/usr/bin/env pwsh
<#
.SYNOPSIS
  hongtail dev 재시작.
  기존 electron / vite / 자식 claude·pty 프로세스를 정리한 뒤 `npm run dev` 실행.

  기본으로 electron-vite build 를 한 번 돌려 out/renderer/ 도 갱신한다 — web
  모드 (`src/main/web.ts` 의 serveStatic) 가 out/renderer/ 의 빌드 산출물을
  서빙하기 때문. dev 모드에서도 web 은 Vite HMR 을 안 받으므로 build 를 안
  하면 브라우저 web 사용자는 옛 번들을 계속 본다. typecheck 는 생략 (속도).

  앱 내부 PTY (hongtail electron main 의 손자) 에서 호출되면 정리 단계가
  electron 트리째 kill 하면서 PTY → 본 PowerShell → 본 스크립트 까지 같이
  죽어 dev 시작 전 자살한다. 따라서 첫 진입 시 WMI Win32_Process::Create 로
  본인 사본을 wmiprvse 트리에 detach spawn 하고 원본은 즉시 exit.
  사용자는 새 콘솔 창에서 build/dev 부팅 출력을 본다.

.PARAMETER Test
  Test 인스턴스로 띄움 (HONGTAIL_TEST=1, RPC 포트 9877).
  지정 시 9877 포트 + repo path 의 leaked 프로세스만 정리.

.PARAMETER NoBuild
  out/renderer/ 빌드 단계 생략. web 모드 안 쓰는 빠른 재시작용.

.PARAMETER Watch
  1회 build 대신 `electron-vite build --renderer --watch` 를 background 로
  띄움. 코드 변경마다 out/renderer/ 자동 rebuild → web 탭 새로고침으로 즉시
  반영. dev 종료 (Ctrl+C 등) 시 watch process 도 함께 정리. NoBuild 와는
  배타적이므로 같이 주면 NoBuild 가 우선해 watch 도 생략.

.PARAMETER Detached
  내부 사용. detach spawn 후 본인이 자기 자신을 다시 호출할 때만 붙인다.
  사람이 직접 줄 일은 없음.

.EXAMPLE
  .\scripts\dev-restart.ps1
  .\scripts\dev-restart.ps1 -Test
  .\scripts\dev-restart.ps1 -NoBuild
  .\scripts\dev-restart.ps1 -Watch
#>
param([switch]$Test, [switch]$NoBuild, [switch]$Watch, [switch]$Detached)

if (-not $Detached) {
  $hostPath = (Get-Process -Id $PID).Path
  $cmdLine = '"{0}" -NoProfile -ExecutionPolicy Bypass -File "{1}" -Detached' -f $hostPath, $PSCommandPath
  if ($Test)    { $cmdLine += ' -Test' }
  if ($NoBuild) { $cmdLine += ' -NoBuild' }
  if ($Watch)   { $cmdLine += ' -Watch' }
  $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmdLine }
  if ($r.ReturnValue -eq 0) {
    Write-Host ("✓ detached spawn (PID {0}) — 새 콘솔 창에서 진행합니다. 이 창은 종료됩니다." -f $r.ProcessId) -ForegroundColor Green
    exit 0
  }
  Write-Host ("⚠ detach 실패 (ReturnValue={0}) — 그대로 진행. 앱 내부 PTY 면 자살 위험." -f $r.ReturnValue) -ForegroundColor Yellow
}

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

Set-Location $repoRoot

# out/renderer/ 갱신 — web 모드 사용자가 최신 코드 받게 함. typecheck 건너뛰고
# electron-vite build 직접 호출. main/preload 도 같이 빌드되지만 곧 npm run dev
# 가 다시 덮어쓰므로 무해.
$watchProc = $null
if (-not $NoBuild) {
  Write-Host ""
  if ($Watch) {
    Write-Host "▸ out/renderer/ watch 빌드 (background — 변경 시 자동 rebuild)" -ForegroundColor Cyan
    # cmd /c 로 wrap — Windows 에서 npx 는 .cmd 라 Start-Process 가 직접 못 spawn
    # 하는 경우가 있어서 cmd 경유. -NoNewWindow 로 같은 콘솔에 출력.
    $watchProc = Start-Process -FilePath 'cmd.exe' `
      -ArgumentList '/c','npx electron-vite build --renderer --watch' `
      -NoNewWindow -PassThru -WorkingDirectory $repoRoot
    Write-Host ("  watch PID {0} — web 탭 새로고침으로 최신 번들 반영" -f $watchProc.Id)
  } else {
    Write-Host "▸ out/ 빌드 (web 모드용 — typecheck 생략, 1회)" -ForegroundColor Cyan
    & npx electron-vite build
    if ($LASTEXITCODE -ne 0) {
      Write-Host "  ⚠ build 실패 (exit $LASTEXITCODE) — 그래도 dev 진행. web 사용자는 옛 번들 그대로." -ForegroundColor Yellow
    }
  }
}

Write-Host ""
$label = if ($Test) { 'test 인스턴스 (HONGTAIL_TEST=1, RPC 9877)' } else { 'main 인스턴스 (RPC 9876)' }
Write-Host "▸ dev 재시작 — $label" -ForegroundColor Cyan
if ($Test) { $env:HONGTAIL_TEST = '1' }
$exitCode = 0
try {
  npm run dev
  $exitCode = $LASTEXITCODE
} finally {
  if ($watchProc -and -not $watchProc.HasExited) {
    Write-Host ""
    Write-Host ("▸ watch process 정리 (PID {0})" -f $watchProc.Id) -ForegroundColor Cyan
    & taskkill /F /T /PID $watchProc.Id *> $null
  }
}
if ($exitCode -ne 0) {
  Write-Host ("⚠ npm run dev exited with code {0}" -f $exitCode) -ForegroundColor Yellow
}
exit $exitCode
