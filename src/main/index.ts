import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { setupLogging } from './logging'
import { registerWorkspaceHandlers } from './workspaces'
import { registerClaudeHandlers } from './claude'
import { registerSessionHandlers, killAllSessions } from './session'
import { registerBtwHandlers, killAllBtw } from './btw'
import { registerPtyHandlers, killAllPty } from './pty'
import { registerFontHandlers } from './fonts'
import { registerSlashCommandHandlers } from './slashCommands'
import { registerUsageCacheHandlers } from './usageCache'
import { registerImageHandlers } from './images'
import { registerSessionAliasHandlers } from './sessionAliases'
import { startRpcServer, stopRpcServer } from './rpc'
import { startWebServer, stopWebServer } from './web'
import { loadWebSettings, saveWebSettings } from './webSettings'
import { registerInvoke } from './ipc'

const TEST_INSTANCE = process.env.HONGLUADE_TEST === '1'
const APP_NAME = TEST_INSTANCE ? 'hongluade_test' : 'hongluade'
process.title = APP_NAME

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    title: APP_NAME,
    backgroundColor: '#1e1e1e',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // xterm.js 의 textarea 가 Alt+F4 를 ESC+F4 시퀀스로 PTY 에 보내버려 OS 가
  // 윈도우 닫기를 못 받는 케이스가 있다. before-input-event 는 web content 로
  // 키가 전달되기 전 단계라 xterm 보다 먼저 발화한다.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (
      input.alt &&
      !input.control &&
      !input.meta &&
      !input.shift &&
      input.key === 'F4'
    ) {
      event.preventDefault()
      mainWindow.close()
    }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
setupLogging()

app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId(TEST_INSTANCE ? 'com.electron.test' : 'com.electron')
  app.setName(APP_NAME)

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  registerWorkspaceHandlers()
  registerClaudeHandlers()
  registerSessionHandlers()
  registerBtwHandlers()
  registerPtyHandlers()
  registerFontHandlers()
  registerSlashCommandHandlers()
  registerUsageCacheHandlers()
  registerImageHandlers()
  registerSessionAliasHandlers()

  createWindow()

  startRpcServer(() => BrowserWindow.getAllWindows()[0] ?? null)
  void (async () => {
    const settings = await loadWebSettings()
    startWebServer(settings)
  })()
  registerInvoke('web:settings:get', () => loadWebSettings())
  registerInvoke('web:settings:set', async (next: unknown) => {
    const settings = await loadWebSettings()
    const merged = { ...settings, ...(next as object) }
    await saveWebSettings(merged)
    // env override 는 startup 시에만 적용. 사용자가 GUI 로 끄면 env 가
    // 켜져있어도 그대로 끔 (사용자 의도 우선).
    startWebServer(merged)
    return merged
  })

  // TLS cert/key 파일 선택 다이얼로그. 웹에서는 OS 다이얼로그가 없어 의미 무 →
  // ipcMain 에만 등록. webShim 은 prompt 로 fallback.
  ipcMain.handle('web:pick-tls-file', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const opts = {
      title: 'TLS 파일 선택 (.pem / .crt / .key)',
      filters: [
        { name: 'PEM / CRT / KEY', extensions: ['pem', 'crt', 'key'] },
        { name: '모든 파일', extensions: ['*'] }
      ],
      properties: ['openFile' as const]
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  killAllSessions()
  killAllBtw()
  killAllPty()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  killAllSessions()
  killAllBtw()
  killAllPty()
  stopRpcServer()
  stopWebServer()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
