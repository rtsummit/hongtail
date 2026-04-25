import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

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

function TerminalSession({
  sessionId,
  workspacePath,
  initialCommand,
  visible,
  onExit,
  onReady
}: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const onExitRef = useRef(onExit)
  const onReadyRef = useRef(onReady)
  const hasReceivedDataRef = useRef(false)
  onExitRef.current = onExit
  onReadyRef.current = onReady

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
    term.loadAddon(fit)
    term.open(containerRef.current)
    try {
      fit.fit()
    } catch {
      /* ignore */
    }
    termRef.current = term
    fitRef.current = fit

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
      style={{ display: visible ? 'block' : 'none' }}
    >
      <div ref={containerRef} className="terminal-host-inner" />
    </div>
  )
}

export default TerminalSession
