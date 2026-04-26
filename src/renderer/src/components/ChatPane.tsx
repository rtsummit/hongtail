import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import MessageList from './MessageList'
import ThinkingIndicator from './ThinkingIndicator'
import TodoPanel from './TodoPanel'
import QuoteAffordance from './QuoteAffordance'
import QuoteChips, { type Quote } from './QuoteChips'
import SlashCompletion from './SlashCompletion'
import UsageBar from './UsageBar'
import { parseClaudeEvent } from '../claudeEvents'
import { formatRateLimit, formatTokens } from '../sessionStatus'
import { extractTodoState } from '../todoState'
import type { AppSettings } from '../settings'
import type { Block, SelectedSession, SessionMode, SessionStatus } from '../types'
import type { SlashCommand } from '../../../preload/index.d'

interface SlashContext {
  query: string
  start: number
  end: number
}

function getSlashContext(text: string, caret: number): SlashContext | null {
  let start = caret
  while (start > 0) {
    const ch = text[start - 1]
    if (ch === '\n' || ch === ' ' || ch === '\t') break
    start--
  }
  if (start > 0 && text[start - 1] !== '\n') return null
  if (text[start] !== '/') return null
  let end = caret
  while (end < text.length) {
    const ch = text[end]
    if (ch === '\n' || ch === ' ' || ch === '\t') break
    end++
  }
  return { query: text.slice(start + 1, end), start, end }
}

function matchCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  if (!query) return commands
  const q = query.toLowerCase()
  const starts: SlashCommand[] = []
  const includes: SlashCommand[] = []
  for (const c of commands) {
    const n = c.name.toLowerCase()
    if (n.startsWith(q)) starts.push(c)
    else if (n.includes(q)) includes.push(c)
  }
  return [...starts, ...includes]
}

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
  onSetPermissionMode: (sessionId: string, mode: string) => void
  onSetModel: (sessionId: string, model: string) => void
  onInterrupt: (sessionId: string) => void
}

function isLiveMode(mode: SessionMode): boolean {
  return mode === 'new' || mode === 'resume-full' || mode === 'resume-summary'
}

function composeMessage(input: string, quotes: Quote[]): string {
  const trimmedInput = input.trim()
  if (quotes.length === 0) return trimmedInput
  const parts = quotes.map((q) => {
    const quoted = q.text
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n')
    return `${quoted}\n\n${q.comment}`
  })
  const head = parts.join('\n\n---\n\n')
  return trimmedInput ? `${head}\n\n---\n\n${trimmedInput}` : head
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
  onTurnStart,
  onSetPermissionMode,
  onSetModel,
  onInterrupt
}: Props): React.JSX.Element {
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [shownFromLine, setShownFromLine] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [allCommands, setAllCommands] = useState<SlashCommand[]>([])
  const [slashCtx, setSlashCtx] = useState<SlashContext | null>(null)
  const [slashIndex, setSlashIndex] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const imageCounterRef = useRef(0)
  const prependScrollHeightRef = useRef<number | null>(null)
  const loadingMoreRef = useRef(false)
  const shownFromLineRef = useRef(0)
  const sessionContextRef = useRef<{ sessionId: string; workspacePath: string } | null>(null)
  const forceScrollBottomRef = useRef(false)

  const mode = selected?.mode ?? 'readonly'
  const live = selected ? isLiveMode(selected.mode) : false

  shownFromLineRef.current = shownFromLine

  // When the selected session changes, snap immediately to bottom.
  // useLayoutEffect (not useEffect) so it runs before paint — avoids flashing
  // the cached message-set scrolled to the top before snapping.
  // Setting wasNearBottomRef=true also makes any post-switch readonly fullReload
  // (which mutates `messages`) trigger the existing scroll effect to snap again
  // once the fresh content lands.
  useLayoutEffect(() => {
    setQuotes([])
    setSlashCtx(null)
    imageCounterRef.current = 0
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    wasNearBottomRef.current = true
    forceScrollBottomRef.current = false
  }, [selected?.sessionId])

  // Load slash commands for the current workspace.
  useEffect(() => {
    if (!selected) {
      setAllCommands([])
      return
    }
    let cancelled = false
    void window.api.slashCommands
      .list(selected.workspacePath)
      .then((list) => {
        if (!cancelled) setAllCommands(list)
      })
      .catch((err) => console.error('slash commands load failed:', err))
    return () => {
      cancelled = true
    }
  }, [selected?.workspacePath])

  const handleAddQuote = useCallback((text: string, comment: string) => {
    setQuotes((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text, comment }
    ])
  }, [])

  const handleRemoveQuote = useCallback((id: string) => {
    setQuotes((prev) => prev.filter((q) => q.id !== id))
  }, [])

  const insertAtCaret = useCallback((text: string) => {
    const ta = textareaRef.current
    if (!ta) {
      setInput((prev) => prev + text)
      return
    }
    const start = ta.selectionStart ?? ta.value.length
    const end = ta.selectionEnd ?? start
    setInput((prev) => prev.slice(0, start) + text + prev.slice(end))
    requestAnimationFrame(() => {
      const node = textareaRef.current
      if (!node) return
      const pos = start + text.length
      node.focus()
      node.setSelectionRange(pos, pos)
    })
  }, [])

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items
      if (!items || !selected) return
      const images: File[] = []
      for (const item of Array.from(items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const f = item.getAsFile()
          if (f) images.push(f)
        }
      }
      if (images.length === 0) return
      e.preventDefault()
      for (const file of images) {
        try {
          const buf = new Uint8Array(await file.arrayBuffer())
          const path = await window.api.images.save(
            selected.sessionId,
            buf,
            file.type || 'image/png'
          )
          imageCounterRef.current += 1
          insertAtCaret(`[Image #${imageCounterRef.current}: ${path}]\n`)
        } catch (err) {
          console.error('image paste failed:', err)
        }
      }
    },
    [selected, insertAtCaret]
  )

  const todoState = useMemo(() => extractTodoState(messages), [messages])

  // Tick once a minute so the "리셋 Xh Ym" label refreshes.
  const [, setNowTick] = useState(0)
  useEffect(() => {
    if (!status?.rateLimit?.resetsAt) return
    const id = window.setInterval(() => setNowTick((t) => t + 1), 60_000)
    return () => window.clearInterval(id)
  }, [status?.rateLimit?.resetsAt])

  const matchedCommands = useMemo(() => {
    if (!slashCtx) return []
    return matchCommands(allCommands, slashCtx.query)
  }, [slashCtx, allCommands])

  useEffect(() => {
    if (slashIndex >= matchedCommands.length) setSlashIndex(0)
  }, [matchedCommands.length, slashIndex])

  const updateSlashFromTextarea = useCallback((value: string, caret: number) => {
    setSlashCtx(getSlashContext(value, caret))
  }, [])

  const pickSlashCommand = useCallback(
    (cmd: SlashCommand) => {
      if (!slashCtx) return
      const before = input.slice(0, slashCtx.start)
      const after = input.slice(slashCtx.end)
      const inserted = `/${cmd.name} `
      const newText = before + inserted + after
      const newCaret = before.length + inserted.length
      setInput(newText)
      setSlashCtx(null)
      requestAnimationFrame(() => {
        const ta = textareaRef.current
        if (!ta) return
        ta.focus()
        ta.setSelectionRange(newCaret, newCaret)
      })
    },
    [input, slashCtx]
  )

  // After prepend: keep visual scroll position. Layout effect runs before paint.
  useLayoutEffect(() => {
    if (prependScrollHeightRef.current != null && scrollRef.current) {
      const newH = scrollRef.current.scrollHeight
      const delta = newH - prependScrollHeightRef.current
      scrollRef.current.scrollTop += delta
    }
  }, [messages.length])

  // Track whether the user is "near bottom" *before* a new render lands.
  // Measuring after a streaming append shows the already-grown height which
  // can exceed any fixed threshold, so we cache the pre-render state on scroll.
  const wasNearBottomRef = useRef(true)

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
      wasNearBottomRef.current = true
      return
    }
    if (wasNearBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages, status?.thinking])

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
    const el = scrollRef.current
    if (!el) return
    wasNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (el.scrollTop < 80) {
      void loadMore()
    }
  }, [loadMore])

  const handleSend = useCallback(async () => {
    if (!selected || sending || !live) return
    if (!input.trim() && quotes.length === 0) return
    const text = composeMessage(input, quotes)
    setInput('')
    setQuotes([])
    setSending(true)
    forceScrollBottomRef.current = true
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
      textareaRef.current?.focus()
    }
  }, [selected, input, sending, live, quotes, onAppendBlocks, onTurnStart])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (slashCtx && matchedCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashIndex((i) => (i + 1) % matchedCommands.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashIndex((i) => (i - 1 + matchedCommands.length) % matchedCommands.length)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing)) {
        e.preventDefault()
        pickSlashCommand(matchedCommands[slashIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setSlashCtx(null)
        return
      }
    }
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

  const rateLimitLine = status?.rateLimit ? formatRateLimit(status.rateLimit) : null

  return (
    <main className="chat-pane">
      <div className="chat-header">
        <div className="chat-title">{selected.title}</div>
        <div className="chat-subtitle">
          {selected.workspacePath} · {selected.sessionId.slice(0, 8)} · {subtitleSuffix}
          {usageLine ? ` · ${usageLine}` : ''}
          {rateLimitLine ? ` · ${rateLimitLine}` : ''}
        </div>
        <TodoPanel state={todoState} />
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
        <>
          <QuoteAffordance containerRef={scrollRef} onAdd={handleAddQuote} />
          <div className="chat-input-wrap">
            <UsageBar
              status={status}
              onSetPermissionMode={
                selected
                  ? (mode) => onSetPermissionMode(selected.sessionId, mode)
                  : undefined
              }
              onSetModel={
                selected ? (model) => onSetModel(selected.sessionId, model) : undefined
              }
            />
            <QuoteChips quotes={quotes} onRemove={handleRemoveQuote} />
            {slashCtx && matchedCommands.length > 0 && (
              <SlashCompletion
                commands={matchedCommands}
                selectedIndex={slashIndex}
                anchorRef={textareaRef}
                onPick={pickSlashCommand}
                onHover={setSlashIndex}
              />
            )}
            <div className="chat-input">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  const v = e.target.value
                  setInput(v)
                  updateSlashFromTextarea(v, e.target.selectionStart ?? v.length)
                }}
                onSelect={(e) =>
                  updateSlashFromTextarea(
                    e.currentTarget.value,
                    e.currentTarget.selectionStart ?? 0
                  )
                }
                onPaste={(e) => {
                  void handlePaste(e)
                }}
                onBlur={() => setSlashCtx(null)}
                onKeyDown={handleKeyDown}
                placeholder="메시지 입력 (Enter: 전송, Shift+Enter: 줄바꿈, /: 명령, Ctrl+V: 이미지)"
                rows={3}
              />
              {status?.thinking ? (
                <button
                  type="button"
                  className="send-btn interrupt"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selected && onInterrupt(selected.sessionId)}
                  title="진행 중 turn 중단 (세션은 유지)"
                >
                  ◼
                </button>
              ) : (
                <button
                  type="button"
                  className="send-btn"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void handleSend()}
                  disabled={(!input.trim() && quotes.length === 0) || sending}
                >
                  {sending ? '…' : '전송'}
                </button>
              )}
            </div>
          </div>
        </>
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
