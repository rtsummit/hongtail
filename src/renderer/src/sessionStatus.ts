import type { Usage } from './types'

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
