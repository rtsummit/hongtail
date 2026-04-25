import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Sidebar from './components/Sidebar'
import ChatPane from './components/ChatPane'
import TerminalSession from './components/TerminalSession'
import { parseClaudeEvent } from './claudeEvents'
import { extractUsage, isResultEvent, pickVerb } from './sessionStatus'
import {
  installRpcBridge,
  type ActiveEntry,
  type ActiveMode,
  type RpcSnapshot,
  type RpcWaiterEntry
} from './rpcBridge'
import type { Backend, Block, SelectedSession, SessionStatus } from './types'

function App(): React.JSX.Element {
  const [workspaces, setWorkspaces] = useState<string[]>([])
  const [selected, setSelected] = useState<SelectedSession | null>(null)
  const [messagesBySession, setMessagesBySession] = useState<Record<string, Block[]>>({})
  const [active, setActive] = useState<Record<string, ActiveEntry>>({})
  const [terminalReady, setTerminalReady] = useState<Record<string, boolean>>({})
  const [statusBySession, setStatusBySession] = useState<Record<string, SessionStatus>>({})
  const [defaultBackend, setDefaultBackend] = useState<Backend>('app')
  const subscriptionsRef = useRef<Map<string, () => void>>(new Map())
  const waitersRef = useRef<Map<string, RpcWaiterEntry>>(new Map())

  useEffect(() => {
    void window.api.workspaces.load().then(setWorkspaces)
  }, [])

  const persist = useCallback(async (next: string[]) => {
    setWorkspaces(next)
    await window.api.workspaces.save(next)
  }, [])

  const addWorkspaceDialog = useCallback(async () => {
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
          [sessionId]: {
            ...prev[sessionId],
            thinking: prev[sessionId]?.thinking ?? false,
            outputTokens: usage.outputTokens
          }
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

        const waiter = waitersRef.current.get(sessionId)
        if (waiter) {
          window.clearTimeout(waiter.timer)
          waitersRef.current.delete(sessionId)
          waiter.resolve({ usage: finalUsage })
        }
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
          { kind: 'error', text: `대화 시작 실패: ${String(err)}` }
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
      if (backend === 'terminal') {
        setTerminalReady((prev) => ({ ...prev, [sessionId]: false }))
      }
      if (backend === 'app') {
        await startAppLive(sessionId, workspacePath, mode)
      }
    },
    [startAppLive]
  )

  const handleTerminalReady = useCallback((sessionId: string) => {
    setTerminalReady((prev) =>
      prev[sessionId] ? prev : { ...prev, [sessionId]: true }
    )
  }, [])

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

  const handleStopLive = useCallback(
    async (sessionId: string) => {
      const a = active[sessionId]
      if (!a) return
      const ok = window.confirm(
        '이 라이브 대화를 중지할까요? (기록은 유지됩니다)'
      )
      if (!ok) return
      try {
        if (a.backend === 'terminal') {
          await window.api.pty.kill(sessionId)
        } else {
          await window.api.claude.stopSession(sessionId)
        }
      } catch (err) {
        console.error('stop session failed:', err)
      }
      setActive((prev) => {
        if (!prev[sessionId]) return prev
        const next = { ...prev }
        delete next[sessionId]
        return next
      })
      setSelected((prev) => {
        if (prev?.sessionId !== sessionId) return prev
        return { ...prev, mode: 'readonly', backend: 'app' }
      })
    },
    [active]
  )

  const handleTerminalExit = useCallback((sessionId: string, _code: number | null) => {
    void _code
    setActive((prev) => {
      if (!prev[sessionId]) return prev
      const next = { ...prev }
      delete next[sessionId]
      return next
    })
    setTerminalReady((prev) => {
      if (!(sessionId in prev)) return prev
      const next = { ...prev }
      delete next[sessionId]
      return next
    })
    setSelected((prev) => {
      if (prev?.sessionId !== sessionId) return prev
      return { ...prev, mode: 'readonly', backend: 'app' }
    })
  }, [])

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

  // === RPC bridge ===
  const stateRef = useRef<RpcSnapshot>({
    workspaces: [],
    selected: null,
    active: {},
    status: {},
    defaultBackend: 'app',
    messageCounts: {}
  })
  const messagesRef = useRef<Record<string, Block[]>>({})

  stateRef.current = {
    workspaces,
    selected,
    active,
    status: statusBySession,
    defaultBackend,
    messageCounts: Object.fromEntries(
      Object.entries(messagesBySession).map(([k, v]) => [k, v.length])
    )
  }
  messagesRef.current = messagesBySession

  const rpcAddWorkspace = useCallback(
    async (path: string) => {
      if (!workspaces.includes(path)) await persist([path, ...workspaces])
    },
    [workspaces, persist]
  )

  const rpcStartSession = useCallback(
    async (
      workspacePath: string,
      backend: Backend,
      mode: ActiveMode,
      sessionId?: string | null
    ): Promise<{ sessionId: string }> => {
      const id = sessionId ?? crypto.randomUUID()
      setSelected({
        workspacePath,
        sessionId: id,
        title: mode === 'new' ? 'New session' : 'Resumed session',
        mode,
        backend
      })
      await startLive(id, workspacePath, mode, backend)
      return { sessionId: id }
    },
    [startLive]
  )

  const rpcSelectSession = useCallback(
    (workspacePath: string, sessionId: string, title: string) => {
      handleSelect({ workspacePath, sessionId, title, mode: 'readonly' })
    },
    [handleSelect]
  )

  const rpcSendInput = useCallback(
    async (sessionId: string, text: string) => {
      appendBlocks(sessionId, [{ kind: 'user-text', text }])
      handleTurnStart(sessionId)
      await window.api.claude.sendInput(sessionId, text)
    },
    [appendBlocks, handleTurnStart]
  )

  const rpcWaitResult = useCallback((sessionId: string, timeoutMs = 60000) => {
    return new Promise<unknown>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        waitersRef.current.delete(sessionId)
        reject(new Error('timeout'))
      }, timeoutMs)
      waitersRef.current.set(sessionId, { resolve, reject, timer })
    })
  }, [])

  const actionsRef = useRef({
    addWorkspace: rpcAddWorkspace,
    startSession: rpcStartSession,
    selectSession: rpcSelectSession,
    activate,
    sendInput: rpcSendInput,
    setBackend: setDefaultBackend,
    waitResult: rpcWaitResult
  })
  actionsRef.current = {
    addWorkspace: rpcAddWorkspace,
    startSession: rpcStartSession,
    selectSession: rpcSelectSession,
    activate,
    sendInput: rpcSendInput,
    setBackend: setDefaultBackend,
    waitResult: rpcWaitResult
  }

  useEffect(() => {
    const uninstall = installRpcBridge({
      getSnapshot: () => stateRef.current,
      getMessages: (id) => messagesRef.current[id] ?? [],
      actions: {
        addWorkspace: (...args) => actionsRef.current.addWorkspace(...args),
        startSession: (...args) => actionsRef.current.startSession(...args),
        selectSession: (...args) => actionsRef.current.selectSession(...args),
        activate: (...args) => actionsRef.current.activate(...args),
        sendInput: (...args) => actionsRef.current.sendInput(...args),
        setBackend: (...args) => actionsRef.current.setBackend(...args),
        waitResult: (...args) => actionsRef.current.waitResult(...args)
      }
    })
    return uninstall
  }, [])

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

  const isStartingTerminal =
    !!selected &&
    selected.backend === 'terminal' &&
    selected.mode !== 'readonly' &&
    terminalReady[selected.sessionId] === false

  const showChatPane =
    !selected ||
    selected.backend !== 'terminal' ||
    selected.mode === 'readonly' ||
    isStartingTerminal

  return (
    <div className="app">
      <Sidebar
        workspaces={workspaces}
        selected={selected}
        defaultBackend={defaultBackend}
        active={active}
        messagesBySession={messagesBySession}
        onChangeBackend={setDefaultBackend}
        onAddWorkspace={addWorkspaceDialog}
        onSelect={handleSelect}
        onStartClaude={startClaudeIn}
        onStopLive={handleStopLive}
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
              visible={visible && terminalReady[t.sessionId] !== false}
              onExit={(code) => handleTerminalExit(t.sessionId, code)}
              onReady={() => handleTerminalReady(t.sessionId)}
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
        {isStartingTerminal && (
          <div className="terminal-loading-overlay">
            <div className="throbber" />
            <div className="throbber-label">터미널 시작 중…</div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
