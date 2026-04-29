import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import { createInterface } from 'readline'
import { appendFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { refreshUsageCacheIfStale } from './usageCache'
import { registerInvoke } from './ipc'
import { broadcast } from './dispatch'

// Phase 0 probe — host-confirm-ui 브랜치 한정. control_request / control_response 라인을 raw 로
// 덤프해 wire format 확인. probe 끝나면 제거.
const PROBE_LOG = join(tmpdir(), 'hongtail-control-probe.log')
function probeLog(direction: 'in' | 'out' | 'err', sessionId: string, line: string): void {
  try {
    appendFileSync(
      PROBE_LOG,
      `[${new Date().toISOString()}] ${direction} sid=${sessionId.slice(0, 8)} ${line}\n`
    )
  } catch {
    /* ignore */
  }
}

interface Session {
  id: string
  workspacePath: string
  child: ChildProcess
}

const sessions = new Map<string, Session>()

function eventChannel(sessionId: string): string {
  return `claude:event:${sessionId}`
}

function spawnClaude(
  workspacePath: string,
  sessionId: string,
  isResume: boolean
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
    '--include-hook-events',
    '--permission-prompt-tool',
    'stdio',
    '--settings',
    'C:/Workspace/hongtail/scripts/hook-probe-settings.json'
    // (Phase 0 probe C) --permission-prompt-tool stdio 가 결정적 — print.ts:4276 의
    // 분기를 'stdio' 로 끌어가 createCanUseTool() 가 활성화. 그래야 SDK can_use_tool
    // control_request 가 stdout 으로 emit + PermissionRequest hook 도 race 로 발화.
    // --settings 의 stub 은 항상 allow 반환해 race 에서 빠르게 결정되게.
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

  const channel = eventChannel(sessionId)
  if (child.stdout) {
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity })
    rl.on('line', (line) => {
      if (!line.trim()) return
      try {
        const event = JSON.parse(line)
        const t = (event as { type?: string }).type
        if (
          t === 'control_request' ||
          t === 'control_response' ||
          t === 'system' ||
          t === 'hook_event'
        ) {
          probeLog('in', sessionId, line)
        }
        broadcast(channel, event)
        if (t === 'result' || t === 'rate_limit_event') {
          refreshUsageCacheIfStale()
        }
      } catch {
        broadcast(channel, { type: 'parse_error', raw: line })
      }
    })
  }

  child.stderr?.on('data', (data) => {
    const text = String(data)
    probeLog('err', sessionId, text.replace(/\n/g, ' '))
    broadcast(channel, { type: 'stderr', data: text })
  })

  child.on('close', (code) => {
    broadcast(channel, { type: 'closed', code })
    sessions.delete(sessionId)
  })

  child.on('error', (err) => {
    broadcast(channel, { type: 'spawn_error', error: err.message })
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
  registerInvoke('claude:start-session', (rawArgs: unknown) => {
    const args = rawArgs as StartArgs
    const sessionId = args.sessionId ?? randomUUID()

    const existing = sessions.get(sessionId)
    if (existing) {
      return { sessionId, alreadyRunning: true }
    }

    const child = spawnClaude(args.workspacePath, sessionId, args.mode === 'resume')
    sessions.set(sessionId, { id: sessionId, workspacePath: args.workspacePath, child })
    return { sessionId, alreadyRunning: false }
  })

  registerInvoke('claude:send-input', (sessionId: unknown, text: unknown) => {
    const session = sessions.get(String(sessionId))
    if (!session?.child.stdin) {
      throw new Error(`Session ${String(sessionId)} not running`)
    }
    const payload = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: String(text) }
    })
    session.child.stdin.write(payload + '\n')
  })

  registerInvoke('claude:control-request', (sessionId: unknown, request: unknown) => {
    const session = sessions.get(String(sessionId))
    if (!session?.child.stdin) {
      throw new Error(`Session ${String(sessionId)} not running`)
    }
    const requestId = randomUUID()
    const payload = JSON.stringify({
      type: 'control_request',
      request_id: requestId,
      request
    })
    session.child.stdin.write(payload + '\n')
    return requestId
  })

  registerInvoke('claude:stop-session', (sessionId: unknown) => {
    const id = String(sessionId)
    const session = sessions.get(id)
    if (!session) return
    try {
      session.child.stdin?.end()
    } catch {
      /* ignore */
    }
    session.child.kill()
    sessions.delete(id)
  })

  registerInvoke('claude:list-running', () => Array.from(sessions.keys()))

  // 새로고침 reconcile 용. 'app' 백엔드 살아있는 세션 + workspacePath 까지.
  // listRunning 은 호환성 위해 그대로 두고 별도 RPC.
  registerInvoke('claude:list-active', () =>
    Array.from(sessions.values()).map((s) => ({
      sessionId: s.id,
      workspacePath: s.workspacePath,
      backend: 'app' as const
    }))
  )
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
