import { useCallback, useEffect, useRef, useState } from 'react'
import MessageList from './MessageList'
import ThinkingIndicator from './ThinkingIndicator'
import { parseClaudeEvent } from '../claudeEvents'
import { formatTokens } from '../sessionStatus'
import type { Block, SelectedSession, SessionMode, SessionStatus } from '../types'

interface Props {
  selected: SelectedSession | null
  messages: Block[]
  status?: SessionStatus
  onAppendBlocks: (sessionId: string, blocks: Block[]) => void
  onReplaceBlocks: (sessionId: string, blocks: Block[]) => void
  onActivate: (mode: 'resume-full' | 'resume-summary') => void
  onTurnStart: (sessionId: string) => void
}

function isLiveMode(mode: SessionMode): boolean {
  return mode === 'new' || mode === 'resume-full' || mode === 'resume-summary'
}

function ChatPane({
  selected,
  messages,
  status,
  onAppendBlocks,
  onReplaceBlocks,
  onActivate,
  onTurnStart
}: Props): React.JSX.Element {
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const mode = selected?.mode ?? 'readonly'
  const live = selected ? isLiveMode(selected.mode) : false

  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages.length, status?.thinking])

  useEffect(() => {
    if (!selected) return
    if (selected.mode !== 'readonly') return
    const sessionId = selected.sessionId
    let cancelled = false
    window.api.claude
      .readSession(selected.workspacePath, sessionId)
      .then((events) => {
        if (cancelled) return
        const blocks: Block[] = []
        for (const event of events) blocks.push(...parseClaudeEvent(event))
        onReplaceBlocks(sessionId, blocks)
      })
      .catch((err) => {
        if (cancelled) return
        onReplaceBlocks(sessionId, [
          { kind: 'error', text: `JSONL 로드 실패: ${String(err)}` }
        ])
      })
    return () => {
      cancelled = true
    }
  }, [selected, onReplaceBlocks])

  const handleSend = useCallback(async () => {
    if (!selected || !input.trim() || sending || !live) return
    const text = input
    setInput('')
    setSending(true)
    onAppendBlocks(selected.sessionId, [{ kind: 'user-text', text }])
    onTurnStart(selected.sessionId)
    try {
      await window.api.claude.sendInput(selected.sessionId, text)
    } catch (err) {
      onAppendBlocks(selected.sessionId, [
        { kind: 'error', text: `전송 실패: ${String(err)}` }
      ])
    } finally {
      setSending(false)
    }
  }, [selected, input, sending, live, onAppendBlocks, onTurnStart])

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
          <p>워크스페이스의 "+ 새로운 대화" 로 시작하세요</p>
        </div>
      </main>
    )
  }

  const subtitleSuffix =
    mode === 'readonly'
      ? '읽기 전용'
      : mode === 'new'
        ? 'new · live'
        : mode === 'resume-full'
          ? 'resume (full) · live'
          : 'resume (summary) · live'

  const lastUsage = status?.usage
  const usageLine =
    !status?.thinking && lastUsage?.outputTokens
      ? `↓ ${formatTokens(lastUsage.outputTokens)} tokens${lastUsage.inputTokens ? ` · ↑ ${formatTokens(lastUsage.inputTokens)}` : ''}`
      : null

  return (
    <main className="chat-pane">
      <div className="chat-header">
        <div className="chat-title">{selected.title}</div>
        <div className="chat-subtitle">
          {selected.workspacePath} · {selected.sessionId.slice(0, 8)} · {subtitleSuffix}
          {usageLine ? ` · ${usageLine}` : ''}
        </div>
      </div>

      <div className="chat-messages" ref={scrollRef}>
        <MessageList blocks={messages} />
        {status?.thinking && (
          <ThinkingIndicator
            verb={status.verb}
            turnStart={status.turnStart}
            outputTokens={status.outputTokens}
          />
        )}
      </div>

      {live ? (
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
      ) : (
        <div className="chat-activate">
          <div className="chat-activate-label">이전 대화 — 읽기 전용</div>
          <div className="chat-activate-buttons">
            <button
              type="button"
              className="activate-btn full"
              onClick={() => onActivate('resume-full')}
            >
              Full로 활성화
            </button>
            <button
              type="button"
              className="activate-btn summary"
              onClick={() => onActivate('resume-summary')}
            >
              Summary로 활성화
            </button>
          </div>
        </div>
      )}
    </main>
  )
}

export default ChatPane
