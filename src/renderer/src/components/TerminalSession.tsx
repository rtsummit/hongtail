import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface Props {
  sessionId: string
  workspacePath: string
  initialCommand: string
  visible: boolean
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
  visible
}: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

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
      } else if (event.type === 'exit') {
        term.write(`\r\n\x1b[31m[프로세스 종료 code=${event.code ?? '?'}]\x1b[0m\r\n`)
      }
    })

    void window.api.pty.spawn({
      sessionId,
      workspacePath,
      cols: term.cols,
      rows: term.rows,
      command: initialCommand,
      delayMs: 250
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
      // PTY 는 일부러 살려둠. React StrictMode 의 double-invoke 에서
      // 죽이면 자동 claude 명령이 사라짐. 앱 종료 시 killAllPty 가 정리.
    }
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
      ref={containerRef}
      className="terminal-host"
      style={{ display: visible ? 'block' : 'none' }}
    />
  )
}

export default TerminalSession
