import { ipcMain } from 'electron'
import { homedir } from 'os'
import { promises as fsp } from 'fs'
import { join } from 'path'

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

export function registerUsageCacheHandlers(): void {
  ipcMain.handle('usage:get', async () => {
    return await readUsage()
  })
}
