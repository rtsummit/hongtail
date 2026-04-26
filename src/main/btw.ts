import { ipcMain, type WebContents } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { createInterface } from 'readline'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { projectDir } from './claude'

interface BtwProc {
  child: ChildProcess
  cwd: string
  promptFile: string
  sessionId: string | null
}

const procs = new Map<string, BtwProc>()

function eventChannel(ownerId: string): string {
  return `btw:event:${ownerId}`
}

function emit(sender: WebContents, ownerId: string, event: unknown): void {
  if (sender.isDestroyed()) return
  sender.send(eventChannel(ownerId), event)
}

interface AskArgs {
  ownerId: string
  workspacePath: string
  systemPrompt: string
  question: string
}

async function writePromptFile(systemPrompt: string): Promise<string> {
  const file = join(
    tmpdir(),
    `hongluade-btw-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
  )
  await fsp.writeFile(file, systemPrompt, 'utf8')
  return file
}

async function safeUnlink(file: string): Promise<void> {
  try {
    await fsp.unlink(file)
  } catch {
    /* ignore */
  }
}

// `--no-session-persistence` blocks resuming but Claude CLI still writes the
// session jsonl to ~/.claude/projects/<encoded-cwd>/, which then surfaces in
// the sidebar's session list. Capture the BTW session id from stream-json
// events and unlink the file when the process exits.
async function deleteBtwSessionFile(cwd: string, sessionId: string): Promise<void> {
  const file = join(projectDir(cwd), `${sessionId}.jsonl`)
  await safeUnlink(file)
}

// Windows cmd.exe mangles non-ASCII (Korean) in positional args and has an
// 8191-char arg limit. We bypass both by writing the system prompt to a temp
// file (--append-system-prompt-file) and piping the question through stdin.
function spawnBtw(
  args: AskArgs,
  sender: WebContents,
  promptFile: string
): ChildProcess {
  const cliArgs = [
    '-p',
    '--tools',
    '',
    '--no-session-persistence',
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    '--disable-slash-commands',
    '--verbose',
    '--append-system-prompt-file',
    promptFile
  ]

  const child = spawn('claude', cliArgs, {
    cwd: args.workspacePath,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    windowsHide: true
  })

  if (child.stdin) {
    child.stdin.write(args.question, 'utf8')
    child.stdin.end()
  }

  if (child.stdout) {
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity })
    rl.on('line', (line) => {
      if (!line.trim()) return
      try {
        const event = JSON.parse(line)
        const sessId = (event as { sessionId?: string }).sessionId
        if (sessId) {
          const proc = procs.get(args.ownerId)
          if (proc && !proc.sessionId) proc.sessionId = sessId
        }
        emit(sender, args.ownerId, event)
      } catch {
        emit(sender, args.ownerId, { type: 'parse_error', raw: line })
      }
    })
  }

  child.stderr?.on('data', (data) => {
    emit(sender, args.ownerId, { type: 'stderr', data: String(data) })
  })

  const cleanup = (): void => {
    const proc = procs.get(args.ownerId)
    procs.delete(args.ownerId)
    void safeUnlink(promptFile)
    if (proc?.sessionId) {
      void deleteBtwSessionFile(args.workspacePath, proc.sessionId)
    }
  }

  child.on('close', (code) => {
    emit(sender, args.ownerId, { type: 'closed', code })
    cleanup()
  })

  child.on('error', (err) => {
    emit(sender, args.ownerId, { type: 'spawn_error', error: err.message })
    cleanup()
  })

  return child
}

export function registerBtwHandlers(): void {
  ipcMain.handle('btw:ask', async (event, args: AskArgs) => {
    const existing = procs.get(args.ownerId)
    if (existing) {
      try {
        existing.child.kill()
      } catch {
        /* ignore */
      }
      procs.delete(args.ownerId)
      void safeUnlink(existing.promptFile)
      if (existing.sessionId) {
        void deleteBtwSessionFile(existing.cwd, existing.sessionId)
      }
    }
    const promptFile = await writePromptFile(args.systemPrompt)
    const child = spawnBtw(args, event.sender, promptFile)
    procs.set(args.ownerId, {
      child,
      cwd: args.workspacePath,
      promptFile,
      sessionId: null
    })
  })

  ipcMain.handle('btw:cancel', async (_, ownerId: string) => {
    const p = procs.get(ownerId)
    if (!p) return
    try {
      p.child.kill()
    } catch {
      /* ignore */
    }
    // Don't unlink here — let the child's 'close' handler clean up after
    // the process has fully released its file handles. (cleanup() runs there.)
  })
}

export function killAllBtw(): void {
  for (const p of procs.values()) {
    try {
      p.child.kill()
    } catch {
      /* ignore */
    }
    void safeUnlink(p.promptFile)
    if (p.sessionId) {
      void deleteBtwSessionFile(p.cwd, p.sessionId)
    }
  }
  procs.clear()
}
