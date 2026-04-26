import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TerminalSearchHandle } from './TerminalSession'

interface Props {
  open: boolean
  mode: 'app' | 'terminal'
  terminalRef: React.RefObject<TerminalSearchHandle | null>
  onClose: () => void
}

const MARK_CLASS = 'find-highlight'
const MARK_ACTIVE_CLASS = 'active'

function getChatScroller(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.chat-messages')
}

function clearMarks(scope: HTMLElement | null): void {
  if (!scope) return
  const marks = scope.querySelectorAll<HTMLElement>(`.${MARK_CLASS}`)
  marks.forEach((m) => {
    const parent = m.parentNode
    if (!parent) return
    while (m.firstChild) parent.insertBefore(m.firstChild, m)
    parent.removeChild(m)
  })
  // Merge adjacent text nodes that the unwrap created.
  scope.normalize()
}

function applyMarks(scope: HTMLElement | null, query: string): HTMLElement[] {
  if (!scope || !query) return []
  const lower = query.toLowerCase()
  const out: HTMLElement[] = []
  // Collect text nodes first (mutations during iteration would invalidate the walker).
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue) return NodeFilter.FILTER_REJECT
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      // Skip code/pre? Allow — useful to find text inside tool blocks too.
      // Skip already-marked nodes to avoid double-wrapping on re-runs (defensive).
      if (parent.classList?.contains(MARK_CLASS)) return NodeFilter.FILTER_REJECT
      // Skip script/style if any sneak in.
      const tag = parent.tagName
      if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    }
  })
  const nodes: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push(n as Text)
  }
  for (const text of nodes) {
    const value = text.nodeValue ?? ''
    const lowerValue = value.toLowerCase()
    let from = 0
    let idx = lowerValue.indexOf(lower, from)
    if (idx < 0) continue
    const parent = text.parentNode
    if (!parent) continue
    const frag = document.createDocumentFragment()
    while (idx >= 0) {
      if (idx > from) frag.appendChild(document.createTextNode(value.slice(from, idx)))
      const mark = document.createElement('mark')
      mark.className = MARK_CLASS
      mark.textContent = value.slice(idx, idx + query.length)
      frag.appendChild(mark)
      out.push(mark)
      from = idx + query.length
      idx = lowerValue.indexOf(lower, from)
    }
    if (from < value.length) frag.appendChild(document.createTextNode(value.slice(from)))
    parent.replaceChild(frag, text)
  }
  return out
}

function FindBar({ open, mode, terminalRef, onClose }: Props): React.JSX.Element | null {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [matches, setMatches] = useState<HTMLElement[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<number | null>(null)

  // Focus + select all when opened (so re-pressing Ctrl+F focuses the bar).
  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(id)
  }, [open])

  // Cleanup highlights when closing or unmounting.
  useEffect(() => {
    if (open) return
    const scroller = getChatScroller()
    clearMarks(scroller)
    if (mode === 'terminal') terminalRef.current?.clear()
    setMatches([])
    setActive(0)
  }, [open, mode, terminalRef])

  useEffect(() => {
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
      clearMarks(getChatScroller())
    }
  }, [])

  // Apply mark on query change (debounced).
  useEffect(() => {
    if (!open) return
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null
      if (mode === 'app') {
        const scroller = getChatScroller()
        clearMarks(scroller)
        const found = applyMarks(scroller, query.trim())
        setMatches(found)
        setActive(found.length > 0 ? 0 : -1)
      } else {
        const handle = terminalRef.current
        if (!handle) return
        if (!query.trim()) {
          handle.clear()
          setMatches([])
          setActive(-1)
          return
        }
        const ok = handle.findNext(query.trim())
        // SearchAddon doesn't expose match count.
        setMatches(ok ? [document.createElement('span')] : [])
        setActive(ok ? 0 : -1)
      }
    }, 250)
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    }
  }, [query, mode, open, terminalRef])

  // Update active mark visual + scroll into view.
  useEffect(() => {
    if (mode !== 'app') return
    matches.forEach((m, i) => {
      if (i === active) m.classList.add(MARK_ACTIVE_CLASS)
      else m.classList.remove(MARK_ACTIVE_CLASS)
    })
    if (active >= 0 && matches[active]) {
      matches[active].scrollIntoView({ block: 'center', behavior: 'auto' })
    }
  }, [active, matches, mode])

  const total = matches.length
  const navigate = useCallback(
    (delta: number) => {
      if (mode === 'app') {
        if (total === 0) return
        setActive((cur) => {
          const next = cur + delta
          return ((next % total) + total) % total
        })
      } else {
        const handle = terminalRef.current
        if (!handle) return
        const q = query.trim()
        if (!q) return
        const ok = delta > 0 ? handle.findNext(q) : handle.findPrevious(q)
        setMatches(ok ? [document.createElement('span')] : [])
        setActive(ok ? 0 : -1)
      }
    },
    [mode, total, terminalRef, query]
  )

  const counter = useMemo(() => {
    if (!query.trim()) return ''
    if (total === 0) return '없음'
    if (mode === 'terminal') return active >= 0 ? '찾음' : '없음'
    return `${active + 1}/${total}`
  }, [active, total, mode, query])

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
        disabled={!query.trim() || total === 0}
      >
        ↑
      </button>
      <button
        type="button"
        className="find-btn"
        title="다음 (Enter)"
        onClick={() => navigate(1)}
        disabled={!query.trim() || total === 0}
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
