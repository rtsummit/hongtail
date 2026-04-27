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

    // Ctrl+V: read clipboard and inject.
    // customKeyEventHandler fires inside xterm's own keydown handler, fine for
    // keys that don't conflict with IME. Ctrl+C 는 capture-phase hostKeyDown
    // 에서 더 일찍 가로챈다 — customKeyEventHandler 가 어떤 이유로 우회되는
    // 케이스에서 신뢰성을 위해.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      if (e.isComposing || e.keyCode === 229) return true
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
      return true
    })

    // Capture-phase Enter handler at the container level — fires *before*
    // xterm's own keydown listener (which is attached on textarea, capture).
    // This is the only way to actually suppress xterm's Enter processing.
    //
    // Why we can't do this in customKeyEventHandler:
    //   xterm's _keyDown does:
    //     compositionHelper.keydown(e)   // finalizes composition for Enter,
    //                                    // returns TRUE → not an early-return
    //     evaluateKeyboardEvent(e)       // sees Enter → sends \r anyway
    //   So even if customKeyEventHandler returns false, the second step still
    //   runs and \r leaks. During IME, this is what produces the duplicate
    //   "composing char + \r" the user sees. By stopping immediate propagation
    //   *before* xterm's listener, the entire _keyDown is skipped.
    //
    //   Composition still commits cleanly because compositionend is a separate
    //   browser event that xterm subscribes to independently of keydown.
    const hostEl = containerRef.current
    const hostKeyDown = (e: KeyboardEvent): void => {
      // Ctrl+C — 무조건 복사 모드. 선택 있으면 클립보드에 쓰고, 없으면 그냥
      // 무시 (SIGINT \x03 도 PTY 에 안 보냄). Ctrl+Shift+C 는 통과 (DevTools).
      if (
        e.ctrlKey &&
        !e.altKey &&
        !e.metaKey &&
        !e.shiftKey &&
        (e.key === 'c' || e.key === 'C')
      ) {
        e.preventDefault()
        e.stopImmediatePropagation()
        const term = termRef.current
        const sel = term?.getSelection()
        if (sel) {
          void navigator.clipboard
            .writeText(sel)
            .catch((err) => console.error('terminal copy failed:', err))
        }
        return
      }

      if (e.key !== 'Enter') return

      // Case 1: IME is composing → swallow Enter so xterm doesn't append \r
      // after the composing char gets committed via compositionend.
      // Don't preventDefault — we want IME / textarea to handle composition end.
      if (e.isComposing || e.keyCode === 229) {
        e.stopImmediatePropagation()
        return
      }

      // Case 2: Shift+Enter (no composition) → send Alt+Enter sequence (\x1b\r)
      // which Ink-based TUIs (claude CLI) interpret as "newline within input"
      // instead of "submit". claude's own VSCode setup uses the same mapping.
      if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault()
        e.stopImmediatePropagation()
        void window.api.pty.write(sessionId, '\x1b\r')
        return
      }
      // Otherwise (plain Enter / Ctrl+Enter / etc): let xterm handle.
    }
    hostEl.addEventListener('keydown', hostKeyDown, true)

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
      hostEl.removeEventListener('keydown', hostKeyDown, true)
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
