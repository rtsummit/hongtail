import { app, dialog, ipcMain, BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { registerInvoke } from './ipc'

interface WorkspaceEntry {
  path: string
  alias?: string
}

function workspacesFile(): string {
  return join(app.getPath('userData'), 'workspaces.json')
}

// 같은 디렉토리가 OS 다이얼로그(backslash) vs web 텍스트 입력(forward slash)
// 으로 들어와 중복 entry 가 되는 걸 막기 위해 forward slash 표기로 통일.
// encodeCwd 입장에선 둘 다 '-' 로 매핑돼 같은 jsonl 디렉토리를 가리키므로
// 정규화 결과만 안 어긋나면 OK.
function normalizePath(p: string): string {
  let s = p.trim()
  if (!s) return s
  s = s.replace(/\\/g, '/')
  if (/^[a-z]:/.test(s)) s = s[0].toUpperCase() + s.slice(1)
  if (s.length > 3 && s.endsWith('/')) s = s.slice(0, -1)
  return s
}

function dedupe(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  const map = new Map<string, WorkspaceEntry>()
  for (const e of entries) {
    const existing = map.get(e.path)
    if (!existing) {
      map.set(e.path, e)
      continue
    }
    // alias 있는 쪽을 우선 보존
    if (!existing.alias && e.alias) map.set(e.path, e)
  }
  return Array.from(map.values())
}

function normalizeEntry(raw: unknown): WorkspaceEntry | null {
  if (typeof raw === 'string') {
    const p = normalizePath(raw)
    return p ? { path: p } : null
  }
  if (raw && typeof raw === 'object') {
    const o = raw as { path?: unknown; alias?: unknown }
    if (typeof o.path !== 'string') return null
    const p = normalizePath(o.path)
    if (!p) return null
    const entry: WorkspaceEntry = { path: p }
    if (typeof o.alias === 'string' && o.alias.trim()) entry.alias = o.alias
    return entry
  }
  return null
}

async function loadWorkspaces(): Promise<WorkspaceEntry[]> {
  const file = workspacesFile()
  try {
    const content = await fs.readFile(file, 'utf-8')
    if (!content.trim()) return []
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed)) {
      const out: WorkspaceEntry[] = []
      for (const item of parsed) {
        const normalized = normalizeEntry(item)
        if (normalized) out.push(normalized)
      }
      return dedupe(out)
    }
    return []
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

async function saveWorkspaces(entries: WorkspaceEntry[]): Promise<void> {
  // Sanitize: strip empty aliases so we don't persist {"alias": ""}
  const sanitized = entries.map((e) =>
    e.alias && e.alias.trim() ? { path: e.path, alias: e.alias } : { path: e.path }
  )
  await fs.writeFile(workspacesFile(), JSON.stringify(sanitized, null, 2), 'utf-8')
}

export function registerWorkspaceHandlers(): void {
  registerInvoke('workspaces:load', () => loadWorkspaces())

  registerInvoke('workspaces:save', async (entries: unknown) => {
    if (!Array.isArray(entries)) return
    const normalized: WorkspaceEntry[] = []
    for (const item of entries) {
      const e = normalizeEntry(item)
      if (e) normalized.push(e)
    }
    await saveWorkspaces(dedupe(normalized))
  })

  // pick-directory 는 OS 다이얼로그라 web 에서는 의미 무. ipcMain 에만.
  ipcMain.handle('workspaces:pick-directory', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: '대화 디렉터리 선택',
          properties: ['openDirectory']
        })
      : await dialog.showOpenDialog({
          title: '대화 디렉터리 선택',
          properties: ['openDirectory']
        })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
