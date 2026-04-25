import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  workspaces: {
    load: (): Promise<string[]> => ipcRenderer.invoke('workspaces:load'),
    save: (paths: string[]): Promise<void> => ipcRenderer.invoke('workspaces:save', paths),
    pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('workspaces:pick-directory')
  },
  claude: {
    listSessions: (cwd: string) => ipcRenderer.invoke('claude:list-sessions', cwd),
    deleteSession: (cwd: string, sessionId: string): Promise<void> =>
      ipcRenderer.invoke('claude:delete-session', cwd, sessionId)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
