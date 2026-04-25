export interface SelectedSession {
  workspacePath: string
  sessionId: string
  title: string
  isNew?: boolean
}

export type Block =
  | { kind: 'user-text'; text: string }
  | { kind: 'assistant-text'; text: string }
  | { kind: 'tool-use'; toolUseId: string; name: string; input: unknown }
  | { kind: 'tool-result'; toolUseId: string; content: unknown; isError?: boolean }
  | { kind: 'system'; text: string }
  | { kind: 'error'; text: string }

export type { ClaudeSessionMeta } from '../../preload/index.d'
