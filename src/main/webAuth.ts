// Web 모드 인증. 비밀번호 단독 (사용자명 없음) — credentials 는 GUI 의 웹
// 설정 섹션에서 user 가 직접 set. 미설정 상태에서는 로그인 자체 거부.
//
// 세션 토큰은 cookie (HttpOnly, SameSite=Strict, HTTPS 면 Secure) 로 전달,
// server-side Map 에 저장. 절대 만료 24h + idle 30m. 비밀번호 변경 시 모든
// 기존 세션 무효화.
import type { IncomingMessage, ServerResponse } from 'http'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomBytes, createHash } from 'crypto'
import { app } from 'electron'

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
  try {
    const raw = readFileSync(credentialsFile(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<Credentials>
    if (typeof parsed.salt === 'string' && typeof parsed.passwordHash === 'string') {
      return { salt: parsed.salt, passwordHash: parsed.passwordHash }
    }
  } catch {
    /* 파일 없거나 깨짐 — 미설정 상태로 시작 */
  }
  return { salt: null, passwordHash: null }
}

function saveCredentialsSync(cred: Credentials): void {
  try {
    writeFileSync(credentialsFile(), JSON.stringify(cred, null, 2), 'utf-8')
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

// HTTPS 모드면 Secure 플래그를 켜서 cookie 가 평문 채널에 안 실리게.
let cookieSecure = false

export function setCookieSecure(secure: boolean): void {
  cookieSecure = secure
}

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
export function checkAuth(req: IncomingMessage): boolean {
  return lookupAndTouch(readCookie(req, COOKIE_NAME)) !== null
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

export function serveLoginPage(res: ServerResponse, error: string = ''): void {
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

export async function handleLoginPost(
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

export function handleLogout(res: ServerResponse): void {
  clearSessionCookie(res)
  res.statusCode = 302
  res.setHeader('Location', '/login')
  res.end()
}
