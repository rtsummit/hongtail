import { ElectronAPI } from '@electron-toolkit/preload'

export interface ClaudeSessionMeta {
  id: string
  title: string
  startedAt: string
  // 마지막 활동 시점 (jsonl mtime, ms). 날짜 필터에 활용.
  lastActivityMs: number
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

export interface WebSettings {
  enabled: boolean
  port: number
  tlsCertPath: string | null
  tlsKeyPath: string | null
}

export interface PtySpawnArgs {
  sessionId: string
  workspacePath: string
  cols: number
  rows: number
  command?: string
  delayMs?: number
  // 'terminal' | 'interactive' — main 이 list-active 응답에 그대로 돌려준다.
  // 새로고침 후 클라이언트가 backend 를 정확히 복원하기 위함.
  backend?: 'terminal' | 'interactive'
}

// 새로고침 reconcile 용. main 이 보유한 살아있는 세션 한 건의 메타.
export interface ActiveSessionInfo {
  sessionId: string
  workspacePath: string
  backend: 'app' | 'terminal' | 'interactive'
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
    // 새로고침 후 reconcile 용. main 의 'app' 백엔드 살아있는 세션 + workspacePath.
    listActive: () => Promise<ActiveSessionInfo[]>
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
    // alreadyRunning 이면 main 의 ring buffer 가 replay 로 함께 반환된다 —
    // 새로고침 후 동일 sessionId 로 spawn 호출 시 xterm 버퍼 복원용. 호출한
    // 클라이언트만 받음 (broadcast 안 함, 다른 클라이언트 중복 출력 회피).
    spawn: (args: PtySpawnArgs) => Promise<{ alreadyRunning: boolean; replay?: string }>
    write: (sessionId: string, data: string) => Promise<void>
    resize: (sessionId: string, cols: number, rows: number) => Promise<void>
    kill: (sessionId: string) => Promise<void>
    // 새로고침 reconcile 용. PTY 기반 ('terminal'/'interactive') 살아있는 세션.
    // backend 는 spawn 시 받은 hint 그대로 (없으면 'terminal' 가정).
    listActive: () => Promise<ActiveSessionInfo[]>
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
  web: {
    getSettings: () => Promise<WebSettings>
    setSettings: (next: Partial<WebSettings>) => Promise<WebSettings>
    pickTlsFile: () => Promise<string | null>
    hasPassword: () => Promise<boolean>
    setPassword: (newPassword: string) => Promise<{ ok: true }>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: ExposedApi
  }
}
