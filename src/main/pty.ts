import * as pty from 'node-pty'
import { registerInvoke } from './ipc'
import { broadcast } from './dispatch'

interface PtyEntry {
  proc: pty.IPty
  workspacePath: string
  // 새로고침 후 xterm 버퍼 복원용 ring. proc.onData 가 누적해두고,
  // 같은 sessionId 로 다시 spawn 호출이 오면 (alreadyRunning) 응답에 같이
  // 돌려줘서 호출한 클라이언트만 한 번에 term.write 한다 — broadcast 면 다른
  // 활성 클라이언트가 중복 출력 받음. limit 초과 시 앞부분만 잘라 ANSI
  // escape 가 깨질 수 있으나 실용적으로 화면 밖 영역이라 허용.
  buffer: string
}

const PTY_BUFFER_LIMIT = 256_000

const ptys = new Map<string, PtyEntry>()

function eventChannel(sessionId: string): string {
  return `pty:event:${sessionId}`
}

interface SpawnArgs {
  sessionId: string
  workspacePath: string
  cols: number
  rows: number
  command?: string
  delayMs?: number
}

export function registerPtyHandlers(): void {
  registerInvoke('pty:spawn', (rawArgs: unknown) => {
    const args = rawArgs as SpawnArgs
    const { sessionId, workspacePath, cols, rows, command, delayMs } = args
    void delayMs

    const existing = ptys.get(sessionId)
    if (existing) {
      // 새로고침 등으로 다시 mount 된 클라이언트. ring buffer 를 응답으로
      // 돌려줘 xterm 화면 복원. 다른 활성 클라이언트 화면에는 영향 없음.
      return { alreadyRunning: true, replay: existing.buffer || undefined }
    }

    const isWin = process.platform === 'win32'
    const shell = isWin ? 'cmd.exe' : process.env.SHELL || 'bash'

    // When command is provided, run it via shell -c / cmd /c so that the shell
    // exits as soon as the command exits — propagating PTY exit so the renderer
    // can clean up the session. Without this, cmd would stay alive after claude exits.
    const cmdArgs: string[] = []
    if (command) {
      cmdArgs.push(isWin ? '/c' : '-c', command)
    }

    const proc = pty.spawn(shell, cmdArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: workspacePath,
      env: process.env as Record<string, string>
    })

    const channel = eventChannel(sessionId)
    proc.onData((data) => {
      broadcast(channel, { type: 'data', data })
      const entry = ptys.get(sessionId)
      if (!entry) return
      entry.buffer += data
      if (entry.buffer.length > PTY_BUFFER_LIMIT) {
        entry.buffer = entry.buffer.slice(entry.buffer.length - PTY_BUFFER_LIMIT)
      }
    })
    proc.onExit(({ exitCode }) => {
      broadcast(channel, { type: 'exit', code: exitCode })
      ptys.delete(sessionId)
    })

    ptys.set(sessionId, {
      proc,
      workspacePath,
      buffer: ''
    })
    return { alreadyRunning: false }
  })

  registerInvoke('pty:write', (sessionId: unknown, data: unknown) => {
    ptys.get(String(sessionId))?.proc.write(String(data))
  })

  registerInvoke('pty:resize', (sessionId: unknown, cols: unknown, rows: unknown) => {
    try {
      ptys.get(String(sessionId))?.proc.resize(Number(cols), Number(rows))
    } catch {
      /* ignore resize errors */
    }
  })

  registerInvoke('pty:kill', (sessionId: unknown) => {
    const id = String(sessionId)
    const entry = ptys.get(id)
    if (!entry) return
    try {
      entry.proc.kill()
    } catch {
      /* ignore */
    }
    ptys.delete(id)
  })

  // 새로고침 reconcile 용. PTY 기반 살아있는 세션은 모두 'terminal' 백엔드.
  registerInvoke('pty:list-active', () =>
    Array.from(ptys.entries()).map(([sessionId, e]) => ({
      sessionId,
      workspacePath: e.workspacePath,
      backend: 'terminal' as const
    }))
  )
}

export function killAllPty(): void {
  for (const entry of ptys.values()) {
    try {
      entry.proc.kill()
    } catch {
      /* ignore */
    }
  }
  ptys.clear()
}
