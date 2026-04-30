// Web 모드 — HONGTAIL_WEB=1 일 때만 활성. Electron 의 BrowserWindow 와는
// 별개로 HTTP 서버를 띄워 외부 브라우저(=모바일 / 다른 PC)에서 hongtail UI
// 를 로드할 수 있게 한다.
//
// 통신 채널:
//   - 요청-응답: POST /rpc  body={method, args} → registerRpc 로 등록된 핸들러
//   - 푸시 이벤트: GET  /events?topic=<topic>  → SSE, registerEventSource 로
//     등록된 subscribe 함수가 emit 하는 이벤트를 그대로 forward
//   - 정적 자산:  GET  /...  → out/renderer 의 빌드 결과
//
// 등록은 시작 후 어느 시점에든 가능하며, 핸들러가 없는 method 호출은 404.
// PoC 단계에서는 127.0.0.1 만 binding (LAN 노출은 인증 추가 후 별도 commit).
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from 'http'
import { createServer as createHttpsServer } from 'https'
import { promises as fs, readFileSync, writeFileSync } from 'fs'
import { join, normalize, resolve as resolvePath } from 'path'
import { randomBytes, createHash } from 'crypto'
import { app } from 'electron'
import { WEB_HOST, type WebSettings } from './webSettings'

// 비밀번호 단독 인증. credentials 는 GUI 의 웹 설정에서 user 가 직접 set.
// 미설정 상태에서는 로그인 자체 거부. 사용자명은 없음.
const COOKIE_NAME = 'hongtail_s'
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 // 24h 절대 만료
const SESSION_IDLE_MS = 30 * 60 * 1000 // 30분 idle 만료

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

function hashPassword(password: string, salt: string): string {
  return sha256Hex(`${salt}::${password}`)
}

interface Credentials {
  salt: string | null
  passwordHash: string | null
}

function credentialsFile(): string {
  return join(app.getPath('userData'), 'web-credentials.json')
}

function loadCredentialsSync(): Credentials {
  const file = credentialsFile()
  try {
    const raw = readFileSync(file, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<Credentials>
    if (
      typeof parsed.salt === 'string' &&
      typeof parsed.passwordHash === 'string'
    ) {
      return { salt: parsed.salt, passwordHash: parsed.passwordHash }
    }
  } catch {
    /* 파일 없거나 깨짐 — 미설정 상태로 시작 */
  }
  return { salt: null, passwordHash: null }
}

function saveCredentialsSync(cred: Credentials): void {
  const file = credentialsFile()
  try {
    writeFileSync(file, JSON.stringify(cred, null, 2), 'utf-8')
  } catch (err) {
    console.error('[web] credentials save failed:', err)
  }
}

let credentials = loadCredentialsSync()

export function isPasswordSet(): boolean {
  return !!(credentials.salt && credentials.passwordHash)
}

export function setPassword(newPassword: string): void {
  const salt = randomBytes(16).toString('hex')
  credentials = { salt, passwordHash: hashPassword(newPassword, salt) }
  saveCredentialsSync(credentials)
  // 비밀번호 변경 시 모든 기존 세션 무효화.
  sessions.clear()
}

interface Session {
  token: string
  issuedAt: number
  expiresAt: number
  lastSeen: number
}
// server-side 세션 저장소. cookie 의 token 으로 lookup.
const sessions = new Map<string, Session>()

function issueSession(): Session {
  const token = randomBytes(32).toString('hex')
  const now = Date.now()
  const session: Session = {
    token,
    issuedAt: now,
    expiresAt: now + SESSION_MAX_AGE_SEC * 1000,
    lastSeen: now
  }
  sessions.set(token, session)
  return session
}

// 세션 lookup + touch. 절대 만료 또는 idle 만료 시 무효화.
// 통과 시 lastSeen 갱신해 다음 idle 윈도우 reset.
function lookupAndTouch(token: string | null): Session | null {
  if (!token) return null
  const s = sessions.get(token)
  if (!s) return null
  const now = Date.now()
  if (now >= s.expiresAt || now - s.lastSeen > SESSION_IDLE_MS) {
    sessions.delete(token)
    return null
  }
  s.lastSeen = now
  return s
}

// 주기적 GC — 만료된 세션을 메모리에서 청소. 1시간마다.
setInterval(() => {
  const now = Date.now()
  for (const [token, s] of sessions) {
    if (now >= s.expiresAt || now - s.lastSeen > SESSION_IDLE_MS) {
      sessions.delete(token)
    }
  }
}, 60 * 60 * 1000).unref?.()

let server: Server | null = null

type RpcHandler = (args: unknown[]) => Promise<unknown> | unknown
const rpcHandlers = new Map<string, RpcHandler>()

export function registerRpc(method: string, handler: RpcHandler): void {
  rpcHandlers.set(method, handler)
}

type EventEmit = (event: unknown) => void

// 동적 topic 용 fan-out 버스. emitSse(topic, event) 와 SSE handler 의 subscribe
// 양쪽이 같은 sseBus 에 lazy 추가. 어느 쪽이 먼저 들어오든 상관 없음.
//
// 첫 subscriber 가 EventSource connection 을 여는 데 한두 RTT 필요한데, 그
// 사이에 emit 된 이벤트가 손실되면 클라이언트가 첫 신호를 놓쳐 hang (예:
// PTY spawn 직후 첫 data 가 spinner 를 풀어주는데 그게 누락).
// 해결: subscriber 가 0 일 때 emit 은 ring buffer 에 쌓아두고, 첫 subscriber
// 가 붙는 순간 flush. 한 topic 당 BUFFER_LIMIT 까지만 보존.
const sseBus = new Map<string, Set<EventEmit>>()
const sseBuffer = new Map<string, unknown[]>()
const SSE_BUFFER_LIMIT = 1000

function busSet(topic: string): Set<EventEmit> {
  let set = sseBus.get(topic)
  if (!set) {
    set = new Set()
    sseBus.set(topic, set)
  }
  return set
}

export function emitSse(topic: string, event: unknown): void {
  const set = busSet(topic)
  if (set.size > 0) {
    // emit 이 throw (예: res.destroyed 직후 write → ERR_STREAM_DESTROYED, 또는
    // event 가 circular 라 JSON.stringify throw) 하면 그 stale emitter 를 set
    // 에서 제거하고 다음 emitter 로 계속. 보호 안 하면 한 client 의 socket 절단
    // 이 모든 후속 broadcast 를 stuck 시켜 전 세션 hang 을 유발 (관측 사례).
    for (const emit of set) {
      try {
        emit(event)
      } catch (err) {
        console.warn('[web] sse emit failed — dropping subscriber:', err)
        set.delete(emit)
      }
    }
    return
  }
  let buf = sseBuffer.get(topic)
  if (!buf) {
    buf = []
    sseBuffer.set(topic, buf)
  }
  buf.push(event)
  if (buf.length > SSE_BUFFER_LIMIT) buf.shift()
}

function attachSseEmitter(topic: string, emit: EventEmit): () => void {
  const set = busSet(topic)
  // 첫 connection 시 buffered 부터 flush. 한 이벤트가 throw 해도 나머지를
  // 계속 시도 — 첫 client 가 일부만 받더라도 페이지 자체는 살아있게.
  const buffered = sseBuffer.get(topic)
  if (buffered) {
    for (const e of buffered) {
      try {
        emit(e)
      } catch (err) {
        console.warn('[web] sse buffered flush failed:', err)
      }
    }
    sseBuffer.delete(topic)
  }
  set.add(emit)
  return () => set.delete(emit)
}

const STATIC_CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  mjs: 'application/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf'
}

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://x')
  let pathname = decodeURIComponent(url.pathname)
  if (pathname === '/') pathname = '/index.html'
  const cleaned = normalize(pathname).replace(/^[/\\]+/, '')
  const root = join(app.getAppPath(), 'out', 'renderer')
  const filePath = resolvePath(root, cleaned)
  if (!filePath.startsWith(resolvePath(root))) {
    res.statusCode = 400
    res.end('bad path')
    return
  }
  try {
    const data = await fs.readFile(filePath)
    const ext = (filePath.split('.').pop() ?? '').toLowerCase()
    res.setHeader('Content-Type', STATIC_CONTENT_TYPES[ext] ?? 'application/octet-stream')
    res.statusCode = 200
    res.end(data)
  } catch {
    res.statusCode = 404
    res.end('not found')
  }
}

async function readJson<T = unknown>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let buf = ''
    req.on('data', (chunk: Buffer | string) => {
      buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    })
    req.on('end', () => {
      if (!buf.trim()) return resolve({} as T)
      try {
        resolve(JSON.parse(buf) as T)
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

interface RpcBody {
  method?: string
  args?: unknown[]
}

async function handleRpc(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('Content-Type', 'application/json')
  let body: RpcBody
  try {
    body = await readJson<RpcBody>(req)
  } catch {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'bad json' }))
    return
  }
  const method = body.method
  if (!method) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'method required' }))
    return
  }
  const handler = rpcHandlers.get(method)
  if (!handler) {
    res.statusCode = 404
    res.end(JSON.stringify({ error: `unknown method: ${method}` }))
    return
  }
  try {
    const result = await handler(body.args ?? [])
    res.statusCode = 200
    res.end(JSON.stringify({ result: result ?? null }))
  } catch (err) {
    res.statusCode = 500
    res.end(JSON.stringify({ error: String(err) }))
  }
}

function handleEvents(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://x')
  const topic = url.searchParams.get('topic')
  if (!topic) {
    res.statusCode = 400
    res.end('topic required')
    return
  }
  // 모든 topic 은 동적. emit 측이 아직 한 번도 호출되지 않은 topic 도 OK —
  // 그냥 빈 set 에 emitter 추가해두고 나중에 emit 되면 forward.
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()
  res.write(': ok\n\n')
  const emit: EventEmit = (event) => {
    // socket 이 끝났거나 destroyed 면 write 가 throw 한다 (ERR_STREAM_DESTROYED).
    // 일반 backpressure 는 false 리턴이라 OK. 호출자 (emitSse) 의 try/catch 가
    // 예외 케이스에서 stale emitter 를 set 에서 제거할 수 있게 throw 는 그대로
    // propagate.
    if (res.writableEnded || res.destroyed) return
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }
  const detach = attachSseEmitter(topic, emit)
  req.on('close', () => {
    try {
      detach()
    } catch (err) {
      console.error('[web] detach failed:', err)
    }
  })
}

function readCookie(req: IncomingMessage, name: string): string | null {
  const header = req.headers.cookie
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const k = part.slice(0, eq).trim()
    if (k !== name) continue
    return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return null
}

// 인증 검증 — cookie 의 세션 토큰을 lookup + touch (idle 윈도우 reset).
// 통과 못 하면 false (호출자가 응답).
function checkAuth(req: IncomingMessage): boolean {
  return lookupAndTouch(readCookie(req, COOKIE_NAME)) !== null
}

// HTTPS 모드면 Secure 플래그를 켜서 cookie 가 평문 채널에 안 실리게.
let cookieSecure = false

function setSessionCookie(res: ServerResponse, session: Session): void {
  const secure = cookieSecure ? '; Secure' : ''
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(session.token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_AGE_SEC}${secure}`
  )
}

function clearSessionCookie(res: ServerResponse): void {
  const secure = cookieSecure ? '; Secure' : ''
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`
  )
}

const FORM_STYLE = `<style>
html,body{height:100%;margin:0;background:#1e1e1e;color:#d4d4d4;font-family:system-ui,-apple-system,Segoe UI,sans-serif}
body{display:flex;align-items:center;justify-content:center}
form{background:#2a2a2a;padding:24px;border-radius:8px;min-width:280px;box-shadow:0 4px 16px rgba(0,0,0,.4)}
h1{margin:0 0 16px;font-size:18px;font-weight:500}
input{width:100%;box-sizing:border-box;padding:10px;margin-top:8px;background:#1e1e1e;border:1px solid #444;border-radius:4px;color:#d4d4d4;font-size:14px}
input:focus{outline:none;border-color:#0a84ff}
input:first-of-type{margin-top:0}
button{width:100%;margin-top:12px;padding:10px;background:#0a84ff;border:none;border-radius:4px;color:#fff;font-size:14px;cursor:pointer}
button:hover{background:#0a74e0}
.err{margin-top:8px;color:#ff6b6b;font-size:13px;min-height:18px}
.note{margin-top:8px;color:#888;font-size:12px}
</style>`

const LOGIN_HTML = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>hongtail · 로그인</title>
<meta name="viewport" content="width=device-width, initial-scale=1">${FORM_STYLE}</head><body>
<form method="POST" action="/login">
  <h1>hongtail</h1>
  <input type="password" name="password" placeholder="비밀번호" autofocus required autocomplete="current-password">
  <button type="submit">로그인</button>
  <div class="err">__ERR__</div>
</form>
</body></html>`

const NOT_CONFIGURED_HTML = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>hongtail · 설정 필요</title>
<meta name="viewport" content="width=device-width, initial-scale=1">${FORM_STYLE}</head><body>
<form onsubmit="return false">
  <h1>설정 필요</h1>
  <div class="note">웹 모드 비밀번호가 설정되지 않았습니다. hongtail 데스크톱 앱의 설정 → 웹 모드 에서 비밀번호를 먼저 설정하세요.</div>
</form>
</body></html>`

function serveLoginPage(res: ServerResponse, error: string = ''): void {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  if (!isPasswordSet()) {
    res.end(NOT_CONFIGURED_HTML)
    return
  }
  res.end(LOGIN_HTML.replace('__ERR__', error))
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    let buf = ''
    req.on('data', (c: Buffer | string) => {
      buf += typeof c === 'string' ? c : c.toString('utf8')
    })
    req.on('end', () => resolve(new URLSearchParams(buf)))
    req.on('error', reject)
  })
}

async function handleLoginPost(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const form = await readForm(req)
  const password = form.get('password') ?? ''
  if (
    !credentials.salt ||
    !credentials.passwordHash ||
    hashPassword(password, credentials.salt) !== credentials.passwordHash
  ) {
    serveLoginPage(res, '비밀번호가 틀렸습니다')
    return
  }
  const session = issueSession()
  setSessionCookie(res, session)
  res.statusCode = 302
  res.setHeader('Location', '/')
  res.end()
}

function handleLogout(res: ServerResponse): void {
  clearSessionCookie(res)
  res.statusCode = 302
  res.setHeader('Location', '/login')
  res.end()
}

let activePort = 0

export function startWebServer(settings: WebSettings): void {
  // Idempotent — 이미 살아있으면 stop 후 재시작.
  if (server) stopWebServer()
  if (!settings.enabled) return
  activePort = settings.port
  let useHttps = false
  let tlsOptions: { cert: Buffer; key: Buffer } | null = null
  cookieSecure = false
  if (settings.tlsCertPath && settings.tlsKeyPath) {
    try {
      tlsOptions = {
        cert: readFileSync(settings.tlsCertPath),
        key: readFileSync(settings.tlsKeyPath)
      }
      useHttps = true
      cookieSecure = true
    } catch (err) {
      console.error(
        '[web] TLS cert/key read failed — falling back to HTTP:',
        err
      )
    }
  }

  const handler = async (
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }
    const url = new URL(req.url ?? '/', 'http://x')

    // 인증 불필요 라우트
    if (req.method === 'GET' && url.pathname === '/login') {
      serveLoginPage(res)
      return
    }
    if (req.method === 'POST' && url.pathname === '/login') {
      await handleLoginPost(req, res)
      return
    }
    if (req.method === 'GET' && url.pathname === '/logout') {
      handleLogout(res)
      return
    }

    // 그 외는 모두 세션 검증
    if (!checkAuth(req)) {
      // 정적 / 그 외 GET 은 로그인 페이지로 redirect, RPC/SSE 는 401 JSON
      if (req.method === 'GET' && url.pathname !== '/rpc' && url.pathname !== '/events') {
        res.statusCode = 302
        res.setHeader('Location', '/login')
        res.end()
        return
      }
      res.statusCode = 401
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'unauthorized' }))
      return
    }


    if (req.method === 'POST' && url.pathname === '/rpc') {
      await handleRpc(req, res)
      return
    }
    if (req.method === 'GET' && url.pathname === '/events') {
      handleEvents(req, res)
      return
    }
    if (req.method === 'GET') {
      await serveStatic(req, res)
      return
    }
    res.statusCode = 405
    res.end()
  }

  server = useHttps && tlsOptions
    ? createHttpsServer(tlsOptions, handler)
    : createHttpServer(handler)

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(
        `[web] port ${activePort} already in use — web server disabled`
      )
    } else {
      console.error('[web] server error:', err)
    }
    server = null
  })
  server.listen(activePort, WEB_HOST, () => {
    const scheme = useHttps ? 'https' : 'http'
    console.log(`[web] ${scheme}://${WEB_HOST}:${activePort}/login`)
    if (!isPasswordSet()) {
      console.log('[web] 비밀번호 미설정 — 설정 → 웹 모드 에서 먼저 set 해야 로그인 가능')
    }
  })
}

export function stopWebServer(): void {
  if (!server) return
  server.close()
  // close() 만으로는 살아있는 SSE long-poll 이 자연 종료까지 대기. 즉 GUI 에서
  // 끈 직후에도 기존 브라우저 탭이 그대로 보이는 문제. closeAllConnections 로
  // 모든 활성 connection 즉시 절단 (Node 18.2+).
  server.closeAllConnections?.()
  server = null
}
