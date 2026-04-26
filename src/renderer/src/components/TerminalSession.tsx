import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'

export interface TerminalSearchResults {
  resultIndex: number // 0-based; -1 if none
  resultCount: number
}

export interface TerminalSearchHandle {
  findNext: (query: string) => boolean
  findPrevious: (query: string) => boolean
  clear: () => void
  onResults: (cb: (r: TerminalSearchResults) => void) => () => void
}

interface Props {
  sessionId: string
  workspacePath: string
  initialCommand: string
  visible: boolean
  onExit: (code: number | null) => void
  onReady?: () => void
}

interface PtyEvent {
  type: 'data' | 'exit'
  data?: string
  code?: number
}

const TerminalSession = forwardRef<TerminalSearchHandle, Props>(function TerminalSession(
  { sessionId, workspacePath, initialCommand, visible, onExit, onReady },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const onExitRef = useRef(onExit)
  const onReadyRef = useRef(onReady)
  const hasReceivedDataRef = useRef(false)
  onExitRef.current = onExit
  onReadyRef.current = onReady

  // Visible decorations for all matches and the active one. xterm's SearchAddon
  // paints these as DOM overlays in the viewport (not as canvas glyphs) and
  // also marks them in the overview ruler.
  const SEARCH_DECORATIONS = {
    matchBackground: 'rgba(250, 204, 21, 0.4)',
    matchBorder: 'rgba(250, 204, 21, 0.6)',
    matchOverviewRuler: 'rgba(250, 204, 21, 0.7)',
    activeMatchBackground: 'rgba(250, 204, 21, 0.9)',
    activeMatchBorder: 'rgba(250, 204, 21, 1)',
    activeMatchColorOverviewRuler: 'rgba(250, 204, 21, 1)'
  }

  useImperativeHandle(
    ref,
    () => ({
      findNext: (query) =>
        searchRef.current?.findNext(query, { decorations: SEARCH_DECORATIONS }) ?? false,
      findPrevious: (query) =>
        searchRef.current?.findPrevious(query, { decorations: SEARCH_DECORATIONS }) ?? false,
      clear: () => searchRef.current?.clearDecorations(),
      onResults: (cb) => {
        const search = searchRef.current
        if (!search?.onDidChangeResults) return () => {}
        const disposable = search.onDidChangeResults((r) => {
          // r per xterm typings is `{ resultIndex, resultCount } | undefined`.
          if (!r) cb({ resultIndex: -1, resultCount: 0 })
          else cb({ resultIndex: r.resultIndex, resultCount: r.resultCount })
        })
        return () => disposable.dispose()
      }
    }),
    []
  )

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      fontFamily: '"Cascadia Code", "Consolas", "Menlo", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4'
      }
    })
    const fit = new FitAddon()
    const search = new SearchAddon()
    term.loadAddon(fit)
    term.loadAddon(search)
    term.open(containerRef.current)
    try {
      fit.fit()
    } catch {
      /* ignore */
    }
    termRef.current = term
    fitRef.current = fit
    searchRef.current = search

    const unsub = window.api.pty.onEvent(sessionId, (raw) => {
      const event = raw as PtyEvent
      if (event.type === 'data' && typeof event.data === 'string') {
        term.write(event.data)
        if (!hasReceivedDataRef.current) {
          hasReceivedDataRef.current = true
          onReadyRef.current?.()
        }
      } else if (event.type === 'exit') {
        onExitRef.current(event.code ?? null)
      }
    })

    void window.api.pty.spawn({
      sessionId,
      workspacePath,
      cols: term.cols,
      rows: term.rows,
      command: initialCommand
    })

    term.onData((data) => {
      void window.api.pty.write(sessionId, data)
    })
    term.onResize(({ cols, rows }) => {
      void window.api.pty.resize(sessionId, cols, rows)
    })

    // Custom key event interceptor for desktop-app-friendly shortcuts.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true

      // While IME is composing (Korean/Japanese/Chinese), don't intercept —
      // the user is still building a character and IME owns the key. If we
      // preventDefault now, IME's commit flow races with our direct PTY write
      // and the composing char ends up duplicated alongside our sequence.
      // keyCode === 229 is the legacy "IME pending" indicator some Chromium
      // builds emit instead of (or alongside) e.isComposing.
      if (e.isComposing || e.keyCode === 229) return true

      // Ctrl+V: read clipboard and inject as terminal input.
      // Returning false suppresses xterm's default Ctrl+V handling (which would
      // otherwise emit a literal SYN char, ^V, to the shell).
      // Ctrl+Shift+V is left alone for xterm/OS to handle.
      if (e.ctrlKey && !e.altKey && !e.metaKey && (e.key === 'v' || e.key === 'V')) {
        if (e.shiftKey) return true
        e.preventDefault()
        void navigator.clipboard
          .readText()
          .then((text) => {
            if (text) void window.api.pty.write(sessionId, text)
          })
          .catch((err) => console.error('terminal paste failed:', err))
        return false
      }

      // Shift+Enter → send ESC+CR (Alt+Enter equivalent). claude CLI's TUI
      // (Ink-based) and other modern terminal apps interpret this as
      // "newline within input" instead of "submit". Default xterm sends \r
      // for Shift+Enter which submits.
      // Reference: claude's own VSCode terminal setup ships the exact same
      // keybinding ("shift+enter" → sendSequence "\x1b\r").
      if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && e.key === 'Enter') {
        e.preventDefault()
        void window.api.pty.write(sessionId, '\x1b\r')
        return false
      }

      return true
    })

    const onWindowResize = (): void => {
      try {
        fit.fit()
      } catch {
        /* ignore */
      }
    }
    window.addEventListener('resize', onWindowResize)

    return () => {
      window.removeEventListener('resize', onWindowResize)
      unsub()
      searchRef.current = null
      term.dispose()
    }
    // onExit intentionally excluded — we access latest via onExitRef.
    // sessionId/workspacePath/initialCommand are stable per session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, workspacePath, initialCommand])

  useEffect(() => {
    if (!visible) return
    const t = termRef.current
    const f = fitRef.current
    if (!t || !f) return
    try {
      f.fit()
    } catch {
      /* ignore */
    }
    t.focus()
  }, [visible])

  return (
    <div
      className="terminal-host"
      style={{ display: visible ? 'flex' : 'none' }}
    >
      <div ref={containerRef} className="terminal-host-inner" />
    </div>
  )
})

export default TerminalSession
