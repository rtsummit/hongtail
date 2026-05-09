import { app, dialog, BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { autoUpdater } from 'electron-updater'

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000 // 4h
let scheduledCheck: NodeJS.Timeout | null = null
let promptOpen = false

export function setupAutoUpdater(): void {
  // dev 빌드와 _test 인스턴스는 skip — 둘 다 packaged 아니거나 동시 실행되는
  // 부수 인스턴스라 GitHub 에 churn 만 만든다.
  if (!app.isPackaged) {
    log.info('[updater] skip: not packaged (dev)')
    return
  }
  if (process.env.HONGTAIL_TEST === '1') {
    log.info('[updater] skip: HONGTAIL_TEST=1')
    return
  }

  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => log.info('[updater] checking…'))
  autoUpdater.on('update-available', (info) =>
    log.info('[updater] available:', info?.version)
  )
  autoUpdater.on('update-not-available', (info) =>
    log.info('[updater] not-available:', info?.version)
  )
  autoUpdater.on('error', (err) => {
    // 네트워크 일시 오류·release feed 부재 등은 사용자에게 안 보임. 다음 주기에서
    // 자연스럽게 retry.
    log.warn('[updater] error:', err?.message ?? err)
  })
  autoUpdater.on('download-progress', (p) =>
    log.info(`[updater] download ${Math.round(p.percent)}%`)
  )
  autoUpdater.on('update-downloaded', (info) => {
    log.info('[updater] downloaded:', info?.version)
    void promptInstall(info?.version)
  })

  void autoUpdater.checkForUpdates().catch((err) =>
    log.warn('[updater] initial check failed:', err?.message ?? err)
  )
  scheduledCheck = setInterval(() => {
    void autoUpdater
      .checkForUpdates()
      .catch((err) => log.warn('[updater] periodic check failed:', err?.message ?? err))
  }, CHECK_INTERVAL_MS)
}

async function promptInstall(version: string | undefined): Promise<void> {
  if (promptOpen) return
  promptOpen = true
  try {
    const win = BrowserWindow.getAllWindows()[0] ?? null
    const opts = {
      type: 'info' as const,
      buttons: ['지금 재시작', '나중에'],
      defaultId: 0,
      cancelId: 1,
      title: '업데이트 준비 완료',
      message: version
        ? `hongtail ${version} 업데이트가 다운로드되었습니다.`
        : 'hongtail 업데이트가 다운로드되었습니다.',
      detail: '지금 재시작하면 새 버전이 적용됩니다. 나중에 선택해도 다음 종료 시 자동으로 적용됩니다.'
    }
    const result = win
      ? await dialog.showMessageBox(win, opts)
      : await dialog.showMessageBox(opts)
    if (result.response === 0) {
      autoUpdater.quitAndInstall()
    }
  } finally {
    promptOpen = false
  }
}

export function stopAutoUpdater(): void {
  if (scheduledCheck) {
    clearInterval(scheduledCheck)
    scheduledCheck = null
  }
}
