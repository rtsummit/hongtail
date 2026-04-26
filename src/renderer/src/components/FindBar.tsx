import { useCallback, useEffect, useRef, useState } from 'react'
import type { TerminalSearchHandle } from './TerminalSession'

interface Props {
  open: boolean
  mode: 'app' | 'terminal'
  terminalRef: React.RefObject<TerminalSearchHandle | null>
  onClose: () => void
}

function FindBar({ open, mode, terminalRef, onClose }: Props): React.JSX.Element | null {
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<{ active: number; total: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastQueryRef = useRef<string>('')

  // Focus + select all when opened (so re-pressing Ctrl+F focuses the bar).
  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(id)
  }, [open])

  // App-mode result subscription.
  useEffect(() => {
    if (mode !== 'app') return
    const off = window.api.find.onResult((r) => {
      setMatches({ active: r.activeMatchOrdinal, total: r.matches })
    })
    return off
  }, [mode])

  // Stop find when closed or unmounting (in app mode).
  useEffect(() => {
    if (open) return
    if (mode === 'app') void window.api.find.stop()
    if (mode === 'terminal') terminalRef.current?.clear()
    setMatches(null)
    lastQueryRef.current = ''
  }, [open, mode, terminalRef])

  const runSearch = useCallback(
    (forward: boolean) => {
      const q = query.trim()
      if (!q) {
        setMatches(null)
        if (mode === 'app') void window.api.find.stop()
        if (mode === 'terminal') terminalRef.current?.clear()
        return
      }
      if (mode === 'app') {
        const findNext = q === lastQueryRef.current
        void window.api.find.start(q, { findNext, forward })
        lastQueryRef.current = q
      } else {
        const handle = terminalRef.current
        if (!handle) return
        const found = forward ? handle.findNext(q) : handle.findPrevious(q)
        // xterm SearchAddon doesn't expose match counts, so just show "found / not found".
        setMatches(found ? { active: 1, total: 1 } : { active: 0, total: 0 })
        lastQueryRef.current = q
      }
    },
    [query, mode, terminalRef]
  )

  // Live search: re-query on every input change (within 100ms throttle).
  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => runSearch(true), 100)
    return () => window.clearTimeout(id)
  }, [query, open, runSearch])

  if (!open) return null

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      runSearch(!e.shiftKey)
      return
    }
  }

  const counter =
    matches == null
      ? ''
      : matches.total === 0
        ? '없음'
        : `${matches.active}/${matches.total}`

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
        onClick={() => runSearch(false)}
        disabled={!query.trim()}
      >
        ↑
      </button>
      <button
        type="button"
        className="find-btn"
        title="다음 (Enter)"
        onClick={() => runSearch(true)}
        disabled={!query.trim()}
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
