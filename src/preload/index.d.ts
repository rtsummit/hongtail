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
  // 'command' = .claude/commands/*.md / 'skill' = .claude/skills/<name>/SKILL.md.
  // 둘 다 / 픽커에 같이 뜨고, 입력은 그냥 텍스트로 forward — Claude CLI 가
  // 스킬은 모델이 Skill tool 로 호출하게 처리한다.
  kind: 'command' | 'skill'
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
}

// 새로고침 reconcile 용. main 이 보유한 살아있는 세션 한 건의 메타.
export interface ActiveSessionInfo {
  sessionId: string
  workspacePath: string
  backend: 'app' | 'terminal'
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
      mode: 'new' | 'resume',
      permissionMode?: string
    ) => Promise<{ sessionId: string; alreadyRunning: boolean }>
    sendInput: (sessionId: string, text: string) => Promise<void>
    controlRequest: (sessionId: string, request: Record<string, unknown>) => Promise<string>
    // 자식이 stdout 으로 보낸 incoming control_request (subtype:'can_use_tool')
    // 에 호스트가 답신. payload 는 wire format 그대로
    // ({ type:'control_response', response:{ subtype, request_id, response:{ behavior, ... } } }).
    // 자세히는 docs/host-confirm-ui-plan.md §11.3.
    respondControl: (sessionId: string, payload: Record<string, unknown>) => Promise<void>
    // 자식 → 호스트 control_request 구독. 일반 event 채널과 분리됨.
    onControlRequest: (
      sessionId: string,
      callback: (event: Record<string, unknown>) => void
    ) => () => void
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
  files: {
    save: (sessionId: string, bytes: Uint8Array, fileName: string) => Promise<string>
    openExternal: (path: string) => Promise<void>
    // 폴더 열기. command 가 비면 OS default (탐색기). 있으면 %1 자리에 path
    // 가 quote 되어 치환된 후 shell 로 실행. AppSettings.folderOpenCommand 값
    // 을 그대로 전달한다 (예: 'explorer %1', '"C:\\totalcmd\\TOTALCMD64.EXE" /O /T %1').
    openFolder: (path: string, command?: string) => Promise<void>
    read: (path: string) => Promise<string>
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
    // 새로고침 reconcile 용. PTY 기반 살아있는 세션 — backend 는 항상 'terminal'.
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
  // available() 는 항상 등록 — 호스트가 dev 모드인지 runtime 으로 확인. web
  // 사용자는 production 빌드 번들을 받기 때문에 import.meta.env.DEV 로는 호스트
  // 상태를 모른다. restart() 는 호스트가 dev 일 때만 등록되며 production 에서
  // 호출하면 'No handler' 에러로 reject.
  dev: {
    available: () => Promise<boolean>
    restart: () => Promise<{ ok: true }>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: ExposedApi
  }
}
