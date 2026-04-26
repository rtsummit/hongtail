import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TerminalSearchHandle } from './TerminalSession'

interface Props {
  open: boolean
  mode: 'app' | 'terminal'
  terminalRef: React.RefObject<TerminalSearchHandle | null>
  onClose: () => void
}

const HIGHLIGHT_NAME = 'find-match'
const HIGHLIGHT_ACTIVE_NAME = 'find-match-active'

interface CSSHighlightLike {
  highlights?: {
    set: (name: string, highlight: object) => void
    delete: (name: string) => void
  }
}

function getHighlights(): CSSHighlightLike['highlights'] | null {
  const css = (typeof CSS !== 'undefined' ? (CSS as unknown as CSSHighlightLike) : null)
  return css?.highlights ?? null
}

function getChatScroller(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.chat-messages')
}

function clearAll(): void {
  const h = getHighlights()
  if (!h) return
  h.delete(HIGHLIGHT_NAME)
  h.delete(HIGHLIGHT_ACTIVE_NAME)
}

function findRanges(scope: HTMLElement, query: string): Range[] {
  const lower = query.toLowerCase()
  const ranges: Range[] = []
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue) return NodeFilter.FILTER_REJECT
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      const tag = parent.tagName
      if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    }
  })
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n as Text
    const value = text.nodeValue ?? ''
    const lowerValue = value.toLowerCase()
    let from = 0
    let idx = lowerValue.indexOf(lower, from)
    while (idx >= 0) {
      const range = document.createRange()
      range.setStart(text, idx)
      range.setEnd(text, idx + query.length)
      ranges.push(range)
      from = idx + query.length
      idx = lowerValue.indexOf(lower, from)
    }
  }
  return ranges
}

function FindBar({ open, mode, terminalRef, onClose }: Props): React.JSX.Element | null {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [matchCount, setMatchCount] = useState(0)
  const rangesRef = useRef<Range[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<number | null>(null)

  const focusInput = useCallback(() => {
    const id = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(id)
  }, [])

  useEffect(() => {
    if (!open) return
    return focusInput()
  }, [open, focusInput])

  // Cleanup highlights when closed.
  useEffect(() => {
    if (open) return
    clearAll()
    if (mode === 'terminal') terminalRef.current?.clear()
    rangesRef.current = []
    setMatchCount(0)
    setActive(0)
  }, [open, mode, terminalRef])

  useEffect(() => {
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
      clearAll()
    }
  }, [])

  // Recompute matches: called on query change AND on DOM mutations (so streaming
  // chat content keeps highlights up to date without breaking React reconciliation).
  const recompute = useCallback(() => {
    const h = getHighlights()
    const q = query.trim()
    if (mode !== 'app') return
    if (!h) return
    if (!q) {
      h.delete(HIGHLIGHT_NAME)
      h.delete(HIGHLIGHT_ACTIVE_NAME)
      rangesRef.current = []
      setMatchCount(0)
      setActive(-1)
      return
    }
    const scope = getChatScroller()
    if (!scope) {
      rangesRef.current = []
      setMatchCount(0)
      setActive(-1)
      return
    }
    const ranges = findRanges(scope, q)
    rangesRef.current = ranges
    if (ranges.length === 0) {
      h.delete(HIGHLIGHT_NAME)
      h.delete(HIGHLIGHT_ACTIVE_NAME)
      setMatchCount(0)
      setActive(-1)
      return
    }
    // All matches go into HIGHLIGHT_NAME; active gets pulled out into HIGHLIGHT_ACTIVE_NAME
    // below by an effect. Construct a Highlight (constructor accepts ranges).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const HighlightCtor = (window as any).Highlight as new (...r: Range[]) => object
    if (typeof HighlightCtor === 'function') {
      h.set(HIGHLIGHT_NAME, new HighlightCtor(...ranges))
    }
    setMatchCount(ranges.length)
    setActive((prev) => (prev >= 0 && prev < ranges.length ? prev : 0))
  }, [query, mode])

  // Re-run on query change with debounce for input responsiveness.
  useEffect(() => {
    if (!open) return
    if (mode !== 'app') return
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null
      recompute()
    }, 200)
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    }
  }, [query, open, mode, recompute])

  // Watch DOM mutations under .chat-messages so streaming output keeps marks updated.
  useEffect(() => {
    if (!open) return
    if (mode !== 'app') return
    if (!query.trim()) return
    const scope = getChatScroller()
    if (!scope) return
    let timer: number | null = null
    const obs = new MutationObserver(() => {
      if (timer != null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        recompute()
      }, 150)
    })
    obs.observe(scope, { childList: true, subtree: true, characterData: true })
    return () => {
      obs.disconnect()
      if (timer != null) window.clearTimeout(timer)
    }
  }, [open, mode, query, recompute])

  // Terminal-mode: subscribe to SearchAddon's onDidChangeResults event so the
  // counter (resultIndex+1 / resultCount) reflects what xterm tracks internally.
  useEffect(() => {
    if (!open) return
    if (mode !== 'terminal') return
    const handle = terminalRef.current
    if (!handle) return
    const off = handle.onResults((r) => {
      setMatchCount(r.resultCount)
      setActive(r.resultCount > 0 ? r.resultIndex : -1)
    })
    return off
  }, [open, mode, terminalRef])

  // Terminal-mode search: run findNext on query change. Result count comes via
  // the onResults subscription above (not from findNext's boolean).
  useEffect(() => {
    if (!open) return
    if (mode !== 'terminal') return
    const handle = terminalRef.current
    if (!handle) return
    const q = query.trim()
    if (!q) {
      handle.clear()
      setMatchCount(0)
      setActive(-1)
      return
    }
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null
      handle.findNext(q)
    }, 200)
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    }
  }, [open, mode, query, terminalRef])

  // Update active highlight + scroll into view (app mode).
  useEffect(() => {
    if (mode !== 'app') return
    const h = getHighlights()
    if (!h) return
    if (active < 0 || active >= rangesRef.current.length) {
      h.delete(HIGHLIGHT_ACTIVE_NAME)
      return
    }
    const range = rangesRef.current[active]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const HighlightCtor = (window as any).Highlight as new (...r: Range[]) => object
    if (typeof HighlightCtor === 'function') {
      h.set(HIGHLIGHT_ACTIVE_NAME, new HighlightCtor(range))
    }
    // Scroll the active match's host element into view.
    const host =
      range.startContainer.nodeType === Node.TEXT_NODE
        ? (range.startContainer.parentElement as HTMLElement | null)
        : (range.startContainer as HTMLElement)
    host?.scrollIntoView({ block: 'center', behavior: 'auto' })
  }, [active, matchCount, mode])

  const navigate = useCallback(
    (delta: number) => {
      if (mode === 'app') {
        if (matchCount === 0) return
        setActive((cur) => {
          const next = cur + delta
          return ((next % matchCount) + matchCount) % matchCount
        })
      } else {
        const handle = terminalRef.current
        if (!handle) return
        const q = query.trim()
        if (!q) return
        // findNext / findPrevious will fire onResults with new resultIndex.
        if (delta > 0) handle.findNext(q)
        else handle.findPrevious(q)
      }
    },
    [mode, matchCount, terminalRef, query]
  )

  const counter = useMemo(() => {
    if (!query.trim()) return ''
    if (matchCount === 0) return '없음'
    return `${active + 1}/${matchCount}`
  }, [active, matchCount, query])

  if (!open) return null

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      navigate(e.shiftKey ? -1 : 1)
      return
    }
  }

  return (
    <div className="find-bar" role="search">
      <input
        ref={inputRef}
        type="text"
        className="find-input"
        value={query}
        placeholder={mode === 'terminal' ? '터미널 검색…' : '메시지 검색…'}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <span className="find-count">{counter}</span>
      <button
        type="button"
        className="find-btn"
        title="이전 (Shift+Enter)"
        onClick={() => navigate(-1)}
        disabled={!query.trim() || matchCount === 0}
      >
        ↑
      </button>
      <button
        type="button"
        className="find-btn"
        title="다음 (Enter)"
        onClick={() => navigate(1)}
        disabled={!query.trim() || matchCount === 0}
      >
        ↓
      </button>
      <button
        type="button"
        className="find-btn close"
        title="닫기 (Esc)"
        onClick={onClose}
      >
        ×
      </button>
    </div>
  )
}

export default FindBar
