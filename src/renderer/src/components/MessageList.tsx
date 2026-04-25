import type { Block } from '../types'

interface Props {
  blocks: Block[]
}

function MessageList({ blocks }: Props): React.JSX.Element {
  return (
    <>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </>
  )
}

function BlockView({ block }: { block: Block }): React.JSX.Element | null {
  switch (block.kind) {
    case 'user-text':
      return (
        <div className="bubble user">
          <pre className="bubble-text">{block.text}</pre>
        </div>
      )
    case 'assistant-text':
      return (
        <div className="bubble assistant">
          <pre className="bubble-text">{block.text}</pre>
        </div>
      )
    case 'tool-use':
      return (
        <div className="tool-card">
          <div className="tool-header">
            <span className="tool-icon">🔧</span>
            <span className="tool-name">{block.name}</span>
          </div>
          <pre className="tool-body">{stringify(block.input)}</pre>
        </div>
      )
    case 'tool-result':
      return (
        <div className={`tool-card result${block.isError ? ' error' : ''}`}>
          <div className="tool-header">
            <span className="tool-icon">{block.isError ? '⚠' : '↳'}</span>
            <span className="tool-name">result</span>
          </div>
          <pre className="tool-body">{stringify(block.content)}</pre>
        </div>
      )
    case 'command-invoke':
      return (
        <div className="command-card invoke">
          <div className="command-header">
            <span className="command-icon">▸</span>
            <span className="command-name">{block.name}</span>
            {block.args ? <span className="command-args">{block.args}</span> : null}
          </div>
          {block.message && block.message !== block.name ? (
            <div className="command-message">{block.message}</div>
          ) : null}
        </div>
      )
    case 'command-output':
      return (
        <div className={`command-card output ${block.stream}`}>
          <div className="command-header">
            <span className="command-stream">{block.stream}</span>
          </div>
          <pre className="command-output-text">{block.text}</pre>
        </div>
      )
    case 'system':
      return <div className="system-line">{block.text}</div>
    case 'error':
      return <div className="system-line error">{block.text}</div>
    default:
      return null
  }
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

export default MessageList
