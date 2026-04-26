export type Backend = 'app' | 'terminal'
export type SessionMode = 'readonly' | 'new' | 'resume-full' | 'resume-summary'

export interface SelectedSession {
  workspacePath: string
  sessionId: string
  title: string
  mode: SessionMode
  backend?: Backend
}

export interface Usage {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
}

export interface RateLimitInfo {
  status: string // 'allowed' | 'warned' | 'rejected' | etc
  resetsAt?: number // unix seconds
  rateLimitType?: string // 'five_hour' | etc
  isUsingOverage?: boolean
  overageStatus?: string
}

export interface SessionStatus {
  thinking: boolean
  turnStart?: number
  verb?: string
  outputTokens?: number
  usage?: Usage
  rateLimit?: RateLimitInfo
  model?: string // raw model id, e.g. "claude-opus-4-7[1m]"
  permissionMode?: string // 'default' | 'auto' | 'plan' | 'bypassPermissions' | ...
  contextWindow?: number // tokens, e.g. 1_000_000
  contextUsedTokens?: number // last turn's input + cache_read + cache_creation
  // Cumulative usage for the current session (sum of `result` events).
  // Includes sub-agent activity since `result.usage` is the whole turn.
  sessionInputTokens?: number
  sessionCacheTokens?: number // cache_read + cache_creation
  sessionOutputTokens?: number
  sessionCostUsd?: number
}

export interface LiveSessionInfo {
  sessionId: string
  title: string
  backend: Backend
  isNew: boolean
  hasUserMessage: boolean
}

export type Block =
  | { kind: 'user-text'; text: string }
  | { kind: 'assistant-text'; text: string }
  | { kind: 'tool-use'; toolUseId: string; name: string; input: unknown }
  | { kind: 'tool-result'; toolUseId: string; content: unknown; isError?: boolean }
  | { kind: 'command-invoke'; name: string; args?: string; message?: string }
  | { kind: 'command-output'; stream: 'stdout' | 'stderr'; text: string }
  | { kind: 'system'; text: string }
  | { kind: 'error'; text: string }

export type { ClaudeSessionMeta, WorkspaceEntry } from '../../preload/index.d'
