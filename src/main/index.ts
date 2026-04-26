import { app, shell, BrowserWindow, ipcMain, webContents } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { setupLogging } from './logging'
import { registerWorkspaceHandlers } from './workspaces'
import { registerClaudeHandlers } from './claude'
import { registerSessionHandlers, killAllSessions } from './session'
import { registerPtyHandlers, killAllPty } from './pty'
import { registerFontHandlers } from './fonts'
import { registerSlashCommandHandlers } from './slashCommands'
import { registerUsageCacheHandlers } from './usageCache'
import { registerImageHandlers } from './images'
import { registerSessionAliasHandlers } from './sessionAliases'
import { startRpcServer, stopRpcServer } from './rpc'

function registerFindInPageHandlers(): void {
  // Bridge Electron's webContents.findInPage to renderer-side FindBar.
  // findInPage highlights matches in DOM, gives match count via 'found-in-page'
  // event, and supports forward/back navigation. Doesn't touch <canvas> (xterm)
  // — terminal mode uses xterm-addon-search separately on the renderer side.
  ipcMain.handle(
    'find:start',
    (event, query: string, opts?: { findNext?: boolean; forward?: boolean }) => {
      if (!query) {
        event.sender.stopFindInPage('clearSelection')
        return
      }
      event.sender.findInPage(query, {
        findNext: opts?.findNext ?? false,
        forward: opts?.forward ?? true
      })
    }
  )
  ipcMain.handle('find:stop', (event) => {
    event.sender.stopFindInPage('clearSelection')
  })

  // Forward 'found-in-page' results back to the renderer that started the search.
  webContents.getAllWebContents().forEach((wc) => bindFoundInPage(wc))
  app.on('web-contents-created', (_, wc) => bindFoundInPage(wc))
}

function bindFoundInPage(wc: Electron.WebContents): void {
  wc.on('found-in-page', (_, result) => {
    if (wc.isDestroyed()) return
    wc.send('find:result', {
      requestId: result.requestId,
      activeMatchOrdinal: result.activeMatchOrdinal,
      matches: result.matches,
      finalUpdate: result.finalUpdate
    })
  })
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    title: 'hongluade',
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
  electronApp.setAppUserModelId('com.electron')

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
  registerPtyHandlers()
  registerFontHandlers()
  registerSlashCommandHandlers()
  registerUsageCacheHandlers()
  registerImageHandlers()
  registerSessionAliasHandlers()
  registerFindInPageHandlers()

  createWindow()

  startRpcServer(() => BrowserWindow.getAllWindows()[0] ?? null)

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
  killAllPty()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  killAllSessions()
  killAllPty()
  stopRpcServer()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
