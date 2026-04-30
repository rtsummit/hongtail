import 'electron-log/preload' // hooks renderer console.* into the file log
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { WorkspaceEntry } from './index.d'

const api = {
  workspaces: {
    load: (): Promise<WorkspaceEntry[]> => ipcRenderer.invoke('workspaces:load'),
    save: (entries: WorkspaceEntry[]): Promise<void> =>
      ipcRenderer.invoke('workspaces:save', entries),
    pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('workspaces:pick-directory')
  },
  claude: {
    listSessions: (cwd: string) => ipcRenderer.invoke('claude:list-sessions', cwd),
    deleteSession: (cwd: string, sessionId: string): Promise<void> =>
      ipcRenderer.invoke('claude:delete-session', cwd, sessionId),
    readSession: (cwd: string, sessionId: string): Promise<unknown[]> =>
      ipcRenderer.invoke('claude:read-session', cwd, sessionId),
    readSessionFrom: (
      cwd: string,
      sessionId: string,
      fromOffset: number
    ): Promise<{ events: unknown[]; newOffset: number; truncated: boolean }> =>
      ipcRenderer.invoke('claude:read-session-from', cwd, sessionId, fromOffset),
    readSessionTail: (
      cwd: string,
      sessionId: string,
      tailLines: number
    ): Promise<{
      events: unknown[]
      newOffset: number
      totalLines: number
      skippedLines: number
    }> => ipcRenderer.invoke('claude:read-session-tail', cwd, sessionId, tailLines),
    readSessionRange: (
      cwd: string,
      sessionId: string,
      startLine: number,
      endLine: number
    ): Promise<{ events: unknown[] }> =>
      ipcRenderer.invoke('claude:read-session-range', cwd, sessionId, startLine, endLine),
    startSession: (
      workspacePath: string,
      sessionId: string | null,
      mode: 'new' | 'resume'
    ): Promise<{ sessionId: string; alreadyRunning: boolean }> =>
      ipcRenderer.invoke('claude:start-session', { workspacePath, sessionId, mode }),
    sendInput: (sessionId: string, text: string): Promise<void> =>
      ipcRenderer.invoke('claude:send-input', sessionId, text),
    controlRequest: (sessionId: string, request: Record<string, unknown>): Promise<string> =>
      ipcRenderer.invoke('claude:control-request', sessionId, request),
    respondControl: (sessionId: string, payload: Record<string, unknown>): Promise<void> =>
      ipcRenderer.invoke('claude:respond-control', sessionId, payload),
    onControlRequest: (
      sessionId: string,
      callback: (event: Record<string, unknown>) => void
    ): (() => void) => {
      const channel = `claude:control-request:${sessionId}`
      const handler = (_: IpcRendererEvent, event: Record<string, unknown>): void =>
        callback(event)
      ipcRenderer.on(channel, handler)
      return (): void => {
        ipcRenderer.off(channel, handler)
      }
    },
    stopSession: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke('claude:stop-session', sessionId),
    listRunning: (): Promise<string[]> => ipcRenderer.invoke('claude:list-running'),
    listActive: () => ipcRenderer.invoke('claude:list-active'),
    onEvent: (sessionId: string, callback: (event: unknown) => void): (() => void) => {
      const channel = `claude:event:${sessionId}`
      const handler = (_: IpcRendererEvent, event: unknown): void => callback(event)
      ipcRenderer.on(channel, handler)
      return (): void => {
        ipcRenderer.off(channel, handler)
      }
    },
    watchSession: (cwd: string, sessionId: string): Promise<void> =>
      ipcRenderer.invoke('claude:watch-session', cwd, sessionId),
    unwatchSession: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke('claude:unwatch-session', sessionId),
    onSessionChanged: (sessionId: string, callback: () => void): (() => void) => {
      const channel = `claude:session-changed:${sessionId}`
      const handler = (): void => callback()
      ipcRenderer.on(channel, handler)
      return (): void => {
        ipcRenderer.off(channel, handler)
      }
    }
  },
  fonts: {
    list: (): Promise<string[]> => ipcRenderer.invoke('fonts:list')
  },
  slashCommands: {
    list: (workspacePath?: string) =>
      ipcRenderer.invoke('slash-commands:list', workspacePath)
  },
  usage: {
    get: () => ipcRenderer.invoke('usage:get')
  },
  images: {
    save: (sessionId: string, bytes: Uint8Array, mimeType: string): Promise<string> =>
      ipcRenderer.invoke('images:save', sessionId, bytes, mimeType)
  },
  sessionAliases: {
    list: () => ipcRenderer.invoke('session-aliases:list'),
    set: (sessionId: string, alias: string) =>
      ipcRenderer.invoke('session-aliases:set', sessionId, alias),
    sync: (cwd: string, sessionId: string) =>
      ipcRenderer.invoke('session-aliases:sync', cwd, sessionId)
  },
  btw: {
    ask: (args: {
      ownerId: string
      workspacePath: string
      systemPrompt: string
      question: string
    }): Promise<void> => ipcRenderer.invoke('btw:ask', args),
    cancel: (ownerId: string): Promise<void> => ipcRenderer.invoke('btw:cancel', ownerId),
    onEvent: (ownerId: string, callback: (event: unknown) => void): (() => void) => {
      const channel = `btw:event:${ownerId}`
      const handler = (_: IpcRendererEvent, event: unknown): void => callback(event)
      ipcRenderer.on(channel, handler)
      return (): void => {
        ipcRenderer.off(channel, handler)
      }
    }
  },
  web: {
    getSettings: () => ipcRenderer.invoke('web:settings:get'),
    setSettings: (next: Record<string, unknown>) =>
      ipcRenderer.invoke('web:settings:set', next),
    pickTlsFile: (): Promise<string | null> => ipcRenderer.invoke('web:pick-tls-file'),
    hasPassword: (): Promise<boolean> => ipcRenderer.invoke('web:has-password'),
    setPassword: (newPassword: string) => ipcRenderer.invoke('web:set-password', newPassword)
  },
  dev: {
    available: (): Promise<boolean> => ipcRenderer.invoke('dev:available'),
    restart: (): Promise<{ ok: true }> => ipcRenderer.invoke('dev:restart')
  },
  pty: {
    spawn: (args: {
      sessionId: string
      workspacePath: string
      cols: number
      rows: number
      command?: string
      delayMs?: number
    }): Promise<{ alreadyRunning: boolean; replay?: string }> =>
      ipcRenderer.invoke('pty:spawn', args),
    write: (sessionId: string, data: string): Promise<void> =>
      ipcRenderer.invoke('pty:write', sessionId, data),
    resize: (sessionId: string, cols: number, rows: number): Promise<void> =>
      ipcRenderer.invoke('pty:resize', sessionId, cols, rows),
    kill: (sessionId: string): Promise<void> => ipcRenderer.invoke('pty:kill', sessionId),
    listActive: () => ipcRenderer.invoke('pty:list-active'),
    onEvent: (sessionId: string, callback: (event: unknown) => void): (() => void) => {
      const channel = `pty:event:${sessionId}`
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
