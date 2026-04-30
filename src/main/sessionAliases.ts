import { app } from 'electron'
import { createReadStream } from 'fs'
import { join } from 'path'
import { createInterface } from 'readline'
import { projectDir } from './claude'
import { registerInvoke } from './ipc'
import { readJsonFile, writeJsonFile } from './jsonFile'

export interface SessionAlias {
  alias: string
  setAt: string // ISO timestamp
}

type Store = Record<string, SessionAlias>

function aliasesFile(): string {
  return join(app.getPath('userData'), 'session-aliases.json')
}

let cache: Store | null = null

async function loadAll(): Promise<Store> {
  if (cache) return cache
  const parsed = await readJsonFile<Store>(aliasesFile(), {})
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    cache = {}
    return cache
  }
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

async function persistAll(store: Store): Promise<void> {
  await writeJsonFile(aliasesFile(), store)
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

// 파싱된 한 jsonl record 가 /rename 결과인지 판정하고 alias·timestamp 추출.
// claude CLI 의 /rename 은 system + subtype:'local_command' record 로 기록되며
// content 는 '<local-command-stdout>Session renamed to: <alias></local-command-stdout>'
// 형태. 호출자는 cheap "Session renamed to:" 부분 문자열 체크로 JSON.parse
// 비용을 회피.
export function parseRenameRecord(record: unknown): RenameSignal | null {
  if (!record || typeof record !== 'object') return null
  const v = record as Record<string, unknown>
  if (v.type !== 'system' || v.subtype !== 'local_command') return null
  const content = typeof v.content === 'string' ? v.content : ''
  if (!content.startsWith(RENAME_PREFIX)) return null
  const ts = typeof v.timestamp === 'string' ? v.timestamp : null
  if (!ts) return null
  const tail = content.slice(RENAME_PREFIX.length)
  const closeIdx = tail.lastIndexOf(RENAME_SUFFIX)
  const aliasText = (closeIdx >= 0 ? tail.slice(0, closeIdx) : tail).trim()
  if (!aliasText) return null
  return { alias: aliasText, setAt: ts }
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
      let v: unknown
      try {
        v = JSON.parse(line)
      } catch {
        continue
      }
      const sig = parseRenameRecord(v)
      if (sig) latest = sig
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
