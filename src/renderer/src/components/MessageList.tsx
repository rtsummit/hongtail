import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import ToolBlock from './ToolBlock'
import type { Block } from '../types'

interface Props {
  blocks: Block[]
}

type ToolUseBlock = Extract<Block, { kind: 'tool-use' }>
type ToolResultBlock = Extract<Block, { kind: 'tool-result' }>

interface ToolPairBlock {
  kind: 'tool-pair'
  use: ToolUseBlock
  result?: ToolResultBlock
}

type RenderItem = Exclude<Block, { kind: 'tool-use' } | { kind: 'tool-result' }> | ToolPairBlock

// Internal task-management tools that claude CLI also hides from the user view.
const HIDDEN_TOOLS = new Set([
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'TaskGet',
  'TaskOutput',
  'TaskStop'
])

function pairToolBlocks(blocks: Block[]): RenderItem[] {
  // First pass: index tool-results and collect hidden-tool ids
  const resultById = new Map<string, ToolResultBlock>()
  const hiddenIds = new Set<string>()
  for (const b of blocks) {
    if (b.kind === 'tool-result' && b.toolUseId) {
      resultById.set(b.toolUseId, b)
    }
    if (b.kind === 'tool-use' && b.toolUseId && HIDDEN_TOOLS.has(b.name)) {
      hiddenIds.add(b.toolUseId)
    }
  }
  const consumedResultIds = new Set<string>()
  const out: RenderItem[] = []
  for (const b of blocks) {
    if (b.kind === 'tool-use') {
      if (b.toolUseId && hiddenIds.has(b.toolUseId)) continue
      const result = b.toolUseId ? resultById.get(b.toolUseId) : undefined
      if (result?.toolUseId) consumedResultIds.add(result.toolUseId)
      out.push({ kind: 'tool-pair', use: b, result })
    } else if (b.kind === 'tool-result') {
      if (b.toolUseId && hiddenIds.has(b.toolUseId)) continue
      if (b.toolUseId && consumedResultIds.has(b.toolUseId)) continue
      out.push({ kind: 'tool-pair', use: { kind: 'tool-use', toolUseId: b.toolUseId, name: 'unknown', input: undefined }, result: b })
    } else {
      out.push(b)
    }
  }
  return out
}

function MessageList({ blocks }: Props): React.JSX.Element {
  const items = pairToolBlocks(blocks)
  return (
    <>
      {items.map((b, i) => (
        <ItemView key={i} item={b} />
      ))}
    </>
  )
}

function ItemView({ item }: { item: RenderItem }): React.JSX.Element | null {
  if (item.kind === 'tool-pair') {
    return <ToolBlock use={item.use} result={item.result} />
  }
  switch (item.kind) {
    case 'user-text':
      return (
        <div className="bubble user">
          <pre className="bubble-text">{item.text}</pre>
        </div>
      )
    case 'assistant-text':
      return (
        <div className="bubble assistant">
          <div className="bubble-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown>
          </div>
        </div>
      )
    case 'command-invoke':
      return (
        <div className="command-card invoke">
          <div className="command-header">
            <span className="command-icon">▸</span>
            <span className="command-name">{item.name}</span>
            {item.args ? <span className="command-args">{item.args}</span> : null}
          </div>
          {item.message && item.message !== item.name ? (
            <div className="command-message">{item.message}</div>
          ) : null}
        </div>
      )
    case 'command-output':
      return (
        <div className={`command-card output ${item.stream}`}>
          <div className="command-header">
            <span className="command-stream">{item.stream}</span>
          </div>
          <pre className="command-output-text">{item.text}</pre>
        </div>
      )
    case 'system':
      return <div className="system-line">{item.text}</div>
    case 'error':
      return <div className="system-line error">{item.text}</div>
    default:
      return null
  }
}

export default MessageList
