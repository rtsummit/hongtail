import { createServer, type IncomingMessage, type Server } from 'http'
import { app, BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import { promises as fs } from 'fs'
import { join } from 'path'

const DEFAULT_PORT = process.env.HONGLUADE_TEST === '1' ? 9877 : 9876
const PORT = Number(process.env.HONGLUADE_RPC_PORT ?? DEFAULT_PORT)
const ENABLE_EVAL = process.env.HONGLUADE_RPC_EVAL === '1'

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

async function dispatch(req: IncomingMessage): Promise<unknown> {
  const url = new URL(req.url ?? '/', 'http://x')
  const path = url.pathname
  const method = req.method ?? 'GET'
  const body = (await readJsonBody<Body>(req)) ?? {}

  const route = `${method} ${path}`

  if (route === 'GET /state') {
    return callRenderer('getState', [])
  }

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

  if (route === 'POST /workspaces/add') {
    return callRenderer('addWorkspace', [body.path])
  }

  if (route === 'POST /sessions/start') {
    return callRenderer('startSession', [
      body.workspacePath,
      body.backend,
      body.mode,
      body.sessionId ?? null
    ])
  }

  if (route === 'POST /sessions/select') {
    return callRenderer('selectSession', [
      body.workspacePath,
      body.sessionId,
      body.title ?? ''
    ])
  }

  if (route === 'POST /sessions/activate') {
    return callRenderer('activate', [body.mode])
  }

  if (route === 'POST /sessions/send') {
    return callRenderer('sendInput', [body.sessionId, body.text])
  }

  if (route === 'POST /sessions/control') {
    return callRenderer('controlRequest', [body.sessionId, body.request])
  }

  if (route === 'POST /sessions/wait-result') {
    return callRenderer('waitResult', [body.sessionId, body.timeoutMs ?? 60000])
  }

  if (route === 'POST /backend/set') {
    return callRenderer('setBackend', [body.backend])
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
          `(set HONGLUADE_RPC_PORT to use a different port)`
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
