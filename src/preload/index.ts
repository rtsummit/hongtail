import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
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
      ipcRenderer.invoke('claude:delete-session', cwd, sessionId),
    startSession: (
      workspacePath: string,
      sessionId: string | null,
      mode: 'new' | 'resume'
    ): Promise<{ sessionId: string; alreadyRunning: boolean }> =>
      ipcRenderer.invoke('claude:start-session', { workspacePath, sessionId, mode }),
    sendInput: (sessionId: string, text: string): Promise<void> =>
      ipcRenderer.invoke('claude:send-input', sessionId, text),
    stopSession: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke('claude:stop-session', sessionId),
    listRunning: (): Promise<string[]> => ipcRenderer.invoke('claude:list-running'),
    onEvent: (sessionId: string, callback: (event: unknown) => void): (() => void) => {
      const channel = `claude:event:${sessionId}`
      const handler = (_: IpcRendererEvent, event: unknown): void => callback(event)
      ipcRenderer.on(channel, handler)
      return (): void => {
        ipcRenderer.off(channel, handler)
      }
    }
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
