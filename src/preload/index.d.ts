import { ElectronAPI } from '@electron-toolkit/preload'

export interface ClaudeSessionMeta {
  id: string
  title: string
  startedAt: string
}

export interface WorkspaceEntry {
  path: string
  alias?: string
}

export interface SlashCommand {
  name: string
  description: string
  source: 'builtin' | 'user' | 'project' | 'plugin'
  origin?: string
}

export interface SessionAlias {
  alias: string
  setAt: string
}

export interface UsageData {
  planName: string | null
  fiveHour: number | null
  sevenDay: number | null
  fiveHourResetAt: number | null
  sevenDayResetAt: number | null
  cachedAt: number
  stale: boolean
  apiError?: string
}

export interface PtySpawnArgs {
  sessionId: string
  workspacePath: string
  cols: number
  rows: number
  command?: string
  delayMs?: number
}

export interface ExposedApi {
  workspaces: {
    load: () => Promise<WorkspaceEntry[]>
    save: (entries: WorkspaceEntry[]) => Promise<void>
    pickDirectory: () => Promise<string | null>
  }
  claude: {
    listSessions: (cwd: string) => Promise<ClaudeSessionMeta[]>
    deleteSession: (cwd: string, sessionId: string) => Promise<void>
    readSession: (cwd: string, sessionId: string) => Promise<unknown[]>
    readSessionFrom: (
      cwd: string,
      sessionId: string,
      fromOffset: number
    ) => Promise<{ events: unknown[]; newOffset: number; truncated: boolean }>
    readSessionTail: (
      cwd: string,
      sessionId: string,
      tailLines: number
    ) => Promise<{
      events: unknown[]
      newOffset: number
      totalLines: number
      skippedLines: number
    }>
    readSessionRange: (
      cwd: string,
      sessionId: string,
      startLine: number,
      endLine: number
    ) => Promise<{ events: unknown[] }>
    startSession: (
      workspacePath: string,
      sessionId: string | null,
      mode: 'new' | 'resume'
    ) => Promise<{ sessionId: string; alreadyRunning: boolean }>
    sendInput: (sessionId: string, text: string) => Promise<void>
    controlRequest: (sessionId: string, request: Record<string, unknown>) => Promise<string>
    stopSession: (sessionId: string) => Promise<void>
    listRunning: () => Promise<string[]>
    onEvent: (sessionId: string, callback: (event: unknown) => void) => () => void
    watchSession: (cwd: string, sessionId: string) => Promise<void>
    unwatchSession: (sessionId: string) => Promise<void>
    onSessionChanged: (sessionId: string, callback: () => void) => () => void
  }
  fonts: {
    list: () => Promise<string[]>
  }
  slashCommands: {
    list: (workspacePath?: string) => Promise<SlashCommand[]>
  }
  usage: {
    get: () => Promise<UsageData | null>
  }
  images: {
    save: (sessionId: string, bytes: Uint8Array, mimeType: string) => Promise<string>
  }
  sessionAliases: {
    list: () => Promise<Record<string, SessionAlias>>
    set: (sessionId: string, alias: string) => Promise<SessionAlias | null>
    sync: (cwd: string, sessionId: string) => Promise<SessionAlias | null>
  }
  pty: {
    spawn: (args: PtySpawnArgs) => Promise<{ alreadyRunning: boolean }>
    write: (sessionId: string, data: string) => Promise<void>
    resize: (sessionId: string, cols: number, rows: number) => Promise<void>
    kill: (sessionId: string) => Promise<void>
    onEvent: (sessionId: string, callback: (event: unknown) => void) => () => void
  }
  btw: {
    ask: (args: {
      ownerId: string
      workspacePath: string
      systemPrompt: string
      question: string
    }) => Promise<void>
    cancel: (ownerId: string) => Promise<void>
    onEvent: (ownerId: string, callback: (event: unknown) => void) => () => void
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: ExposedApi
  }
}
