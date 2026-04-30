// Backend 종류:
// - 'app'      : claude `-p` + stream-json (기본, 모바일 remote 불가)
// - 'terminal' : node-pty 안에서 `claude` 인터랙티브 띄우고 xterm 으로 raw 렌더
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

// Phase 1.2 — 자식이 보낸 incoming control_request (subtype:'can_use_tool') 의
// interactive deferred tool 두 종을 호스트 UI 카드로 렌더하기 위한 Block. 사용자
// 응답은 App.tsx 의 핸들러가 control_response 로 변환해 stdin 으로 회신
// (docs/host-confirm-ui-plan.md §11.3). resolved 가 true 면 카드는 disable.
//
// AskUserQuestion 은 questions 배열 — 각 질문에 multiSelect 여부 + options.
// answers 는 question(또는 header) 키로 사용자 선택 라벨 매핑.
//
// ExitPlanMode 의 plan 은 markdown 텍스트. resolved: 'approve' 면 빈 updatedInput
// 으로 allow 회신 (자식이 원본 input 사용), 'deny' 면 behavior:'deny' + message.
export interface AskUserQuestionDef {
  question: string
  header: string
  multiSelect?: boolean
  options: Array<{ label: string; description?: string }>
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
  | {
      kind: 'ask-user-question'
      requestId: string
      toolUseId?: string
      questions: AskUserQuestionDef[]
      resolved?: { answers: Record<string, string | string[]> } | { cancelled: true }
    }
  | {
      kind: 'exit-plan-mode'
      requestId: string
      toolUseId?: string
      plan: string
      planFilePath?: string
      resolved?: 'approve' | 'deny'
    }

export type { ClaudeSessionMeta, WorkspaceEntry } from '../../preload/index.d'
