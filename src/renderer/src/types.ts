// Backend 종류:
// - 'app'         : claude `-p` + stream-json (기존, 모바일 remote 불가)
// - 'terminal'    : node-pty 안에서 `claude` 인터랙티브 띄우고 xterm 으로 raw 렌더
// - 'interactive' : 'terminal' 과 같은 PTY (인터랙티브 claude) 를 띄우되, chat UI 는
//                   jsonl tail 로 그림. 모바일 remote 가능 + 'app' 의 GUI.
//                   docs/interactive-jsonl-tail.md 참조.
export type Backend = 'app' | 'terminal' | 'interactive'
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
