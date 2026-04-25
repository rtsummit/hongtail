import { app, dialog, ipcMain, BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'

function workspacesFile(): string {
  return join(app.getPath('userData'), 'workspaces.json')
}

async function loadWorkspaces(): Promise<string[]> {
  const file = workspacesFile()
  try {
    const content = await fs.readFile(file, 'utf-8')
    if (!content.trim()) return []
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed)) {
      return parsed.filter((p): p is string => typeof p === 'string')
    }
    return []
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

async function saveWorkspaces(workspaces: string[]): Promise<void> {
  await fs.writeFile(workspacesFile(), JSON.stringify(workspaces, null, 2), 'utf-8')
}

export function registerWorkspaceHandlers(): void {
  ipcMain.handle('workspaces:load', async () => loadWorkspaces())

  ipcMain.handle('workspaces:save', async (_, workspaces: string[]) => {
    await saveWorkspaces(workspaces)
  })

  ipcMain.handle('workspaces:pick-directory', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: '대화 디렉터리 선택',
          properties: ['openDirectory']
        })
      : await dialog.showOpenDialog({
          title: '대화 디렉터리 선택',
          properties: ['openDirectory']
        })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
