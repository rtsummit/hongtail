import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
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
          title={t('sideChat.expandTitle')}
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
          <span className="side-chat-subtitle">{t('sideChat.subtitle')}</span>
        </div>
        <div className="side-chat-actions">
          <button
            type="button"
            className="side-chat-btn"
            onClick={onClear}
            disabled={messages.length === 0 && !thinking}
            title={t('sideChat.clear')}
          >
            {t('sideChat.clear')}
          </button>
          <button
            type="button"
            className="side-chat-btn"
            onClick={onToggleCollapse}
            title={t('sideChat.collapseTitle')}
          >
            ▶
          </button>
        </div>
      </div>

      <div className="side-chat-messages" ref={scrollRef}>
        {!enabled && (
          <div className="side-chat-empty">{t('sideChat.empty.noSession')}</div>
        )}
        {enabled && messages.length === 0 && !thinking && (
          <div className="side-chat-empty" style={{ whiteSpace: 'pre-line' }}>
            {t('sideChat.empty.helper')}
          </div>
        )}
        <MessageList blocks={messages} />
        {thinking && <div className="side-chat-thinking">{t('sideChat.thinking')}</div>}
      </div>

      <div className="side-chat-input-wrap">
        <textarea
          ref={taRef}
          className="side-chat-input"
          placeholder={
            enabled ? t('sideChat.placeholder.enabled') : t('sideChat.placeholder.disabled')
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!enabled}
          rows={2}
        />
        <div className="side-chat-input-actions">
          {thinking ? (
            <button type="button" className="side-chat-send cancel" onClick={onCancel}>
              {t('sideChat.cancel')}
            </button>
          ) : (
            <button
              type="button"
              className="side-chat-send"
              onClick={handleSend}
              disabled={!enabled || !input.trim()}
            >
              {t('sideChat.send')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default SideChatPanel
