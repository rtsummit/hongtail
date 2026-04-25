import type { Block } from './types'

export interface TodoTask {
  id: string
  subject: string
  activeForm?: string
  status: 'pending' | 'in_progress' | 'completed'
}

export interface TodoState {
  tasks: TodoTask[]
  done: number
  inProgress: number
  pending: number
}

interface ToolUseBlock {
  kind: 'tool-use'
  toolUseId: string
  name: string
  input: unknown
}
interface ToolResultBlock {
  kind: 'tool-result'
  toolUseId: string
  content: unknown
  isError?: boolean
}

function isToolUse(b: Block): b is ToolUseBlock {
  return b.kind === 'tool-use'
}
function isToolResult(b: Block): b is ToolResultBlock {
  return b.kind === 'tool-result'
}

function resultText(r: ToolResultBlock): string {
  const c = r.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return c
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'text' in item) {
          return String((item as { text: unknown }).text ?? '')
        }
        return ''
      })
      .join('\n')
  }
  return ''
}

const CREATE_ID_RE = /Task\s+#(\d+)\s+created/i

export function extractTodoState(blocks: Block[]): TodoState {
  const resultByUseId = new Map<string, ToolResultBlock>()
  for (const b of blocks) {
    if (isToolResult(b) && b.toolUseId) resultByUseId.set(b.toolUseId, b)
  }

  const taskMap = new Map<string, TodoTask>()
  for (const b of blocks) {
    if (!isToolUse(b)) continue
    const input = (b.input ?? {}) as Record<string, unknown>
    if (b.name === 'TaskCreate') {
      const result = b.toolUseId ? resultByUseId.get(b.toolUseId) : undefined
      if (!result) continue
      const m = CREATE_ID_RE.exec(resultText(result))
      if (!m) continue
      const id = m[1]
      taskMap.set(id, {
        id,
        subject: typeof input.subject === 'string' ? input.subject : '(unnamed)',
        activeForm: typeof input.activeForm === 'string' ? input.activeForm : undefined,
        status: 'pending'
      })
    } else if (b.name === 'TaskUpdate') {
      const id = typeof input.taskId === 'string' ? input.taskId : String(input.taskId ?? '')
      const t = taskMap.get(id)
      if (!t) continue
      const status = input.status
      if (status === 'pending' || status === 'in_progress' || status === 'completed') {
        t.status = status
      }
      // status === 'deleted' or anything else → drop
      if (status === 'deleted') taskMap.delete(id)
    }
  }

  const tasks = Array.from(taskMap.values())
  let done = 0
  let inProgress = 0
  let pending = 0
  for (const t of tasks) {
    if (t.status === 'completed') done++
    else if (t.status === 'in_progress') inProgress++
    else pending++
  }
  return { tasks, done, inProgress, pending }
}
