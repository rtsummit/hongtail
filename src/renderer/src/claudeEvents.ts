import type { Block } from './types'

interface ContentBlock {
  type: string
  text?: string
  name?: string
  id?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

interface ClaudeEvent {
  type?: string
  subtype?: string
  message?: { role?: string; content?: ContentBlock[] | string }
  data?: string
  raw?: string
  error?: string
  code?: number | null
  result?: string
}

export function parseClaudeEvent(raw: unknown): Block[] {
  const event = raw as ClaudeEvent
  if (!event || typeof event !== 'object') return []

  switch (event.type) {
    case 'assistant':
      return parseMessageContent(event.message?.content, 'assistant')
    case 'user':
      return parseMessageContent(event.message?.content, 'user')
    case 'system':
      // system init/etc — usually verbose, skip in UI for now
      return []
    case 'result':
      if (event.subtype && event.subtype !== 'success') {
        return [{ kind: 'system', text: `Result: ${event.subtype}` }]
      }
      return []
    case 'stderr':
      return [{ kind: 'system', text: `[stderr] ${event.data ?? ''}` }]
    case 'parse_error':
      return [{ kind: 'system', text: `[parse_error] ${event.raw?.slice(0, 200) ?? ''}` }]
    case 'spawn_error':
      return [{ kind: 'error', text: `프로세스 시작 실패: ${event.error}` }]
    case 'closed':
      return [{ kind: 'system', text: `[프로세스 종료 code=${event.code ?? '?'}]` }]
    default:
      return []
  }
}

function parseMessageContent(
  content: ContentBlock[] | string | undefined,
  role: 'assistant' | 'user'
): Block[] {
  if (!content) return []
  if (typeof content === 'string') {
    return [{ kind: role === 'assistant' ? 'assistant-text' : 'user-text', text: content }]
  }
  const blocks: Block[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') {
      blocks.push({
        kind: role === 'assistant' ? 'assistant-text' : 'user-text',
        text: block.text
      })
    } else if (block.type === 'tool_use') {
      blocks.push({
        kind: 'tool-use',
        toolUseId: block.id ?? '',
        name: block.name ?? 'unknown',
        input: block.input
      })
    } else if (block.type === 'tool_result') {
      blocks.push({
        kind: 'tool-result',
        toolUseId: block.tool_use_id ?? '',
        content: block.content,
        isError: block.is_error
      })
    }
  }
  return blocks
}
