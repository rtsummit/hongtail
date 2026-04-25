import { ipcMain, type WebContents } from 'electron'
import * as pty from 'node-pty'

interface PtyEntry {
  proc: pty.IPty
  workspacePath: string
}

const ptys = new Map<string, PtyEntry>()

function eventChannel(sessionId: string): string {
  return `pty:event:${sessionId}`
}

function emit(sender: WebContents, sessionId: string, event: unknown): void {
  if (sender.isDestroyed()) return
  sender.send(eventChannel(sessionId), event)
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
  ipcMain.handle('pty:spawn', (event, args: SpawnArgs) => {
    const sender = event.sender
    const { sessionId, workspacePath, cols, rows, command, delayMs } = args

    if (ptys.has(sessionId)) {
      return { alreadyRunning: true }
    }

    const isWin = process.platform === 'win32'
    const shell = isWin ? 'cmd.exe' : process.env.SHELL || 'bash'

    const proc = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: workspacePath,
      env: process.env as Record<string, string>
    })

    proc.onData((data) => emit(sender, sessionId, { type: 'data', data }))
    proc.onExit(({ exitCode }) => {
      emit(sender, sessionId, { type: 'exit', code: exitCode })
      ptys.delete(sessionId)
    })

    ptys.set(sessionId, { proc, workspacePath })

    if (command) {
      setTimeout(() => {
        const entry = ptys.get(sessionId)
        if (entry) entry.proc.write(`${command}\r`)
      }, delayMs ?? 200)
    }

    return { alreadyRunning: false }
  })

  ipcMain.handle('pty:write', (_, sessionId: string, data: string) => {
    ptys.get(sessionId)?.proc.write(data)
  })

  ipcMain.handle('pty:resize', (_, sessionId: string, cols: number, rows: number) => {
    try {
      ptys.get(sessionId)?.proc.resize(cols, rows)
    } catch {
      /* ignore resize errors */
    }
  })

  ipcMain.handle('pty:kill', (_, sessionId: string) => {
    const entry = ptys.get(sessionId)
    if (!entry) return
    try {
      entry.proc.kill()
    } catch {
      /* ignore */
    }
    ptys.delete(sessionId)
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
