import { createServer, type IncomingMessage, type Server } from 'http'
import { app, BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import { promises as fs } from 'fs'
import { join } from 'path'

const DEFAULT_PORT = process.env.HONGTAIL_TEST === '1' ? 9877 : 9876
const PORT = Number(process.env.HONGTAIL_RPC_PORT ?? DEFAULT_PORT)
const ENABLE_EVAL = process.env.HONGTAIL_RPC_EVAL === '1'

let server: Server | null = null
let getMainWindow: () => BrowserWindow | null = () => null

async function readJsonBody<T = unknown>(req: IncomingMessage): Promise<T | null> {
  return new Promise((resolve, reject) => {
    let buf = ''
    req.on('data', (chunk: Buffer | string) => {
      buf += chunk
    })
    req.on('end', () => {
      if (!buf.trim()) return resolve(null)
      try {
        resolve(JSON.parse(buf) as T)
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

async function callRenderer(method: string, args: unknown[]): Promise<unknown> {
  const win = getMainWindow()
  if (!win) throw new Error('main window not available')
  const argsJson = args.map((a) => JSON.stringify(a ?? null)).join(', ')
  const expr = `(async () => await window.__rpc?.${method}?.(${argsJson}))()`
  return win.webContents.executeJavaScript(expr, true)
}

interface Body {
  [key: string]: unknown
}

// 호출 형태가 동일한 (= callRenderer(rpcMethod, body→args)) 라우트들의 테이블.
// 새 라우트는 여기 한 줄 추가하는 게 보통의 흐름.
const SIMPLE_RPC_ROUTES: Record<string, { rpc: string; args: (b: Body) => unknown[] }> = {
  'GET /state': { rpc: 'getState', args: () => [] },
  'POST /workspaces/add': { rpc: 'addWorkspace', args: (b) => [b.path] },
  'POST /sessions/start': {
    rpc: 'startSession',
    args: (b) => [b.workspacePath, b.backend, b.mode, b.sessionId ?? null]
  },
  'POST /sessions/select': {
    rpc: 'selectSession',
    args: (b) => [b.workspacePath, b.sessionId, b.title ?? '']
  },
  'POST /sessions/activate': { rpc: 'activate', args: (b) => [b.mode] },
  'POST /sessions/send': { rpc: 'sendInput', args: (b) => [b.sessionId, b.text] },
  'POST /sessions/control': { rpc: 'controlRequest', args: (b) => [b.sessionId, b.request] },
  'POST /sessions/wait-result': {
    rpc: 'waitResult',
    args: (b) => [b.sessionId, b.timeoutMs ?? 60000]
  }
}

async function dispatch(req: IncomingMessage): Promise<unknown> {
  const url = new URL(req.url ?? '/', 'http://x')
  const path = url.pathname
  const method = req.method ?? 'GET'
  const body = (await readJsonBody<Body>(req)) ?? {}
  const route = `${method} ${path}`

  const simple = SIMPLE_RPC_ROUTES[route]
  if (simple) return callRenderer(simple.rpc, simple.args(body))

  // Dynamic / special routes — body 외 사이드이펙트 (파일 쓰기, 윈도우 캡처,
  // 앱 종료) 가 있는 것들.
  if (method === 'GET' && path.startsWith('/messages/')) {
    const sessionId = decodeURIComponent(path.slice('/messages/'.length))
    return callRenderer('getMessages', [sessionId])
  }

  if (route === 'POST /screenshot') {
    const win = getMainWindow()
    if (!win) throw new Error('no window')
    const img = await win.webContents.capturePage()
    const filePath = join(
      app.getPath('userData'),
      `rpc-screenshot-${Date.now()}.png`
    )
    await fs.writeFile(filePath, img.toPNG())
    return { path: filePath }
  }

  if (route === 'POST /eval' && ENABLE_EVAL) {
    const win = getMainWindow()
    if (!win) throw new Error('no window')
    return win.webContents.executeJavaScript(
      `(async () => { ${String(body.script ?? '')} })()`,
      true
    )
  }

  if (route === 'POST /quit') {
    setTimeout(() => app.quit(), 100)
    return { ok: true }
  }

  const err = new Error(`unknown route: ${route}`) as Error & { status?: number }
  err.status = 404
  throw err
}

export function startRpcServer(getWindow: () => BrowserWindow | null): void {
  if (!is.dev) return
  getMainWindow = getWindow

  server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Access-Control-Allow-Origin', '*')
    try {
      const result = await dispatch(req)
      res.statusCode = 200
      res.end(JSON.stringify(result ?? null))
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500
      res.statusCode = status
      res.end(JSON.stringify({ error: String(err) }))
    }
  })

  const onListenError = (err: NodeJS.ErrnoException): void => {
    if (err.code === 'EADDRINUSE') {
      console.warn(
        `[rpc] port ${PORT} already in use — RPC disabled for this instance ` +
          `(set HONGTAIL_RPC_PORT to use a different port)`
      )
    } else {
      console.error('[rpc] server error:', err)
    }
    server = null
  }
  server.once('error', onListenError)
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[rpc] http://127.0.0.1:${PORT} (dev mode)`)
    server?.off('error', onListenError)
  })
}

export function stopRpcServer(): void {
  server?.close()
  server = null
}
