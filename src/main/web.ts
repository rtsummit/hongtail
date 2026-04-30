// Web 모드 — HONGTAIL_WEB=1 또는 GUI 의 웹 설정으로 활성. Electron 의
// BrowserWindow 와 별개로 HTTP 서버를 띄워 외부 브라우저(=모바일/다른 PC)에서
// hongtail UI 를 로드한다.
//
// 통신 채널:
//   - 요청-응답: POST /rpc  body={method, args} → registerRpc 등록 핸들러
//   - 푸시: GET /events?topic=<topic> → SSE (webSse.ts)
//   - 정적: GET /... → out/renderer 의 빌드 결과
//
// 인증: cookie 기반 세션 (webAuth.ts), 미설정 상태에선 로그인 자체 거부.
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from 'http'
import { createServer as createHttpsServer } from 'https'
import { promises as fs, readFileSync } from 'fs'
import { join, normalize, resolve as resolvePath } from 'path'
import { app } from 'electron'
import { WEB_HOST, type WebSettings } from './webSettings'
import {
  checkAuth,
  handleLoginPost,
  handleLogout,
  isPasswordSet,
  serveLoginPage,
  setCookieSecure
} from './webAuth'
import { handleSseEvents } from './webSse'

// 인증·SSE 의 public API 는 web.ts 를 통해 그대로 re-export — 외부 호출자
// (index.ts, dispatch.ts, ipc.ts) 는 from './web' 만 보면 된다.
export { isPasswordSet, setPassword } from './webAuth'
export { emitSse } from './webSse'

let server: Server | null = null

type RpcHandler = (args: unknown[]) => Promise<unknown> | unknown
const rpcHandlers = new Map<string, RpcHandler>()

export function registerRpc(method: string, handler: RpcHandler): void {
  rpcHandlers.set(method, handler)
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

let activePort = 0

export function startWebServer(settings: WebSettings): void {
  // Idempotent — 이미 살아있으면 stop 후 재시작.
  if (server) stopWebServer()
  if (!settings.enabled) return
  activePort = settings.port
  let useHttps = false
  let tlsOptions: { cert: Buffer; key: Buffer } | null = null
  setCookieSecure(false)
  if (settings.tlsCertPath && settings.tlsKeyPath) {
    try {
      tlsOptions = {
        cert: readFileSync(settings.tlsCertPath),
        key: readFileSync(settings.tlsKeyPath)
      }
      useHttps = true
      setCookieSecure(true)
    } catch (err) {
      console.error('[web] TLS cert/key read failed — falling back to HTTP:', err)
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
      // 정적·일반 GET 은 로그인 페이지로 redirect, RPC/SSE 는 401 JSON
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
      handleSseEvents(req, res)
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
      console.warn(`[web] port ${activePort} already in use — web server disabled`)
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
