import { ipcMain } from 'electron'
import { homedir } from 'os'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'

export interface UsageData {
  planName: string | null
  fiveHour: number | null
  sevenDay: number | null
  fiveHourResetAt: number | null // unix ms
  sevenDayResetAt: number | null
  cachedAt: number
  stale: boolean
  apiError?: string
}

interface CachePayload {
  data?: {
    planName?: string | null
    fiveHour?: number | null
    sevenDay?: number | null
    fiveHourResetAt?: string | null
    sevenDayResetAt?: string | null
    apiError?: string
  }
  lastGoodData?: CachePayload['data']
  timestamp?: number
}

const FRESH_TTL_MS = 5 * 60 * 1000

function cachePath(): string {
  return join(homedir(), '.claude', 'plugins', 'claude-hud', '.usage-cache.json')
}

function parseDate(s: string | null | undefined): number | null {
  if (!s) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : null
}

// In-memory memo keyed by file mtime — avoid re-reading + re-parsing the cache
// file when nothing changed. UsageBar polls this once per second.
type Parsed = Omit<UsageData, 'stale'>
let memo: { mtimeMs: number; parsed: Parsed } | null = null

export async function readUsage(): Promise<UsageData | null> {
  const path = cachePath()

  let mtimeMs: number
  try {
    const st = await fsp.stat(path)
    mtimeMs = st.mtimeMs
  } catch {
    memo = null
    return null
  }

  if (!memo || memo.mtimeMs !== mtimeMs) {
    let raw: string
    try {
      raw = await fsp.readFile(path, 'utf8')
    } catch {
      return null
    }
    let parsedJson: CachePayload
    try {
      parsedJson = JSON.parse(raw)
    } catch {
      return null
    }
    const primary = parsedJson.data
    const useLastGood = primary?.apiError && parsedJson.lastGoodData
    const d = useLastGood ? parsedJson.lastGoodData! : primary
    if (!d) return null
    const cachedAt =
      typeof parsedJson.timestamp === 'number' ? parsedJson.timestamp : 0
    memo = {
      mtimeMs,
      parsed: {
        planName: d.planName ?? null,
        fiveHour: typeof d.fiveHour === 'number' ? d.fiveHour : null,
        sevenDay: typeof d.sevenDay === 'number' ? d.sevenDay : null,
        fiveHourResetAt: parseDate(d.fiveHourResetAt),
        sevenDayResetAt: parseDate(d.sevenDayResetAt),
        cachedAt,
        apiError: primary?.apiError
      }
    }
  }

  return {
    ...memo.parsed,
    stale: Date.now() - memo.parsed.cachedAt > FRESH_TTL_MS
  }
}

// claude-hud's getUsage() honors a 5-minute API cache regardless of how often
// it's called, so triggering more often than FRESH_TTL_MS is harmless — the
// extra calls just no-op against the file cache. We still gate locally to
// avoid spawning an in-process module re-import on every turn.
let refreshInFlight = false

async function findLatestUsageApi(): Promise<string | null> {
  const baseDir = join(homedir(), '.claude', 'plugins', 'cache', 'claude-hud', 'claude-hud')
  let entries: string[]
  try {
    entries = await fsp.readdir(baseDir)
  } catch {
    return null
  }
  const versions = entries
    .map((name) => ({ name, parts: name.split('.').map((p) => parseInt(p, 10)) }))
    .filter((v) => v.parts.length > 0 && v.parts.every((n) => Number.isFinite(n)))
    .sort((a, b) => {
      const len = Math.max(a.parts.length, b.parts.length)
      for (let i = 0; i < len; i++) {
        const av = a.parts[i] ?? 0
        const bv = b.parts[i] ?? 0
        if (av !== bv) return bv - av
      }
      return 0
    })
  if (versions.length === 0) return null
  const candidate = join(baseDir, versions[0].name, 'dist', 'usage-api.js')
  try {
    await fsp.access(candidate)
    return candidate
  } catch {
    return null
  }
}

interface UsageApiModule {
  clearCache?: (homeDir: string) => void
  getUsage?: (overrides?: unknown) => Promise<unknown>
}

/**
 * Triggered by stream-json `result` / `rate_limit_event` events. Forces
 * claude-hud's usage-api.js to re-fetch the OAuth quota when our cache is
 * older than FRESH_TTL_MS. claude-hud is the only writer of the cache file,
 * so we delegate to its module to keep the schema (lastGoodData, rate-limit
 * backoff, etc.) consistent.
 */
export function refreshUsageCacheIfStale(): void {
  if (refreshInFlight) return
  refreshInFlight = true
  void (async () => {
    try {
      try {
        const st = await fsp.stat(cachePath())
        if (Date.now() - st.mtimeMs < FRESH_TTL_MS) return
      } catch {
        // no cache yet — fall through and try to populate it
      }
      const apiPath = await findLatestUsageApi()
      if (!apiPath) return
      const fileUrl = pathToFileURL(apiPath).href
      let mod: UsageApiModule
      try {
        mod = (await import(/* @vite-ignore */ fileUrl)) as UsageApiModule
      } catch {
        return
      }
      try {
        mod.clearCache?.(homedir())
      } catch {
        /* ignore */
      }
      try {
        await mod.getUsage?.()
      } catch {
        /* ignore */
      }
    } finally {
      refreshInFlight = false
    }
  })()
}

export function registerUsageCacheHandlers(): void {
  ipcMain.handle('usage:get', async () => {
    return await readUsage()
  })
}
