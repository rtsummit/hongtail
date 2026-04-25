import { ElectronAPI } from '@electron-toolkit/preload'

export interface ClaudeSessionMeta {
  id: string
  title: string
  startedAt: string
}

export interface ExposedApi {
  workspaces: {
    load: () => Promise<string[]>
    save: (paths: string[]) => Promise<void>
    pickDirectory: () => Promise<string | null>
  }
  claude: {
    listSessions: (cwd: string) => Promise<ClaudeSessionMeta[]>
    deleteSession: (cwd: string, sessionId: string) => Promise<void>
    startSession: (
      workspacePath: string,
      sessionId: string | null,
      mode: 'new' | 'resume'
    ) => Promise<{ sessionId: string; alreadyRunning: boolean }>
    sendInput: (sessionId: string, text: string) => Promise<void>
    stopSession: (sessionId: string) => Promise<void>
    listRunning: () => Promise<string[]>
    onEvent: (sessionId: string, callback: (event: unknown) => void) => () => void
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: ExposedApi
  }
}
