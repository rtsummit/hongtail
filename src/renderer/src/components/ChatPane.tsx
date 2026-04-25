import { useCallback, useEffect, useRef, useState } from 'react'
import MessageList from './MessageList'
import { parseClaudeEvent } from '../claudeEvents'
import type { Block, SelectedSession } from '../types'

interface Props {
  selected: SelectedSession | null
  messages: Block[]
  onAppendBlocks: (sessionId: string, blocks: Block[]) => void
}

function ChatPane({ selected, messages, onAppendBlocks }: Props): React.JSX.Element {
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [running, setRunning] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll on new messages
  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages.length])

  // Subscribe + start session whenever selection changes
  useEffect(() => {
    if (!selected) {
      setRunning(false)
      return
    }
    const sessionId = selected.sessionId
    const append = (blocks: Block[]): void => onAppendBlocks(sessionId, blocks)

    const unsubscribe = window.api.claude.onEvent(sessionId, (event) => {
      const parsed = parseClaudeEvent(event)
      if (parsed.length > 0) append(parsed)
    })

    window.api.claude
      .startSession(selected.workspacePath, sessionId, selected.isNew ? 'new' : 'resume')
      .then(() => setRunning(true))
      .catch((err) => {
        append([{ kind: 'error', text: `세션 시작 실패: ${String(err)}` }])
      })

    return () => {
      unsubscribe()
      setRunning(false)
    }
  }, [selected, onAppendBlocks])

  const handleSend = useCallback(async () => {
    if (!selected || !input.trim() || sending) return
    const text = input
    setInput('')
    setSending(true)
    onAppendBlocks(selected.sessionId, [{ kind: 'user-text', text }])
    try {
      await window.api.claude.sendInput(selected.sessionId, text)
    } catch (err) {
      onAppendBlocks(selected.sessionId, [
        { kind: 'error', text: `전송 실패: ${String(err)}` }
      ])
    } finally {
      setSending(false)
    }
  }, [selected, input, sending, onAppendBlocks])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void handleSend()
    }
  }

  if (!selected) {
    return (
      <main className="chat-pane">
        <div className="chat-empty">
          <p>워크스페이스를 선택하거나 + 새 세션 으로 시작하세요</p>
        </div>
      </main>
    )
  }

  return (
    <main className="chat-pane">
      <div className="chat-header">
        <div className="chat-title">{selected.title}</div>
        <div className="chat-subtitle">
          {selected.workspacePath} · {selected.sessionId.slice(0, 8)}
          {running ? ' · running' : ''}
        </div>
      </div>

      <div className="chat-messages" ref={scrollRef}>
        <MessageList blocks={messages} />
      </div>

      <div className="chat-input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="메시지 입력 (Enter: 전송, Shift+Enter: 줄바꿈)"
          rows={3}
          disabled={sending}
        />
        <button
          type="button"
          className="send-btn"
          onClick={() => void handleSend()}
          disabled={!input.trim() || sending}
        >
          {sending ? '…' : '전송'}
        </button>
      </div>
    </main>
  )
}

export default ChatPane
