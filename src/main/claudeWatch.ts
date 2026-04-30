// jsonl 파일 변경 watcher. sessionId 하나당 watcher 하나 (idempotent), 변경
// 이벤트는 'claude:session-changed:<sessionId>' 채널로 broadcast 되어 모든
// BrowserWindow + web SSE 가 동일하게 받는다. 디렉토리 watch 후 filename 필터
// 로 fs.watch 의 파일 replace (truncate/recreate) 취약성 회피.
import { mkdir as fsMkdir, watch as fsWatch, type FSWatcher } from 'fs'
import { broadcast } from './dispatch'
import { projectDir } from './claude'

interface WatchEntry {
  watcher: FSWatcher
  debounceTimer: NodeJS.Timeout | null
}

const watches = new Map<string, WatchEntry>()

export function stopWatch(sessionId: string): void {
  const entry = watches.get(sessionId)
  if (!entry) return
  if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
  try {
    entry.watcher.close()
  } catch {
    /* ignore */
  }
  watches.delete(sessionId)
}

export function startWatch(cwd: string, sessionId: string): void {
  if (watches.has(sessionId)) return
  // jsonl 이 아직 없는 상태에서도 watch 가 가능해야 한다. 파일을 직접 watch 하면
  // ENOENT 로 실패하므로 디렉토리를 watch 하고 filename 으로 필터링.
  const dir = projectDir(cwd)
  const targetFileName = `${sessionId}.jsonl`
  try {
    fsMkdir(dir, { recursive: true }, () => {
      /* ignore — projectDir 가 이미 있으면 OK, 실패해도 watch 시도 진행 */
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
  const entry: WatchEntry = { watcher, debounceTimer: null }
  watches.set(sessionId, entry)

  const channel = `claude:session-changed:${sessionId}`
  watcher.on('change', (_event, filename) => {
    // 디렉토리에 다른 세션 jsonl 변경도 fire 되므로 우리가 보는 파일만 필터.
    // non-recursive watch 에선 filename 이 보통 들어오지만, null 이면 보수적으로 fire.
    if (filename && filename !== targetFileName) return
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
    entry.debounceTimer = setTimeout(() => {
      entry.debounceTimer = null
      broadcast(channel)
    }, 150)
  })
  watcher.on('error', (err) => {
    console.error('watch error:', err)
    stopWatch(sessionId)
  })
}

export function killAllClaudeWatches(): void {
  for (const key of Array.from(watches.keys())) stopWatch(key)
}
