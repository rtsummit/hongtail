import * as pty from 'node-pty'
import { registerInvoke } from './ipc'
import { broadcast } from './dispatch'

interface PtyEntry {
  proc: pty.IPty
  workspacePath: string
}

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

    if (ptys.has(sessionId)) {
      return { alreadyRunning: true }
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
    proc.onData((data) => broadcast(channel, { type: 'data', data }))
    proc.onExit(({ exitCode }) => {
      broadcast(channel, { type: 'exit', code: exitCode })
      ptys.delete(sessionId)
    })

    ptys.set(sessionId, { proc, workspacePath })
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
