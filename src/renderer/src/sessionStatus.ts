import type { RateLimitInfo, Usage } from './types'

const VERBS = [
  'Pondering',
  'Cogitating',
  'Brewing',
  'Whirring',
  'Crafting',
  'Wrangling',
  'Stewing',
  'Refining',
  'Iterating',
  'Plotting',
  'Spinning',
  'Marinating',
  'Forging',
  'Conjuring',
  'Synthesizing',
  'Distilling',
  'Architecting',
  'Choreographing',
  'Calibrating',
  'Polishing',
  'Fermenting',
  'Whisking',
  'Crystallizing'
]

export function pickVerb(): string {
  return VERBS[Math.floor(Math.random() * VERBS.length)]
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export function formatElapsed(startMs: number, nowMs: number): string {
  const sec = Math.max(0, Math.floor((nowMs - startMs) / 1000))
  return `${sec}s`
}

interface UsageLike {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export function extractUsage(event: unknown): Usage | null {
  if (!event || typeof event !== 'object') return null
  const e = event as Record<string, unknown>
  // Sub-agent (Task tool) assistant events share the parent's session_id but
  // report their own (small) model usage. Treat them as not-the-user's-turn.
  // `result` events apply to the whole turn and don't carry parent_tool_use_id.
  if (e.type === 'assistant' && e.parent_tool_use_id != null) return null
  const u =
    (e.usage as UsageLike | undefined) ??
    ((e.message as Record<string, unknown> | undefined)?.usage as UsageLike | undefined)
  if (!u || typeof u !== 'object') return null
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens,
    cacheCreationTokens: u.cache_creation_input_tokens
  }
}

export function isResultEvent(event: unknown): boolean {
  if (!event || typeof event !== 'object') return false
  return (event as Record<string, unknown>).type === 'result'
}

// 인터랙티브 백엔드 jsonl 에는 stream-json 의 `result` 이벤트가 없다. turn 종료
// 시그널은 assistant record 의 stop_reason 이 'end_turn' 또는 'stop_sequence'
// 인 것으로 식별. tool_use 는 다음 chunk 가 이어지므로 종료 아님.
export function isAssistantTurnEnd(event: unknown): boolean {
  if (!event || typeof event !== 'object') return false
  const e = event as Record<string, unknown>
  if (e.type !== 'assistant') return false
  if (e.parent_tool_use_id != null) return false
  const isSidechain = e.isSidechain
  if (isSidechain === true) return false
  const msg = e.message as Record<string, unknown> | undefined
  if (!msg) return false
  const sr = msg.stop_reason
  return sr === 'end_turn' || sr === 'stop_sequence'
}

export interface InitInfo {
  model: string
  permissionMode: string
  contextWindow?: number
}

export function extractInit(event: unknown): InitInfo | null {
  if (!event || typeof event !== 'object') return null
  const e = event as Record<string, unknown>
  if (e.type !== 'system' || e.subtype !== 'init') return null
  if (typeof e.model !== 'string') return null
  const model = e.model
  const permissionMode = typeof e.permissionMode === 'string' ? e.permissionMode : 'default'
  return { model, permissionMode, contextWindow: parseContextWindowFromModel(model) }
}

// Fallback: assistant turn events always carry model on message.model.
// Used to populate status.model when the system/init was missed
// (e.g. resume that doesn't re-emit init, or race with subscription setup).
export function extractAssistantModel(event: unknown): string | null {
  if (!event || typeof event !== 'object') return null
  const e = event as Record<string, unknown>
  if (e.type !== 'assistant') return null
  const msg = e.message as Record<string, unknown> | undefined
  if (!msg) return null
  const model = msg.model
  return typeof model === 'string' ? model : null
}

// Some claude versions also emit a separate `permission-mode` event
// (sticky metadata, observed in jsonl). Pick that up too.
export function extractPermissionModeEvent(event: unknown): string | null {
  if (!event || typeof event !== 'object') return null
  const e = event as Record<string, unknown>
  if (e.type !== 'permission-mode') return null
  return typeof e.permissionMode === 'string' ? e.permissionMode : null
}

export function parseContextWindowFromModel(model: string): number | undefined {
  const m = model.match(/\[(\d+)([mk])\]$/i)
  if (!m) return undefined
  const n = Number(m[1])
  if (!Number.isFinite(n)) return undefined
  return m[2].toLowerCase() === 'm' ? n * 1_000_000 : n * 1_000
}

export function formatModelDisplay(model: string): string {
  // claude-opus-4-7[1m] → "Opus 4.7 (1M context)"
  const m = model.match(/^claude-(opus|sonnet|haiku)-(\d+)-(\d+)(\[(\d+[mk])\])?$/i)
  if (!m) return model
  const family = m[1].charAt(0).toUpperCase() + m[1].slice(1)
  const ver = `${m[2]}.${m[3]}`
  const ctx = m[5] ? ` (${m[5].toUpperCase()} context)` : ''
  return `${family} ${ver}${ctx}`
}

export function extractContextTokens(event: unknown): number | null {
  if (!event || typeof event !== 'object') return null
  const e = event as Record<string, unknown>
  if (e.type !== 'assistant') return null
  // Sub-agents emit assistant events with their own (smaller) model usage —
  // counting those would jitter the main session's context bar.
  if (e.parent_tool_use_id != null) return null
  const msg = e.message as Record<string, unknown> | undefined
  const u = msg?.usage as Record<string, unknown> | undefined
  if (!u) return null
  const i = typeof u.input_tokens === 'number' ? u.input_tokens : 0
  const cr = typeof u.cache_read_input_tokens === 'number' ? u.cache_read_input_tokens : 0
  const cc = typeof u.cache_creation_input_tokens === 'number' ? u.cache_creation_input_tokens : 0
  const sum = i + cr + cc
  return sum > 0 ? sum : null
}

export interface ResultTotals {
  inputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  outputTokens: number
  costUsd: number
}

// Sum of one whole turn (main agent + any sub-agents). For session-cumulative tracking.
export function extractResultTotals(event: unknown): ResultTotals | null {
  if (!event || typeof event !== 'object') return null
  const e = event as Record<string, unknown>
  if (e.type !== 'result') return null
  const u = e.usage as Record<string, unknown> | undefined
  if (!u) return null
  return {
    inputTokens: typeof u.input_tokens === 'number' ? u.input_tokens : 0,
    cacheReadTokens:
      typeof u.cache_read_input_tokens === 'number' ? u.cache_read_input_tokens : 0,
    cacheCreationTokens:
      typeof u.cache_creation_input_tokens === 'number' ? u.cache_creation_input_tokens : 0,
    outputTokens: typeof u.output_tokens === 'number' ? u.output_tokens : 0,
    costUsd: typeof e.total_cost_usd === 'number' ? e.total_cost_usd : 0
  }
}

export function extractContextWindowFromResult(
  event: unknown,
  preferredModel?: string
): number | null {
  if (!event || typeof event !== 'object') return null
  const e = event as Record<string, unknown>
  if (e.type !== 'result') return null
  const mu = e.modelUsage as Record<string, unknown> | undefined
  if (!mu) return null
  if (preferredModel && mu[preferredModel]) {
    const w = (mu[preferredModel] as Record<string, unknown>)?.contextWindow
    if (typeof w === 'number' && w > 0) return w
  }
  for (const info of Object.values(mu)) {
    const w = (info as Record<string, unknown>)?.contextWindow
    if (typeof w === 'number' && w > 0) return w
  }
  return null
}

export interface ControlResponse {
  requestId: string
  success: boolean
  error?: string
}

export function extractControlResponse(event: unknown): ControlResponse | null {
  if (!event || typeof event !== 'object') return null
  const e = event as Record<string, unknown>
  if (e.type !== 'control_response') return null
  const r = e.response as Record<string, unknown> | undefined
  if (!r) return null
  const requestId = typeof r.request_id === 'string' ? r.request_id : null
  if (!requestId) return null
  return {
    requestId,
    success: r.subtype === 'success',
    error: typeof r.error === 'string' ? r.error : undefined
  }
}

export function extractRateLimit(event: unknown): RateLimitInfo | null {
  if (!event || typeof event !== 'object') return null
  const e = event as Record<string, unknown>
  if (e.type !== 'rate_limit_event') return null
  const info = e.rate_limit_info as Record<string, unknown> | undefined
  if (!info || typeof info !== 'object') return null
  const status = typeof info.status === 'string' ? info.status : 'unknown'
  return {
    status,
    resetsAt: typeof info.resetsAt === 'number' ? info.resetsAt : undefined,
    rateLimitType: typeof info.rateLimitType === 'string' ? info.rateLimitType : undefined,
    isUsingOverage: typeof info.isUsingOverage === 'boolean' ? info.isUsingOverage : undefined,
    overageStatus: typeof info.overageStatus === 'string' ? info.overageStatus : undefined
  }
}

const WINDOW_LABELS: Record<string, string> = {
  five_hour: '5h',
  one_hour: '1h',
  weekly: '주간'
}

export function formatRateLimit(info: RateLimitInfo, nowMs: number = Date.now()): string {
  const parts: string[] = []
  const win = info.rateLimitType ? (WINDOW_LABELS[info.rateLimitType] ?? info.rateLimitType) : null
  if (win) parts.push(win)
  if (info.resetsAt) {
    const ms = info.resetsAt * 1000 - nowMs
    if (ms > 0) {
      const totalMin = Math.floor(ms / 60000)
      const h = Math.floor(totalMin / 60)
      const m = totalMin % 60
      parts.push(`리셋 ${h > 0 ? `${h}h ${m}m` : `${m}m`}`)
    } else {
      parts.push('리셋됨')
    }
  }
  if (info.status === 'warned') parts.push('⚠ 한도 임박')
  else if (info.status === 'rejected') parts.push('🚫 차단')
  if (info.isUsingOverage) parts.push('overage')
  return parts.join(' · ')
}
