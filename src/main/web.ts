// Web 모드 — HONGLUADE_WEB=1 일 때만 활성. Electron 의 BrowserWindow 와는
// 별개로 HTTP 서버를 띄워 외부 브라우저(=모바일 / 다른 PC)에서 hongluade UI
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

// 단일 사용자 계정. username 은 hardcoded — 그 외 username 으로 들어오면 거부.
const ALLOWED_USERNAME = 'rtsummit'
// 초기 비밀번호. credentials 파일이 없을 때만 사용된다 (mustChangePassword=true).
const INITIAL_PASSWORD = 'abutton'

const COOKIE_NAME = 'hongluade_s'
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 // 24h 절대 만료
const SESSION_IDLE_MS = 30 * 60 * 1000 // 30분 idle 만료

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

function hashPassword(password: string, salt: string): string {
  return sha256Hex(`${salt}::${password}`)
}

interface Credentials {
  username: string
  salt: string
  passwordHash: string
  mustChangePassword: boolean
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
      typeof parsed.username === 'string' &&
      typeof parsed.salt === 'string' &&
      typeof parsed.passwordHash === 'string'
    ) {
      return {
        username: parsed.username,
        salt: parsed.salt,
        passwordHash: parsed.passwordHash,
        mustChangePassword: !!parsed.mustChangePassword
      }
    }
  } catch {
    /* 파일 없거나 깨짐 — default 로 초기화 */
  }
  // default — 첫 시작.
  const salt = randomBytes(16).toString('hex')
  const cred: Credentials = {
    username: ALLOWED_USERNAME,
    salt,
    passwordHash: hashPassword(INITIAL_PASSWORD, salt),
    mustChangePassword: true
  }
  saveCredentialsSync(cred)
  return cred
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
type EventSubscribe = (emit: EventEmit) => () => void
const eventSources = new Map<string, EventSubscribe>()

// topic 에 대한 구독자 함수 — emit 콜백을 받아 unsubscribe 함수를 돌려준다.
// 한 topic 에 한 subscribe 만. 다중 클라이언트 지원이 필요하면 여기서 fan-out.
export function registerEventSource(topic: string, subscribe: EventSubscribe): void {
  eventSources.set(topic, subscribe)
}

// 동적 topic 용 fan-out 버스. emitSse(topic, event) 가 호출되면 그 topic 을
// SSE 로 구독하고 있는 모든 클라이언트에 forward. 처음 emit 시 lazy 등록.
//
// 첫 subscriber 가 EventSource connection 을 여는 데 한두 RTT 필요한데,
// 그 사이에 emit 된 이벤트가 손실되면 클라이언트가 첫 신호를 놓쳐 hang
// (예: PTY spawn 직후 첫 data 가 spinner 를 풀어주는데 그게 누락).
// 해결: subscriber 가 0 일 때 emit 은 ring buffer 에 쌓아두고, 첫 subscriber
// 가 붙는 순간 flush. 한 topic 당 BUFFER_LIMIT 까지만 보존.
const sseBus = new Map<string, Set<EventEmit>>()
const sseBuffer = new Map<string, unknown[]>()
const SSE_BUFFER_LIMIT = 1000

export function emitSse(topic: string, event: unknown): void {
  let set = sseBus.get(topic)
  if (!set) {
    set = new Set()
    sseBus.set(topic, set)
    registerEventSource(topic, (emit) => {
      // 첫 connection 시 buffered 부터 flush.
      const buffered = sseBuffer.get(topic)
      if (buffered) {
        for (const e of buffered) emit(e)
        sseBuffer.delete(topic)
      }
      set!.add(emit)
      return () => set!.delete(emit)
    })
  }
  if (set.size > 0) {
    for (const emit of set) emit(event)
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
  const subscribe = eventSources.get(topic)
  if (!subscribe) {
    res.statusCode = 404
    res.end(`unknown topic: ${topic}`)
    return
  }
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()
  res.write(': ok\n\n')
  const emit: EventEmit = (event) => {
    if (res.writableEnded) return
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }
  const unsubscribe = subscribe(emit)
  req.on('close', () => {
    try {
      unsubscribe()
    } catch (err) {
      console.error('[web] unsubscribe failed:', err)
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
<html lang="ko"><head><meta charset="utf-8"><title>hongluade · 로그인</title>
<meta name="viewport" content="width=device-width, initial-scale=1">${FORM_STYLE}</head><body>
<form method="POST" action="/login">
  <h1>hongluade</h1>
  <input type="text" name="username" placeholder="사용자명" autofocus required autocomplete="username">
  <input type="password" name="password" placeholder="비밀번호" required autocomplete="current-password">
  <button type="submit">로그인</button>
  <div class="err">__ERR__</div>
</form>
</body></html>`

const CHANGE_PASSWORD_HTML = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>hongluade · 비밀번호 변경</title>
<meta name="viewport" content="width=device-width, initial-scale=1">${FORM_STYLE}</head><body>
<form method="POST" action="/change-password">
  <h1>비밀번호 변경</h1>
  <div class="note">__NOTE__초기 비밀번호를 사용 중입니다. 새 비밀번호로 변경하세요.</div>
  <input type="password" name="newPassword" placeholder="새 비밀번호 (8자 이상)" autofocus required minlength="8" autocomplete="new-password">
  <input type="password" name="confirmPassword" placeholder="새 비밀번호 확인" required minlength="8" autocomplete="new-password">
  <button type="submit">변경</button>
  <div class="err">__ERR__</div>
</form>
</body></html>`

function serveLoginPage(res: ServerResponse, error: string = ''): void {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(LOGIN_HTML.replace('__ERR__', error))
}

function serveChangePasswordPage(res: ServerResponse, error: string = '', note: string = ''): void {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(
    CHANGE_PASSWORD_HTML.replace('__ERR__', error).replace('__NOTE__', note)
  )
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
  const username = (form.get('username') ?? '').trim()
  const password = form.get('password') ?? ''
  if (
    username !== credentials.username ||
    hashPassword(password, credentials.salt) !== credentials.passwordHash
  ) {
    serveLoginPage(res, '사용자명 또는 비밀번호가 틀렸습니다')
    return
  }
  const session = issueSession()
  setSessionCookie(res, session)
  res.statusCode = 302
  // 첫 로그인 (초기 비밀번호 사용 중) 이면 변경 페이지로 강제 redirect.
  res.setHeader('Location', credentials.mustChangePassword ? '/change-password' : '/')
  res.end()
}

async function handleChangePasswordPost(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const form = await readForm(req)
  const next = form.get('newPassword') ?? ''
  const confirm = form.get('confirmPassword') ?? ''
  if (next.length < 8) {
    serveChangePasswordPage(res, '비밀번호는 8자 이상이어야 합니다')
    return
  }
  if (next !== confirm) {
    serveChangePasswordPage(res, '두 비밀번호가 일치하지 않습니다')
    return
  }
  if (next === INITIAL_PASSWORD) {
    serveChangePasswordPage(res, '초기 비밀번호와 다른 값을 사용하세요')
    return
  }
  const salt = randomBytes(16).toString('hex')
  credentials = {
    username: credentials.username,
    salt,
    passwordHash: hashPassword(next, salt),
    mustChangePassword: false
  }
  saveCredentialsSync(credentials)
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

    // 인증된 상태이지만 비밀번호 변경이 필요한 경우 — 정적 GET 은 변경 페이지로
    // 강제, RPC/SSE 는 403 (UI 가 강제 페이지로 가서 RPC 호출이 무의미).
    if (credentials.mustChangePassword) {
      if (req.method === 'GET' && url.pathname === '/change-password') {
        serveChangePasswordPage(res)
        return
      }
      if (req.method === 'POST' && url.pathname === '/change-password') {
        await handleChangePasswordPost(req, res)
        return
      }
      if (req.method === 'GET' && url.pathname !== '/rpc' && url.pathname !== '/events') {
        res.statusCode = 302
        res.setHeader('Location', '/change-password')
        res.end()
        return
      }
      res.statusCode = 403
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'must change password first' }))
      return
    }
    // 변경 강제가 끝난 뒤에도 사용자가 명시적으로 변경하고 싶을 수 있다.
    if (req.method === 'GET' && url.pathname === '/change-password') {
      serveChangePasswordPage(res)
      return
    }
    if (req.method === 'POST' && url.pathname === '/change-password') {
      await handleChangePasswordPost(req, res)
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
    console.log(`[web] login: ${credentials.username}`)
    if (credentials.mustChangePassword) {
      console.log(`[web] initial password: ${INITIAL_PASSWORD} — 첫 로그인 후 변경 강제`)
    }
  })
}

export function stopWebServer(): void {
  server?.close()
  server = null
}
