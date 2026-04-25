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
  isMeta?: boolean
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
      if (event.isMeta) return []
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

function processUserText(text: string): Block[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  const cmdNameMatch = trimmed.match(/<command-name>\s*([\s\S]*?)\s*<\/command-name>/)
  if (cmdNameMatch) {
    const name = cmdNameMatch[1].trim() || 'command'
    const argsMatch = trimmed.match(/<command-args>\s*([\s\S]*?)\s*<\/command-args>/)
    const messageMatch = trimmed.match(/<command-message>\s*([\s\S]*?)\s*<\/command-message>/)
    const args = argsMatch?.[1]?.trim() || undefined
    const message = messageMatch?.[1]?.trim() || undefined
    return [{ kind: 'command-invoke', name, args, message }]
  }

  const localOutMatch = trimmed.match(
    /<local-command-(stdout|stderr)>([\s\S]*?)<\/local-command-\1>/
  )
  if (localOutMatch) {
    const stream = localOutMatch[1] as 'stdout' | 'stderr'
    const out = localOutMatch[2]
    if (!out.trim()) return []
    return [{ kind: 'command-output', stream, text: out }]
  }

  if (
    trimmed.startsWith('<system-reminder>') ||
    trimmed.startsWith('<local-command-caveat>') ||
    trimmed.startsWith('<command-message>') ||
    trimmed.startsWith('<command-args>') ||
    trimmed.startsWith('<task-notification>')
  ) {
    return []
  }

  if (trimmed === '[Request interrupted by user]') {
    return [{ kind: 'system', text: '— 중단됨 —' }]
  }

  return [{ kind: 'user-text', text }]
}

function parseMessageContent(
  content: ContentBlock[] | string | undefined,
  role: 'assistant' | 'user'
): Block[] {
  if (!content) return []
  if (typeof content === 'string') {
    if (role === 'user') return processUserText(content)
    return [{ kind: 'assistant-text', text: content }]
  }
  const blocks: Block[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') {
      if (role === 'user') {
        blocks.push(...processUserText(block.text))
      } else {
        blocks.push({ kind: 'assistant-text', text: block.text })
      }
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
