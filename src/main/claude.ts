import { ipcMain } from 'electron'
import { promises as fs, createReadStream } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { createInterface } from 'readline'

export interface ClaudeSessionMeta {
  id: string
  title: string
  startedAt: string
}

function encodeCwd(path: string): string {
  return path.replace(/[\\/:]/g, '-')
}

function projectDir(cwd: string): string {
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
  return { id, title, startedAt }
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
  const sessions: ClaudeSessionMeta[] = []
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue
    const id = name.slice(0, -'.jsonl'.length)
    if (!id) continue
    sessions.push(await parseSessionMeta(join(dir, name), id))
  }
  sessions.sort((a, b) => (b.startedAt > a.startedAt ? 1 : b.startedAt < a.startedAt ? -1 : 0))
  return sessions
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

export function registerClaudeHandlers(): void {
  ipcMain.handle('claude:list-sessions', async (_, cwd: string) => listSessions(cwd))
  ipcMain.handle('claude:delete-session', async (_, cwd: string, sessionId: string) => {
    await deleteSession(cwd, sessionId)
  })
}
