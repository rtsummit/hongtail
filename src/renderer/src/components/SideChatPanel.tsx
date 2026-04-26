import { useEffect, useRef, useState } from 'react'
import MessageList from './MessageList'
import type { Block } from '../types'

interface Props {
  enabled: boolean
  messages: Block[]
  thinking: boolean
  collapsed: boolean
  onToggleCollapse: () => void
  onAsk: (text: string) => void
  onCancel: () => void
  onClear: () => void
}

function SideChatPanel({
  enabled,
  messages,
  thinking,
  collapsed,
  onToggleCollapse,
  onAsk,
  onCancel,
  onClear
}: Props): React.JSX.Element {
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages.length, thinking])

  if (collapsed) {
    return (
      <div className="side-chat-collapsed">
        <button
          type="button"
          className="side-chat-collapsed-toggle"
          onClick={onToggleCollapse}
          title="BTW 사이드 챗 펼치기"
        >
          ◀
        </button>
        <div className="side-chat-collapsed-label">BTW</div>
      </div>
    )
  }

  const handleSend = (): void => {
    const text = input.trim()
    if (!text || !enabled || thinking) return
    setInput('')
    onAsk(text)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="side-chat-panel">
      <div className="side-chat-header">
        <div className="side-chat-title">
          <span className="side-chat-badge">BTW</span>
          <span className="side-chat-subtitle">메인 작업을 멈추지 않는 사이드 질문</span>
        </div>
        <div className="side-chat-actions">
          <button
            type="button"
            className="side-chat-btn"
            onClick={onClear}
            disabled={messages.length === 0 && !thinking}
            title="대화 비우기"
          >
            지우기
          </button>
          <button
            type="button"
            className="side-chat-btn"
            onClick={onToggleCollapse}
            title="패널 접기"
          >
            ▶
          </button>
        </div>
      </div>

      <div className="side-chat-messages" ref={scrollRef}>
        {!enabled && (
          <div className="side-chat-empty">
            메인 세션을 선택하면 그 컨텍스트로 BTW 질문을 할 수 있습니다.
          </div>
        )}
        {enabled && messages.length === 0 && !thinking && (
          <div className="side-chat-empty">
            도구 없이, 메인 대화 컨텍스트만 보고 답하는 사이드 채팅입니다.
            <br />
            메인 작업을 방해하지 않고 자유롭게 질문하세요.
          </div>
        )}
        <MessageList blocks={messages} />
        {thinking && <div className="side-chat-thinking">생각 중…</div>}
      </div>

      <div className="side-chat-input-wrap">
        <textarea
          ref={taRef}
          className="side-chat-input"
          placeholder={enabled ? 'BTW 질문 (Enter 전송)' : '메인 세션을 먼저 선택하세요'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!enabled}
          rows={2}
        />
        <div className="side-chat-input-actions">
          {thinking ? (
            <button type="button" className="side-chat-send cancel" onClick={onCancel}>
              중단
            </button>
          ) : (
            <button
              type="button"
              className="side-chat-send"
              onClick={handleSend}
              disabled={!enabled || !input.trim()}
            >
              보내기
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default SideChatPanel
