import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Sidebar from './components/Sidebar'
import ChatPane from './components/ChatPane'
import TerminalSession from './components/TerminalSession'
import { parseClaudeEvent } from './claudeEvents'
import { extractUsage, isResultEvent, pickVerb } from './sessionStatus'
import type { Backend, Block, SelectedSession, SessionStatus } from './types'

type ActiveMode = 'new' | 'resume-full' | 'resume-summary'

interface ActiveSession {
  workspacePath: string
  mode: ActiveMode
  backend: Backend
}

function App(): React.JSX.Element {
  const [workspaces, setWorkspaces] = useState<string[]>([])
  const [selected, setSelected] = useState<SelectedSession | null>(null)
  const [messagesBySession, setMessagesBySession] = useState<Record<string, Block[]>>({})
  const [active, setActive] = useState<Record<string, ActiveSession>>({})
  const [statusBySession, setStatusBySession] = useState<Record<string, SessionStatus>>({})
  const [defaultBackend, setDefaultBackend] = useState<Backend>('app')
  const subscriptionsRef = useRef<Map<string, () => void>>(new Map())

  useEffect(() => {
    void window.api.workspaces.load().then(setWorkspaces)
  }, [])

  const persist = useCallback(async (next: string[]) => {
    setWorkspaces(next)
    await window.api.workspaces.save(next)
  }, [])

  const addWorkspace = useCallback(async () => {
    const picked = await window.api.workspaces.pickDirectory()
    if (!picked) return
    if (workspaces.includes(picked)) return
    await persist([picked, ...workspaces])
  }, [workspaces, persist])

  const appendBlocks = useCallback((sessionId: string, blocks: Block[]) => {
    if (blocks.length === 0) return
    setMessagesBySession((prev) => ({
      ...prev,
      [sessionId]: [...(prev[sessionId] ?? []), ...blocks]
    }))
  }, [])

  const replaceBlocks = useCallback((sessionId: string, blocks: Block[]) => {
    setMessagesBySession((prev) => ({ ...prev, [sessionId]: blocks }))
  }, [])

  const handleClaudeEvent = useCallback(
    (sessionId: string, event: unknown) => {
      const parsed = parseClaudeEvent(event)
      if (parsed.length > 0) appendBlocks(sessionId, parsed)

      const usage = extractUsage(event)
      if (usage?.outputTokens !== undefined) {
        setStatusBySession((prev) => ({
          ...prev,
          [sessionId]: { ...prev[sessionId], thinking: prev[sessionId]?.thinking ?? false, outputTokens: usage.outputTokens }
        }))
      }

      if (isResultEvent(event)) {
        const finalUsage = extractUsage(event)
        setStatusBySession((prev) => ({
          ...prev,
          [sessionId]: {
            ...prev[sessionId],
            thinking: false,
            usage: finalUsage ?? prev[sessionId]?.usage
          }
        }))
      }
    },
    [appendBlocks]
  )

  const ensureClaudeSubscription = useCallback(
    (sessionId: string) => {
      if (subscriptionsRef.current.has(sessionId)) return
      const unsub = window.api.claude.onEvent(sessionId, (event) =>
        handleClaudeEvent(sessionId, event)
      )
      subscriptionsRef.current.set(sessionId, unsub)
    },
    [handleClaudeEvent]
  )

  const startAppLive = useCallback(
    async (sessionId: string, workspacePath: string, mode: ActiveMode) => {
      ensureClaudeSubscription(sessionId)
      try {
        await window.api.claude.startSession(
          workspacePath,
          sessionId,
          mode === 'new' ? 'new' : 'resume'
        )
        if (mode === 'resume-summary') {
          await new Promise((r) => setTimeout(r, 500))
          await window.api.claude.sendInput(sessionId, '/compact')
          appendBlocks(sessionId, [{ kind: 'system', text: '▸ /compact 요청됨' }])
        }
      } catch (err) {
        appendBlocks(sessionId, [
          { kind: 'error', text: `세션 시작 실패: ${String(err)}` }
        ])
      }
    },
    [ensureClaudeSubscription, appendBlocks]
  )

  const startLive = useCallback(
    async (
      sessionId: string,
      workspacePath: string,
      mode: ActiveMode,
      backend: Backend
    ) => {
      setActive((prev) => ({
        ...prev,
        [sessionId]: { workspacePath, mode, backend }
      }))
      if (backend === 'app') {
        await startAppLive(sessionId, workspacePath, mode)
      }
      // Terminal backend is started by <TerminalSession> component lifecycle
    },
    [startAppLive]
  )

  const startClaudeIn = useCallback(
    (cwd: string) => {
      const sessionId = crypto.randomUUID()
      setSelected({
        workspacePath: cwd,
        sessionId,
        title: 'New session',
        mode: 'new',
        backend: defaultBackend
      })
      void startLive(sessionId, cwd, 'new', defaultBackend)
    },
    [defaultBackend, startLive]
  )

  const activate = useCallback(
    (mode: 'resume-full' | 'resume-summary') => {
      if (!selected) return
      const backend = defaultBackend
      setSelected((prev) => (prev ? { ...prev, mode, backend } : prev))
      void startLive(selected.sessionId, selected.workspacePath, mode, backend)
    },
    [selected, defaultBackend, startLive]
  )

  const handleTurnStart = useCallback((sessionId: string) => {
    setStatusBySession((prev) => ({
      ...prev,
      [sessionId]: {
        thinking: true,
        turnStart: Date.now(),
        verb: pickVerb(),
        outputTokens: undefined,
        usage: prev[sessionId]?.usage
      }
    }))
  }, [])

  const handleSelect = useCallback(
    (s: SelectedSession | null) => {
      if (!s) {
        setSelected(null)
        return
      }
      const a = active[s.sessionId]
      if (a) {
        setSelected({ ...s, mode: a.mode, backend: a.backend })
      } else {
        setSelected({ ...s, mode: 'readonly' })
      }
    },
    [active]
  )

  // Cleanup all subscriptions on unmount
  useEffect(() => {
    const subs = subscriptionsRef.current
    return () => {
      for (const unsub of subs.values()) unsub()
      subs.clear()
    }
  }, [])

  const messages = selected ? (messagesBySession[selected.sessionId] ?? []) : []
  const status = selected ? statusBySession[selected.sessionId] : undefined

  const terminalSessionList = useMemo(
    () =>
      Object.entries(active)
        .filter(([, a]) => a.backend === 'terminal')
        .map(([sessionId, a]) => ({ sessionId, ...a })),
    [active]
  )

  const showChatPane =
    !selected || selected.backend !== 'terminal' || selected.mode === 'readonly'

  return (
    <div className="app">
      <Sidebar
        workspaces={workspaces}
        selected={selected}
        defaultBackend={defaultBackend}
        onChangeBackend={setDefaultBackend}
        onAddWorkspace={addWorkspace}
        onSelect={handleSelect}
        onStartClaude={startClaudeIn}
      />
      <div className="main-area">
        {terminalSessionList.map((t) => {
          const visible =
            !!selected &&
            selected.sessionId === t.sessionId &&
            selected.backend === 'terminal'
          const command =
            t.mode === 'new'
              ? `claude --session-id ${t.sessionId}`
              : `claude --resume ${t.sessionId}`
          return (
            <TerminalSession
              key={t.sessionId}
              sessionId={t.sessionId}
              workspacePath={t.workspacePath}
              initialCommand={command}
              visible={visible}
            />
          )
        })}
        {showChatPane && (
          <ChatPane
            selected={selected}
            messages={messages}
            status={status}
            onAppendBlocks={appendBlocks}
            onReplaceBlocks={replaceBlocks}
            onActivate={activate}
            onTurnStart={handleTurnStart}
          />
        )}
      </div>
    </div>
  )
}

export default App
