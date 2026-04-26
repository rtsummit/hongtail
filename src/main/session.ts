import { ipcMain, BrowserWindow, type WebContents } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import { createInterface } from 'readline'
import { refreshUsageCacheIfStale } from './usageCache'

interface Session {
  id: string
  workspacePath: string
  child: ChildProcess
}

const sessions = new Map<string, Session>()

function eventChannel(sessionId: string): string {
  return `claude:event:${sessionId}`
}

function emit(sender: WebContents, sessionId: string, event: unknown): void {
  if (sender.isDestroyed()) return
  sender.send(eventChannel(sessionId), event)
}

function spawnClaude(
  workspacePath: string,
  sessionId: string,
  isResume: boolean,
  sender: WebContents
): ChildProcess {
  const baseArgs = [
    '-p',
    '--output-format',
    'stream-json',
    '--input-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    'bypassPermissions',
    // honglaude는 AskUserQuestion 옵션 카드 UI를 아직 못 띄워서
    // -p 모드 SDK가 0.003초 만에 자동 deny → plan agent가 "답이 없음"으로
    // 오해석하고 임의 디폴트로 진행한다. UI 구현 전까지 비활성해 일반
    // 텍스트 질문으로 폴백시킨다.
    '--disallowed-tools',
    'AskUserQuestion'
  ]
  const args = isResume
    ? [...baseArgs, '--resume', sessionId]
    : [...baseArgs, '--session-id', sessionId]

  const child = spawn('claude', args, {
    cwd: workspacePath,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    windowsHide: true
  })

  if (child.stdout) {
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity })
    rl.on('line', (line) => {
      if (!line.trim()) return
      try {
        const event = JSON.parse(line)
        emit(sender, sessionId, event)
        const t = (event as { type?: string }).type
        if (t === 'result' || t === 'rate_limit_event') {
          refreshUsageCacheIfStale()
        }
      } catch {
        emit(sender, sessionId, { type: 'parse_error', raw: line })
      }
    })
  }

  child.stderr?.on('data', (data) => {
    emit(sender, sessionId, { type: 'stderr', data: String(data) })
  })

  child.on('close', (code) => {
    emit(sender, sessionId, { type: 'closed', code })
    sessions.delete(sessionId)
  })

  child.on('error', (err) => {
    emit(sender, sessionId, { type: 'spawn_error', error: err.message })
    sessions.delete(sessionId)
  })

  return child
}

interface StartArgs {
  workspacePath: string
  sessionId: string | null
  mode: 'new' | 'resume'
}

export function registerSessionHandlers(): void {
  ipcMain.handle('claude:start-session', async (event, args: StartArgs) => {
    const sender = event.sender
    const sessionId = args.sessionId ?? randomUUID()

    const existing = sessions.get(sessionId)
    if (existing) {
      return { sessionId, alreadyRunning: true }
    }

    const child = spawnClaude(args.workspacePath, sessionId, args.mode === 'resume', sender)
    sessions.set(sessionId, { id: sessionId, workspacePath: args.workspacePath, child })
    return { sessionId, alreadyRunning: false }
  })

  ipcMain.handle('claude:send-input', async (_, sessionId: string, text: string) => {
    const session = sessions.get(sessionId)
    if (!session?.child.stdin) {
      throw new Error(`Session ${sessionId} not running`)
    }
    const payload = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: text }
    })
    session.child.stdin.write(payload + '\n')
  })

  ipcMain.handle(
    'claude:control-request',
    async (_, sessionId: string, request: Record<string, unknown>) => {
      const session = sessions.get(sessionId)
      if (!session?.child.stdin) {
        throw new Error(`Session ${sessionId} not running`)
      }
      const requestId = randomUUID()
      const payload = JSON.stringify({
        type: 'control_request',
        request_id: requestId,
        request
      })
      session.child.stdin.write(payload + '\n')
      return requestId
    }
  )

  ipcMain.handle('claude:stop-session', async (_, sessionId: string) => {
    const session = sessions.get(sessionId)
    if (!session) return
    try {
      session.child.stdin?.end()
    } catch {
      /* ignore */
    }
    session.child.kill()
    sessions.delete(sessionId)
  })

  ipcMain.handle('claude:list-running', async () => {
    return Array.from(sessions.keys())
  })
}

export function killAllSessions(): void {
  for (const session of sessions.values()) {
    try {
      session.child.kill()
    } catch {
      /* ignore */
    }
  }
  sessions.clear()
}

export function broadcast(event: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(event, data)
  }
}
