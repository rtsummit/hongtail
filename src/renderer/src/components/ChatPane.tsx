import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import MessageList from './MessageList'
import ThinkingIndicator from './ThinkingIndicator'
import { parseClaudeEvent } from '../claudeEvents'
import { formatTokens } from '../sessionStatus'
import type { AppSettings } from '../settings'
import type { Block, SelectedSession, SessionMode, SessionStatus } from '../types'

interface Props {
  selected: SelectedSession | null
  messages: Block[]
  status?: SessionStatus
  settings: AppSettings
  onAppendBlocks: (sessionId: string, blocks: Block[]) => void
  onReplaceBlocks: (sessionId: string, blocks: Block[]) => void
  onPrependBlocks: (sessionId: string, blocks: Block[]) => void
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
  settings,
  onAppendBlocks,
  onReplaceBlocks,
  onPrependBlocks,
  onActivate,
  onTurnStart
}: Props): React.JSX.Element {
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [shownFromLine, setShownFromLine] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const prependScrollHeightRef = useRef<number | null>(null)
  const loadingMoreRef = useRef(false)
  const shownFromLineRef = useRef(0)
  const sessionContextRef = useRef<{ sessionId: string; workspacePath: string } | null>(null)
  const forceScrollBottomRef = useRef(false)

  const mode = selected?.mode ?? 'readonly'
  const live = selected ? isLiveMode(selected.mode) : false

  shownFromLineRef.current = shownFromLine

  // When the selected session changes, the next message-set should snap to bottom.
  useEffect(() => {
    forceScrollBottomRef.current = true
  }, [selected?.sessionId])

  // After prepend: keep visual scroll position. Layout effect runs before paint.
  useLayoutEffect(() => {
    if (prependScrollHeightRef.current != null && scrollRef.current) {
      const newH = scrollRef.current.scrollHeight
      const delta = newH - prependScrollHeightRef.current
      scrollRef.current.scrollTop += delta
    }
  }, [messages.length])

  // After fresh load or while user is near bottom, snap to bottom. Skip on prepend.
  useEffect(() => {
    if (prependScrollHeightRef.current != null) {
      prependScrollHeightRef.current = null
      return
    }
    const el = scrollRef.current
    if (!el) return
    if (forceScrollBottomRef.current) {
      el.scrollTop = el.scrollHeight
      forceScrollBottomRef.current = false
      return
    }
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (atBottom) el.scrollTop = el.scrollHeight
  }, [messages.length, status?.thinking])

  const chunkSize = settings.readonlyChunkSize

  useEffect(() => {
    if (!selected) return
    if (selected.mode !== 'readonly') return
    const sessionId = selected.sessionId
    const workspacePath = selected.workspacePath
    sessionContextRef.current = { sessionId, workspacePath }
    let cancelled = false
    let offset = 0

    const fullReload = async (): Promise<void> => {
      try {
        const { events, newOffset, totalLines } =
          await window.api.claude.readSessionTail(workspacePath, sessionId, chunkSize)
        if (cancelled) return
        const blocks: Block[] = []
        for (const e of events) blocks.push(...parseClaudeEvent(e))
        offset = newOffset
        const firstShown = Math.max(0, totalLines - chunkSize)
        setShownFromLine(firstShown)
        shownFromLineRef.current = firstShown
        onReplaceBlocks(sessionId, blocks)
      } catch (err) {
        if (cancelled) return
        onReplaceBlocks(sessionId, [
          { kind: 'error', text: `JSONL 로드 실패: ${String(err)}` }
        ])
      }
    }

    const incremental = async (): Promise<void> => {
      try {
        const { events, newOffset, truncated } = await window.api.claude.readSessionFrom(
          workspacePath,
          sessionId,
          offset
        )
        if (cancelled) return
        if (truncated) {
          await fullReload()
          return
        }
        if (events.length === 0) {
          offset = newOffset
          return
        }
        const newBlocks: Block[] = []
        for (const e of events) newBlocks.push(...parseClaudeEvent(e))
        offset = newOffset
        if (newBlocks.length > 0) onAppendBlocks(sessionId, newBlocks)
      } catch (err) {
        console.error('incremental read failed:', err)
      }
    }

    void fullReload()
    void window.api.claude.watchSession(workspacePath, sessionId)
    const unsubscribe = window.api.claude.onSessionChanged(sessionId, () => {
      void incremental()
    })

    return () => {
      cancelled = true
      unsubscribe()
      void window.api.claude.unwatchSession(sessionId)
    }
  }, [selected, onReplaceBlocks, onAppendBlocks, chunkSize])

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return
    if (shownFromLineRef.current <= 0) return
    const ctx = sessionContextRef.current
    if (!ctx) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    const target = Math.max(0, shownFromLineRef.current - chunkSize)
    try {
      const { events } = await window.api.claude.readSessionRange(
        ctx.workspacePath,
        ctx.sessionId,
        target,
        shownFromLineRef.current
      )
      const blocks: Block[] = []
      for (const e of events) blocks.push(...parseClaudeEvent(e))
      if (blocks.length > 0 && scrollRef.current) {
        prependScrollHeightRef.current = scrollRef.current.scrollHeight
        onPrependBlocks(ctx.sessionId, blocks)
      }
      setShownFromLine(target)
      shownFromLineRef.current = target
    } catch (err) {
      console.error('load more failed:', err)
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [onPrependBlocks, chunkSize])

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    if (scrollRef.current.scrollTop < 80) {
      void loadMore()
    }
  }, [loadMore])

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

      <div className="chat-messages" ref={scrollRef} onScroll={handleScroll}>
        {selected.mode === 'readonly' && shownFromLine > 0 && (
          <div className="load-more-indicator">
            {loadingMore
              ? `이전 메시지 로드 중…`
              : `위로 스크롤하면 이전 ${shownFromLine} 줄을 더 불러옵니다`}
          </div>
        )}
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
