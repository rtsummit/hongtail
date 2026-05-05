import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import { createInterface } from 'readline'
import { refreshUsageCacheIfStale } from './usageCache'
import { registerInvoke } from './ipc'
import { broadcast } from './dispatch'

interface Session {
  id: string
  workspacePath: string
  child: ChildProcess
}

const sessions = new Map<string, Session>()

function eventChannel(sessionId: string): string {
  return `claude:event:${sessionId}`
}

// 자식 → 호스트 incoming control_request 전용 채널. 일반 event 흐름과 분리해서
// 채팅 메시지 stream 에 안 섞이도록 함. 렌더러는 이 채널을 별도로 구독해
// can_use_tool 같은 incoming request 를 받아 host UI 띄우고 control_response 로
// 회신.
function controlRequestChannel(sessionId: string): string {
  return `claude:control-request:${sessionId}`
}

// 호출부 (renderer) 가 settings.defaultPermissionMode 를 매번 같이 넘긴다.
// claude CLI 가 받는 값과 그대로 일치 — 'default'/'auto'/'plan'/'acceptEdits'/'bypassPermissions'.
// 빠지면 안전한 기본값 'default'.
function spawnClaude(
  workspacePath: string,
  sessionId: string,
  isResume: boolean,
  permissionMode: string
): ChildProcess {
  const baseArgs = [
    '-p',
    '--output-format',
    'stream-json',
    '--input-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    permissionMode,
    '--permission-prompt-tool',
    'stdio'
    // --permission-prompt-tool stdio: claude-code-main 의 print.ts:4276 분기를
    // 'stdio' 로 끌어가 createCanUseTool() 활성화. interactive 한 deferred tool
    // (AskUserQuestion / ExitPlanMode) 의 권한 요청이 자식의 stdout 으로
    // can_use_tool subtype control_request 로 emit 되고, 호스트 (=hongtail)
    // 가 stdin 으로 control_response 회신할 때까지 자식이 대기. 이 플래그가
    // 빠지면 fallback 경로 ('ask' → 자동 deny) 가 작동해 자동 거부됨.
    // 자세히는 docs/host-confirm-ui-plan.md §11.1.
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
        // 자식 → 호스트 incoming control_request 는 별 채널로 분리해 channel 흐름과
        // 섞지 않음. claudeEvents.ts 의 일반 파서가 control_request 를 처리하지 않게.
        if (t === 'control_request') {
          broadcast(controlRequestChannel(sessionId), event)
          return
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
    broadcast(channel, { type: 'stderr', data: String(data) })
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
  permissionMode?: string
}

export function registerSessionHandlers(): void {
  registerInvoke('claude:start-session', (rawArgs: unknown) => {
    const args = rawArgs as StartArgs
    const sessionId = args.sessionId ?? randomUUID()

    const existing = sessions.get(sessionId)
    if (existing) {
      return { sessionId, alreadyRunning: true }
    }

    const child = spawnClaude(
      args.workspacePath,
      sessionId,
      args.mode === 'resume',
      args.permissionMode ?? 'default'
    )
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

  // 자식이 보낸 incoming control_request 에 호스트가 답신. 렌더러가
  // controlRequestChannel 로 받은 request 의 request_id 를 그대로 박아 payload
  // 통째로 stdin 에 write. payload 는 wire format (docs/host-confirm-ui-plan.md
  // §11.3) 그대로 — { type:'control_response', response:{ subtype, request_id,
  // response:{ behavior:'allow'|'deny', updatedInput?, message? } } }.
  registerInvoke('claude:respond-control', (sessionId: unknown, payload: unknown) => {
    const session = sessions.get(String(sessionId))
    if (!session?.child.stdin) {
      throw new Error(`Session ${String(sessionId)} not running`)
    }
    session.child.stdin.write(JSON.stringify(payload) + '\n')
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
