import { app } from 'electron'
import { promises as fs, createReadStream } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { createInterface } from 'readline'
import { registerInvoke } from './ipc'

export interface SessionAlias {
  alias: string
  setAt: string // ISO timestamp
}

type Store = Record<string, SessionAlias>

function aliasesFile(): string {
  return join(app.getPath('userData'), 'session-aliases.json')
}

function encodeCwd(path: string): string {
  // Same encoding as claude.ts: non-alphanumeric (except . and -) → -
  return path.replace(/[^a-zA-Z0-9.-]/g, '-')
}

function projectDir(cwd: string): string {
  return join(homedir(), '.claude', 'projects', encodeCwd(cwd))
}

let cache: Store | null = null

async function loadAll(): Promise<Store> {
  if (cache) return cache
  try {
    const content = await fs.readFile(aliasesFile(), 'utf-8')
    if (!content.trim()) {
      cache = {}
      return cache
    }
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Store = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (
          v &&
          typeof v === 'object' &&
          typeof (v as { alias?: unknown }).alias === 'string' &&
          typeof (v as { setAt?: unknown }).setAt === 'string'
        ) {
          out[k] = { alias: (v as SessionAlias).alias, setAt: (v as SessionAlias).setAt }
        }
      }
      cache = out
      return cache
    }
    cache = {}
    return cache
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      cache = {}
      return cache
    }
    throw err
  }
}

async function persistAll(store: Store): Promise<void> {
  await fs.writeFile(aliasesFile(), JSON.stringify(store, null, 2), 'utf-8')
  cache = store
}

async function setAliasInternal(
  sessionId: string,
  alias: string,
  setAt: string
): Promise<SessionAlias | null> {
  const store = await loadAll()
  const trimmed = alias.trim()
  const next = { ...store }
  if (!trimmed) {
    if (!(sessionId in next)) return null
    delete next[sessionId]
    await persistAll(next)
    return null
  }
  const entry: SessionAlias = { alias: trimmed, setAt }
  next[sessionId] = entry
  await persistAll(next)
  return entry
}

async function setAlias(sessionId: string, alias: string): Promise<SessionAlias | null> {
  return setAliasInternal(sessionId, alias, new Date().toISOString())
}

const RENAME_PREFIX = '<local-command-stdout>Session renamed to: '
const RENAME_SUFFIX = '</local-command-stdout>'

interface RenameSignal {
  alias: string
  setAt: string
}

async function findLatestRenameInJsonl(
  cwd: string,
  sessionId: string
): Promise<RenameSignal | null> {
  const file = join(projectDir(cwd), `${sessionId}.jsonl`)
  let latest: RenameSignal | null = null
  try {
    const stream = createReadStream(file, { encoding: 'utf-8' })
    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    for await (const line of rl) {
      // Cheap reject before JSON.parse
      if (!line.includes('Session renamed to:')) continue
      let v: Record<string, unknown>
      try {
        v = JSON.parse(line)
      } catch {
        continue
      }
      if (v.type !== 'system' || v.subtype !== 'local_command') continue
      const content = typeof v.content === 'string' ? v.content : ''
      if (!content.startsWith(RENAME_PREFIX)) continue
      const ts = typeof v.timestamp === 'string' ? v.timestamp : null
      if (!ts) continue
      const tail = content.slice(RENAME_PREFIX.length)
      const closeIdx = tail.lastIndexOf(RENAME_SUFFIX)
      const aliasText = (closeIdx >= 0 ? tail.slice(0, closeIdx) : tail).trim()
      if (!aliasText) continue
      latest = { alias: aliasText, setAt: ts }
    }
    rl.close()
    stream.destroy()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  return latest
}

async function syncFromJsonl(
  cwd: string,
  sessionId: string
): Promise<SessionAlias | null> {
  const renameSignal = await findLatestRenameInJsonl(cwd, sessionId)
  const store = await loadAll()
  const current = store[sessionId] ?? null
  if (!renameSignal) return current
  // String compare on ISO timestamps is lexicographically correct.
  if (current && current.setAt >= renameSignal.setAt) return current
  return await setAliasInternal(sessionId, renameSignal.alias, renameSignal.setAt)
}

export function registerSessionAliasHandlers(): void {
  registerInvoke('session-aliases:list', () => loadAll())
  registerInvoke('session-aliases:set', (sessionId: unknown, alias: unknown) =>
    setAlias(String(sessionId), String(alias))
  )
  registerInvoke('session-aliases:sync', (cwd: unknown, sessionId: unknown) =>
    syncFromJsonl(String(cwd), String(sessionId))
  )
}
