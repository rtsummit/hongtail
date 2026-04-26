import type { Block } from './types'

const MAX_CHARS = 80_000

function blockToLine(b: Block): string | null {
  if (b.kind === 'user-text') return `[user]\n${b.text}`
  if (b.kind === 'assistant-text') return `[assistant]\n${b.text}`
  return null
}

function serialize(blocks: Block[]): string {
  const lines: string[] = []
  for (const b of blocks) {
    const line = blockToLine(b)
    if (line) lines.push(line)
  }
  return lines.join('\n\n')
}

function truncateFromHead(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(text.length - max)
  return `[... earlier context truncated ...]\n\n${cut}`
}

export function buildBtwSystemPrompt(
  mainHistory: Block[],
  btwHistory: Block[]
): string {
  const main = serialize(mainHistory)
  const btw = serialize(btwHistory)

  const parts: string[] = [
    'You are a side-question helper. The user is in the middle of a main coding conversation with another agent. Read the conversation snapshot below as read-only context, then answer the user\'s side question briefly and directly.',
    '',
    'You have NO tools available. You cannot read files, run commands, edit code, search the web, or take any other action. Just reason from the context below.',
    '',
    '=== MAIN CONVERSATION SNAPSHOT (read-only) ===',
    main || '(empty)'
  ]

  if (btw.trim().length > 0) {
    parts.push('', '=== PREVIOUS SIDE QUESTIONS ===', btw)
  }

  const full = parts.join('\n')
  return truncateFromHead(full, MAX_CHARS)
}
