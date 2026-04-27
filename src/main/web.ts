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
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from 'http'
import { promises as fs } from 'fs'
import { join, normalize, resolve as resolvePath } from 'path'
import { app } from 'electron'

const ENABLED = process.env.HONGLUADE_WEB === '1'
const PORT = Number(process.env.HONGLUADE_WEB_PORT ?? 9879)

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
const sseBus = new Map<string, Set<EventEmit>>()

export function emitSse(topic: string, event: unknown): void {
  let set = sseBus.get(topic)
  if (!set) {
    set = new Set()
    sseBus.set(topic, set)
    registerEventSource(topic, (emit) => {
      set!.add(emit)
      return () => set!.delete(emit)
    })
  }
  for (const emit of set) emit(event)
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

export function startWebServer(): void {
  if (!ENABLED) return
  server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }
    const url = new URL(req.url ?? '/', 'http://x')
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
  })
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(
        `[web] port ${PORT} already in use — web server disabled (set HONGLUADE_WEB_PORT)`
      )
    } else {
      console.error('[web] server error:', err)
    }
    server = null
  })
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[web] http://127.0.0.1:${PORT}`)
  })
}

export function stopWebServer(): void {
  server?.close()
  server = null
}
