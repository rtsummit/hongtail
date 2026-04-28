// 브라우저 (= Electron preload 가 없는 환경) 에서 동작할 때 window.api 와
// window.electron 의 자리를 채우는 shim. main 측 web 서버 (src/main/web.ts) 의
//   POST /rpc        — 일반 invoke
//   GET  /events?topic=<...>  — SSE push
// 두 채널 위에서 ExposedApi 와 같은 shape 을 만든다.
//
// preload 가 이미 window.api 를 채워둔 Electron 환경에서는 install 단계가
// 그냥 no-op. main entry 가 import 후 installWebApi() 만 호출하면 된다.
import type { ExposedApi } from '../../preload/index.d'

const ORIGIN = typeof location !== 'undefined' ? location.origin : ''

interface RpcResponse<T> {
  result?: T
  error?: string
}

async function rpc<T = unknown>(method: string, args: unknown[]): Promise<T> {
  const res = await fetch(`${ORIGIN}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args })
  })
  let body: RpcResponse<T> | null = null
  try {
    body = (await res.json()) as RpcResponse<T>
  } catch {
    /* fall through */
  }
  if (!res.ok || body?.error) {
    throw new Error(body?.error ?? `rpc ${method} failed: ${res.status}`)
  }
  return (body?.result ?? null) as T
}

function subscribe(topic: string, callback: (event: unknown) => void): () => void {
  const url = new URL(`${ORIGIN}/events`)
  url.searchParams.set('topic', topic)
  let es: EventSource | null = new EventSource(url.toString())
  es.addEventListener('message', (ev) => {
    try {
      const data = JSON.parse((ev as MessageEvent<string>).data)
      callback(data)
    } catch (err) {
      console.error('[web-shim] event parse failed:', err)
    }
  })
  return () => {
    es?.close()
    es = null
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  // Chunked to avoid stack overflow on large payloads
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk))
    )
  }
  return btoa(binary)
}

export const webApi: ExposedApi = {
  workspaces: {
    load: () => rpc('workspaces:load', []),
    save: (entries) => rpc('workspaces:save', [entries]),
    // 웹에서는 OS 디렉토리 다이얼로그가 없다. UI 가 텍스트 입력으로 fallback
    // 해야 한다 (별도 작업).
    pickDirectory: () => Promise.resolve(null)
  },
  claude: {
    listSessions: (cwd) => rpc('claude:list-sessions', [cwd]),
    deleteSession: (cwd, sid) => rpc('claude:delete-session', [cwd, sid]),
    readSession: (cwd, sid) => rpc('claude:read-session', [cwd, sid]),
    readSessionFrom: (cwd, sid, off) =>
      rpc('claude:read-session-from', [cwd, sid, off]),
    readSessionTail: (cwd, sid, n) =>
      rpc('claude:read-session-tail', [cwd, sid, n]),
    readSessionRange: (cwd, sid, s, e) =>
      rpc('claude:read-session-range', [cwd, sid, s, e]),
    startSession: (workspacePath, sessionId, mode) =>
      rpc('claude:start-session', [{ workspacePath, sessionId, mode }]),
    sendInput: (sid, text) => rpc('claude:send-input', [sid, text]),
    controlRequest: (sid, req) => rpc('claude:control-request', [sid, req]),
    stopSession: (sid) => rpc('claude:stop-session', [sid]),
    listRunning: () => rpc('claude:list-running', []),
    onEvent: (sid, cb) => subscribe(`claude:event:${sid}`, cb),
    watchSession: (cwd, sid) => rpc('claude:watch-session', [cwd, sid]),
    unwatchSession: (sid) => rpc('claude:unwatch-session', [sid]),
    onSessionChanged: (sid, cb) =>
      subscribe(`claude:session-changed:${sid}`, () => cb())
  },
  fonts: {
    list: () => rpc('fonts:list', [])
  },
  slashCommands: {
    list: (workspacePath) => rpc('slash-commands:list', [workspacePath])
  },
  usage: {
    get: () => rpc('usage:get', [])
  },
  images: {
    save: (sid, bytes, mimeType) =>
      rpc('images:save', [sid, bytesToBase64(bytes), mimeType])
  },
  sessionAliases: {
    list: () => rpc('session-aliases:list', []),
    set: (sid, alias) => rpc('session-aliases:set', [sid, alias]),
    sync: (cwd, sid) => rpc('session-aliases:sync', [cwd, sid])
  },
  web: {
    getSettings: () => rpc('web:settings:get', []),
    setSettings: (next) => rpc('web:settings:set', [next]),
    // 웹에서는 OS 다이얼로그 X — 텍스트 입력 prompt 로 fallback.
    pickTlsFile: () => Promise.resolve(window.prompt('TLS 파일 경로 (호스트 PC 기준 절대 경로)') || null)
  },
  sessions: {
    listActive: () => rpc('sessions:list-active', []),
    onStarted: (cb) =>
      subscribe('session:started', (e) => cb(e as never)),
    onEnded: (cb) =>
      subscribe('session:ended', (e) => {
        const sid = (e as { sessionId?: string })?.sessionId
        if (sid) cb(sid)
      })
  },
  pty: {
    spawn: (args) => rpc('pty:spawn', [args]),
    write: (sid, data) => rpc('pty:write', [sid, data]),
    resize: (sid, cols, rows) => rpc('pty:resize', [sid, cols, rows]),
    kill: (sid) => rpc('pty:kill', [sid]),
    onEvent: (sid, cb) => subscribe(`pty:event:${sid}`, cb)
  },
  btw: {
    ask: (args) => rpc('btw:ask', [args]),
    cancel: (ownerId) => rpc('btw:cancel', [ownerId]),
    onEvent: (ownerId, cb) => subscribe(`btw:event:${ownerId}`, cb)
  }
}

export function installWebApi(): void {
  if (typeof window === 'undefined') return
  const w = window as unknown as { api?: ExposedApi; electron?: unknown }
  if (w.api) return // Electron preload 가 이미 채움 — no-op
  w.api = webApi
  // electron-toolkit/preload 의 window.electron 자리 — 웹에서는 사용 X.
  // 빈 객체로 두어 typeof 체크 등에서 에러 안 나게.
  w.electron = {}
}
