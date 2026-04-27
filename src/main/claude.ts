import { ipcMain, type WebContents } from 'electron'
import {
  promises as fs,
  createReadStream,
  mkdir as fsMkdir,
  watch as fsWatch,
  type FSWatcher
} from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { createInterface } from 'readline'

export interface ClaudeSessionMeta {
  id: string
  title: string
  startedAt: string
  lastActivityMs: number
}

export function encodeCwd(path: string): string {
  // Claude encodes the project dir name by replacing every non-alphanumeric
  // char (except '.' and '-') with '-'. So '_', ':', '\', '/', spaces, etc.
  // all become '-'. Verified against existing ~/.claude/projects dirs.
  return path.replace(/[^a-zA-Z0-9.-]/g, '-')
}

export function projectDir(cwd: string): string {
  return join(homedir(), '.claude', 'projects', encodeCwd(cwd))
}

function cleanTitle(text: string): string {
  let s = text.trim()
  while (s.startsWith('<')) {
    const closeIdx = s.indexOf('>')
    if (closeIdx < 0) break
    const tagFull = s.slice(1, closeIdx)
    const tagName = tagFull.split(/\s/)[0]?.replace(/\/$/, '') ?? ''
    if (!tagName) break
    if (tagFull.endsWith('/')) {
      s = s.slice(closeIdx + 1).trimStart()
      continue
    }
    const closeMarker = `</${tagName}>`
    const endIdx = s.indexOf(closeMarker)
    if (endIdx < 0) break
    s = s.slice(endIdx + closeMarker.length).trimStart()
  }
  const firstLine = s.split(/\r?\n/)[0]?.trim() ?? ''
  return Array.from(firstLine).slice(0, 80).join('')
}

function extractUserText(v: unknown): string | null {
  if (!v || typeof v !== 'object') return null
  const message = (v as Record<string, unknown>).message
  if (!message || typeof message !== 'object') return null
  const content = (message as Record<string, unknown>).content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    for (const item of content) {
      if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).text === 'string') {
        return (item as Record<string, unknown>).text as string
      }
    }
  }
  return null
}

async function parseSessionMeta(filePath: string, id: string): Promise<ClaudeSessionMeta> {
  let startedAt = ''
  let title = ''
  try {
    const stream = createReadStream(filePath, { encoding: 'utf-8' })
    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    let lineCount = 0
    for await (const line of rl) {
      if (++lineCount > 200) break
      let v: Record<string, unknown>
      try {
        v = JSON.parse(line)
      } catch {
        continue
      }
      if (!startedAt && typeof v.timestamp === 'string') {
        startedAt = v.timestamp
      }
      if (!title) {
        const typ = typeof v.type === 'string' ? v.type : ''
        const isMeta = v.isMeta === true
        if (typ === 'user' && !isMeta) {
          const text = extractUserText(v)
          if (text) {
            const cleaned = cleanTitle(text)
            if (cleaned) title = cleaned
          }
        }
      }
      if (startedAt && title) break
    }
    rl.close()
    stream.destroy()
  } catch {
    /* ignore read errors */
  }
  if (!title) {
    title = `Session ${id.slice(0, 8)}`
  }
  return { id, title, startedAt, lastActivityMs: 0 }
}

async function listSessions(cwd: string): Promise<ClaudeSessionMeta[]> {
  const dir = projectDir(cwd)
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const items: { meta: ClaudeSessionMeta; mtime: number }[] = []
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue
    const id = name.slice(0, -'.jsonl'.length)
    if (!id) continue
    const filePath = join(dir, name)
    const meta = await parseSessionMeta(filePath, id)
    let mtime = 0
    try {
      const st = await fs.stat(filePath)
      mtime = st.mtimeMs
    } catch {
      /* fallback to 0 */
    }
    meta.lastActivityMs = mtime
    items.push({ meta, mtime })
  }
  // Sort by file mtime descending — most recently used at the top.
  // This handles resumed sessions correctly: an old session resumed today
  // floats up, instead of being stuck at its original startedAt position.
  items.sort((a, b) => b.mtime - a.mtime)
  return items.map((x) => x.meta)
}

async function deleteSession(cwd: string, sessionId: string): Promise<void> {
  const dir = projectDir(cwd)
  const file = join(dir, `${sessionId}.jsonl`)
  try {
    await fs.unlink(file)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}

async function readSession(cwd: string, sessionId: string): Promise<unknown[]> {
  const dir = projectDir(cwd)
  const file = join(dir, `${sessionId}.jsonl`)
  const events: unknown[] = []
  try {
    const stream = createReadStream(file, { encoding: 'utf-8' })
    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    for await (const line of rl) {
      if (!line.trim()) continue
      try {
        events.push(JSON.parse(line))
      } catch {
        /* skip invalid line */
      }
    }
    rl.close()
    stream.destroy()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  return events
}

interface ReadFromResult {
  events: unknown[]
  newOffset: number
  truncated: boolean
}

interface ReadTailResult {
  events: unknown[]
  newOffset: number
  totalLines: number
  skippedLines: number
}

async function readSessionRange(
  cwd: string,
  sessionId: string,
  startLine: number,
  endLine: number
): Promise<{ events: unknown[] }> {
  const file = join(projectDir(cwd), `${sessionId}.jsonl`)
  const events: unknown[] = []
  if (endLine <= startLine) return { events }
  try {
    const stream = createReadStream(file, { encoding: 'utf-8' })
    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    let total = 0
    for await (const line of rl) {
      if (!line.trim()) continue
      if (total >= endLine) break
      if (total >= startLine) {
        try {
          events.push(JSON.parse(line))
        } catch {
          /* skip */
        }
      }
      total++
    }
    rl.close()
    stream.destroy()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { events: [] }
    throw err
  }
  return { events }
}

async function readSessionTail(
  cwd: string,
  sessionId: string,
  tailLines: number
): Promise<ReadTailResult> {
  const file = join(projectDir(cwd), `${sessionId}.jsonl`)
  let stat
  try {
    stat = await fs.stat(file)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { events: [], newOffset: 0, totalLines: 0, skippedLines: 0 }
    }
    throw err
  }
  const ring: string[] = new Array(tailLines)
  let writeIdx = 0
  let total = 0
  const stream = createReadStream(file, { encoding: 'utf-8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.trim()) continue
    ring[writeIdx % tailLines] = line
    writeIdx++
    total++
  }
  rl.close()
  stream.destroy()
  const start = Math.max(0, writeIdx - tailLines)
  const events: unknown[] = []
  for (let i = start; i < writeIdx; i++) {
    try {
      events.push(JSON.parse(ring[i % tailLines]))
    } catch {
      /* skip */
    }
  }
  return {
    events,
    newOffset: stat.size,
    totalLines: total,
    skippedLines: Math.max(0, total - tailLines)
  }
}

async function readSessionFromOffset(
  cwd: string,
  sessionId: string,
  fromOffset: number
): Promise<ReadFromResult> {
  const file = join(projectDir(cwd), `${sessionId}.jsonl`)
  let stat
  try {
    stat = await fs.stat(file)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { events: [], newOffset: 0, truncated: true }
    }
    throw err
  }
  if (fromOffset > stat.size) {
    // file shrank or was rewritten; signal full reload
    return { events: [], newOffset: 0, truncated: true }
  }
  if (fromOffset === stat.size) {
    return { events: [], newOffset: stat.size, truncated: false }
  }
  const stream = createReadStream(file, { encoding: 'utf-8', start: fromOffset })
  let buffer = ''
  for await (const chunk of stream) buffer += chunk
  // Only consume up to the last complete line; keep any trailing partial line for
  // the next read so we don't lose data when a writer is mid-append.
  const lastNewline = buffer.lastIndexOf('\n')
  const completePart = lastNewline >= 0 ? buffer.slice(0, lastNewline + 1) : ''
  const events: unknown[] = []
  if (completePart) {
    for (const line of completePart.split('\n')) {
      if (!line.trim()) continue
      try {
        events.push(JSON.parse(line))
      } catch {
        /* skip */
      }
    }
  }
  const consumedBytes = Buffer.byteLength(completePart, 'utf-8')
  return { events, newOffset: fromOffset + consumedBytes, truncated: false }
}

interface WatchEntry {
  watcher: FSWatcher
  sender: WebContents
  debounceTimer: NodeJS.Timeout | null
}

const watches = new Map<string, WatchEntry>()

function watchKey(senderId: number, sessionId: string): string {
  return `${senderId}::${sessionId}`
}

function stopWatch(key: string): void {
  const entry = watches.get(key)
  if (!entry) return
  if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
  try {
    entry.watcher.close()
  } catch {
    /* ignore */
  }
  watches.delete(key)
}

function startWatch(sender: WebContents, cwd: string, sessionId: string): void {
  const key = watchKey(sender.id, sessionId)
  stopWatch(key)
  // 'interactive' 백엔드의 새 세션처럼 jsonl 이 아직 없는 상태에서도 watch 가 가능
  // 해야 한다. 파일을 직접 watch 하면 ENOENT 로 실패하므로 디렉토리를 watch 하고
  // filename 으로 필터링한다 — 어차피 fs.watch 가 파일 replace (truncate/recreate)
  // 시 끊어지는 문제도 디렉토리 watch 가 더 견디므로 양쪽에 robust.
  const dir = projectDir(cwd)
  const targetFileName = `${sessionId}.jsonl`
  try {
    fsMkdir(dir, { recursive: true }, () => {
      /* ignore — projectDir 가 이미 있으면 OK, 만들기 실패해도 watch 시도 자체는 진행 */
    })
  } catch {
    /* ignore */
  }
  let watcher: FSWatcher
  try {
    watcher = fsWatch(dir, { persistent: false })
  } catch (err) {
    console.error('watch start failed:', err)
    return
  }
  const entry: WatchEntry = { watcher, sender, debounceTimer: null }
  watches.set(key, entry)

  const channel = `claude:session-changed:${sessionId}`
  watcher.on('change', (_event, filename) => {
    // 디렉토리에 다른 세션 jsonl 변경도 fire 되므로 우리가 보는 파일만 필터.
    // Windows/Linux/macOS 모두 non-recursive watch 에선 filename 이 들어오는 게
    // 일반적이지만, null 이면 (안 들어오면) 보수적으로 fire.
    if (filename && filename !== targetFileName) return
    if (sender.isDestroyed()) {
      stopWatch(key)
      return
    }
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
    entry.debounceTimer = setTimeout(() => {
      entry.debounceTimer = null
      if (!sender.isDestroyed()) sender.send(channel)
    }, 150)
  })
  watcher.on('error', (err) => {
    console.error('watch error:', err)
    stopWatch(key)
  })
  sender.once('destroyed', () => stopWatch(key))
}

export function registerClaudeHandlers(): void {
  ipcMain.handle('claude:list-sessions', async (_, cwd: string) => listSessions(cwd))
  ipcMain.handle('claude:delete-session', async (_, cwd: string, sessionId: string) => {
    await deleteSession(cwd, sessionId)
  })
  ipcMain.handle('claude:read-session', async (_, cwd: string, sessionId: string) =>
    readSession(cwd, sessionId)
  )
  ipcMain.handle(
    'claude:read-session-from',
    async (_, cwd: string, sessionId: string, fromOffset: number) =>
      readSessionFromOffset(cwd, sessionId, fromOffset)
  )
  ipcMain.handle(
    'claude:read-session-tail',
    async (_, cwd: string, sessionId: string, tailLines: number) =>
      readSessionTail(cwd, sessionId, tailLines)
  )
  ipcMain.handle(
    'claude:read-session-range',
    async (_, cwd: string, sessionId: string, startLine: number, endLine: number) =>
      readSessionRange(cwd, sessionId, startLine, endLine)
  )
  ipcMain.handle('claude:watch-session', (event, cwd: string, sessionId: string) => {
    startWatch(event.sender, cwd, sessionId)
  })
  ipcMain.handle('claude:unwatch-session', (event, sessionId: string) => {
    stopWatch(watchKey(event.sender.id, sessionId))
  })
}

export function killAllClaudeWatches(): void {
  for (const key of Array.from(watches.keys())) stopWatch(key)
}
