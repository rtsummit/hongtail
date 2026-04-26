import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'

export interface TerminalSearchHandle {
  findNext: (query: string) => boolean
  findPrevious: (query: string) => boolean
  clear: () => void
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

  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useImperativeHandle(
    ref,
    () => ({
      findNext: (query) => searchRef.current?.findNext(query) ?? false,
      findPrevious: (query) => searchRef.current?.findPrevious(query) ?? false,
      clear: () => searchRef.current?.clearDecorations()
    }),
    []
  )

  const handleSend = useCallback(async () => {
    const text = input
    if (!text || sending) return
    setSending(true)
    try {
      await window.api.pty.write(sessionId, text + '\n')
      setInput('')
    } catch (err) {
      console.error('terminal send failed:', err)
    } finally {
      setSending(false)
      textareaRef.current?.focus()
    }
  }, [input, sending, sessionId])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void handleSend()
    }
  }

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items
      if (!items) return
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
            sessionId,
            buf,
            file.type || 'image/png'
          )
          // Insert at caret like ChatPane does.
          const ta = textareaRef.current
          if (ta) {
            const start = ta.selectionStart ?? ta.value.length
            const end = ta.selectionEnd ?? start
            const insert = `[Image: ${path}]\n`
            setInput((prev) => prev.slice(0, start) + insert + prev.slice(end))
            requestAnimationFrame(() => {
              const node = textareaRef.current
              if (!node) return
              const pos = start + insert.length
              node.focus()
              node.setSelectionRange(pos, pos)
            })
          } else {
            setInput((prev) => prev + `[Image: ${path}]\n`)
          }
        } catch (err) {
          console.error('terminal image paste failed:', err)
        }
      }
    },
    [sessionId]
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

    // Ctrl+V: read clipboard and inject as terminal input.
    // Returning false suppresses xterm's default Ctrl+V handling (which would
    // otherwise emit a literal SYN char, ^V, to the shell).
    // Ctrl+Shift+C still uses xterm's built-in copy via OS shortcut.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      if (e.ctrlKey && !e.altKey && !e.metaKey && (e.key === 'v' || e.key === 'V')) {
        // Don't consume Ctrl+Shift+V — let it through unchanged for xterm/OS to handle.
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
      <div className="terminal-input-wrap">
        <div className="chat-input">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={(e) => {
              void handlePaste(e)
            }}
            placeholder="입력 (Enter: 전송, Shift+Enter: 줄바꿈, Ctrl+V: 이미지). 터미널 직접 조작은 위 화면 클릭."
            rows={3}
          />
          <button
            type="button"
            className="send-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void handleSend()}
            disabled={!input || sending}
          >
            {sending ? '…' : '전송'}
          </button>
        </div>
      </div>
    </div>
  )
})

export default TerminalSession
