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

export interface SessionStatus {
  thinking: boolean
  turnStart?: number
  verb?: string
  outputTokens?: number
  usage?: Usage
}

export interface LiveSessionInfo {
  sessionId: string
  title: string
  backend: Backend
  isNew: boolean
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

export type { ClaudeSessionMeta } from '../../preload/index.d'
