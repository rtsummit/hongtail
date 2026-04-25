import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Sidebar from './components/Sidebar'
import ChatPane from './components/ChatPane'
import TerminalSession from './components/TerminalSession'
import SettingsModal from './components/SettingsModal'
import { fontStackToCss, loadSettings, saveSettings, type AppSettings } from './settings'
import { ToolDefaultOpenContext } from './toolContext'
import { parseClaudeEvent } from './claudeEvents'
import {
  extractContextTokens,
  extractContextWindowFromResult,
  extractControlResponse,
  extractInit,
  extractRateLimit,
  extractUsage,
  isResultEvent,
  pickVerb
} from './sessionStatus'
import {
  installRpcBridge,
  type ActiveEntry,
  type ActiveMode,
  type RpcSnapshot,
  type RpcWaiterEntry
} from './rpcBridge'
import type { Backend, Block, SelectedSession, SessionStatus, WorkspaceEntry } from './types'
import type { SessionAlias } from '../../preload/index.d'

function App(): React.JSX.Element {
  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([])
  const [selected, setSelected] = useState<SelectedSession | null>(null)
  const [messagesBySession, setMessagesBySession] = useState<Record<string, Block[]>>({})
  const [active, setActive] = useState<Record<string, ActiveEntry>>({})
  const [terminalReady, setTerminalReady] = useState<Record<string, boolean>>({})
  const [statusBySession, setStatusBySession] = useState<Record<string, SessionStatus>>({})
  const [aliasesBySession, setAliasesBySession] = useState<Record<string, SessionAlias>>({})
  const [defaultBackend, setDefaultBackend] = useState<Backend>('app')
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const stored = Number(localStorage.getItem('hongluade.sidebarWidth'))
    return Number.isFinite(stored) && stored >= 180 && stored <= 600 ? stored : 240
  })
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  const [settingsOpen, setSettingsOpen] = useState(false)

  const handleSettingsChange = useCallback((next: AppSettings) => {
    setSettings(next)
    saveSettings(next)
  }, [])
  const subscriptionsRef = useRef<Map<string, () => void>>(new Map())
  const waitersRef = useRef<Map<string, RpcWaiterEntry>>(new Map())
  const pendingControlRef = useRef<Map<string, { rollback?: () => void }>>(new Map())

  const handleSplitterPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = sidebarWidth
      const target = e.currentTarget
      target.setPointerCapture(e.pointerId)
      target.classList.add('active')
      const move = (ev: PointerEvent): void => {
        const next = Math.min(600, Math.max(180, startWidth + (ev.clientX - startX)))
        setSidebarWidth(next)
      }
      const up = (ev: PointerEvent): void => {
        target.releasePointerCapture(ev.pointerId)
        target.classList.remove('active')
        target.removeEventListener('pointermove', move)
        target.removeEventListener('pointerup', up)
        const finalWidth = Math.min(
          600,
          Math.max(180, startWidth + (ev.clientX - startX))
        )
        localStorage.setItem('hongluade.sidebarWidth', String(finalWidth))
      }
      target.addEventListener('pointermove', move)
      target.addEventListener('pointerup', up)
    },
    [sidebarWidth]
  )

  useEffect(() => {
    void window.api.sessionAliases.list().then((map) => {
      setAliasesBySession(map ?? {})
    })
  }, [])

  useEffect(() => {
    void window.api.workspaces.load().then((items) => {
      // Defensive: tolerate older main-process build that still returns string[]
      const normalized: WorkspaceEntry[] = (items as unknown[])
        .map((item): WorkspaceEntry | null => {
          if (typeof item === 'string') return { path: item }
          if (item && typeof item === 'object' && typeof (item as { path?: unknown }).path === 'string') {
            const o = item as { path: string; alias?: unknown }
            return typeof o.alias === 'string' && o.alias.trim()
              ? { path: o.path, alias: o.alias }
              : { path: o.path }
          }
          return null
        })
        .filter((x): x is WorkspaceEntry => x !== null)
      setWorkspaces(normalized)
    })
  }, [])

  const persist = useCallback(async (next: WorkspaceEntry[]) => {
    setWorkspaces(next)
    await window.api.workspaces.save(next)
  }, [])

  const addWorkspaceDialog = useCallback(async () => {
    const picked = await window.api.workspaces.pickDirectory()
    if (!picked) return
    if (workspaces.some((w) => w.path === picked)) return
    await persist([{ path: picked }, ...workspaces])
  }, [workspaces, persist])

  const handleSetAlias = useCallback(
    async (path: string, alias: string) => {
      const trimmed = alias.trim()
      const next = workspaces.map((w) =>
        w.path === path ? (trimmed ? { path, alias: trimmed } : { path }) : w
      )
      await persist(next)
    },
    [workspaces, persist]
  )

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

  const prependBlocks = useCallback((sessionId: string, blocks: Block[]) => {
    if (blocks.length === 0) return
    setMessagesBySession((prev) => ({
      ...prev,
      [sessionId]: [...blocks, ...(prev[sessionId] ?? [])]
    }))
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

      const rateLimit = extractRateLimit(event)
      if (rateLimit) {
        setStatusBySession((prev) => ({
          ...prev,
          [sessionId]: {
            ...prev[sessionId],
            thinking: prev[sessionId]?.thinking ?? false,
            rateLimit
          }
        }))
      }

      const init = extractInit(event)
      if (init) {
        setStatusBySession((prev) => ({
          ...prev,
          [sessionId]: {
            ...prev[sessionId],
            thinking: prev[sessionId]?.thinking ?? false,
            model: init.model,
            permissionMode: init.permissionMode,
            contextWindow: init.contextWindow ?? prev[sessionId]?.contextWindow
          }
        }))
      }

      const ctxTokens = extractContextTokens(event)
      if (ctxTokens != null) {
        setStatusBySession((prev) => ({
          ...prev,
          [sessionId]: {
            ...prev[sessionId],
            thinking: prev[sessionId]?.thinking ?? false,
            contextUsedTokens: ctxTokens
          }
        }))
      }

      const ctxWindow = extractContextWindowFromResult(
        event,
        statusBySession[sessionId]?.model
      )
      if (ctxWindow != null) {
        setStatusBySession((prev) => ({
          ...prev,
          [sessionId]: {
            ...prev[sessionId],
            thinking: prev[sessionId]?.thinking ?? false,
            contextWindow: ctxWindow
          }
        }))
      }

      const ctlResp = extractControlResponse(event)
      if (ctlResp) {
        const pending = pendingControlRef.current.get(ctlResp.requestId)
        if (pending) {
          pendingControlRef.current.delete(ctlResp.requestId)
          if (!ctlResp.success) {
            console.error(
              `control request ${ctlResp.requestId} failed:`,
              ctlResp.error
            )
            pending.rollback?.()
          }
        }
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
    // Always wait at least 2000ms so the throbber is visible even when claude
    // resumes nearly instantly (cached context).
    window.setTimeout(() => {
      setTerminalReady((prev) =>
        prev[sessionId] ? prev : { ...prev, [sessionId]: true }
      )
    }, 2000)
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

  const handleReorderWorkspaces = useCallback(
    async (fromPath: string, toPath: string, before: boolean) => {
      if (fromPath === toPath) return
      const moving = workspaces.find((w) => w.path === fromPath)
      if (!moving) return
      const next = workspaces.filter((w) => w.path !== fromPath)
      const idx = next.findIndex((w) => w.path === toPath)
      if (idx === -1) return
      next.splice(before ? idx : idx + 1, 0, moving)
      await persist(next)
    },
    [workspaces, persist]
  )

  const handleRemoveWorkspace = useCallback(
    async (path: string) => {
      const liveInWorkspace = Object.entries(active).filter(
        ([, a]) => a.workspacePath === path
      )
      const livePart =
        liveInWorkspace.length > 0
          ? `\n\n진행 중인 라이브 대화 ${liveInWorkspace.length}개도 함께 종료됩니다.`
          : ''
      const ok = window.confirm(
        `워크스페이스를 목록에서 제거할까요?\n${path}${livePart}\n\n(저장된 대화 기록 자체는 삭제되지 않습니다)`
      )
      if (!ok) return

      for (const [sessionId, a] of liveInWorkspace) {
        try {
          if (a.backend === 'terminal') {
            await window.api.pty.kill(sessionId)
          } else {
            await window.api.claude.stopSession(sessionId)
          }
        } catch (err) {
          console.error('stop session during workspace remove failed:', err)
        }
      }

      setActive((prev) => {
        const next = { ...prev }
        for (const [sessionId] of liveInWorkspace) delete next[sessionId]
        return next
      })
      setSelected((prev) => (prev?.workspacePath === path ? null : prev))
      await persist(workspaces.filter((w) => w.path !== path))
    },
    [active, workspaces, persist]
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

  const handleSetPermissionMode = useCallback(async (sessionId: string, mode: string) => {
    let prevMode: string | undefined
    setStatusBySession((prev) => {
      prevMode = prev[sessionId]?.permissionMode
      return {
        ...prev,
        [sessionId]: {
          ...prev[sessionId],
          thinking: prev[sessionId]?.thinking ?? false,
          permissionMode: mode
        }
      }
    })
    const rollback = (): void =>
      setStatusBySession((prev) => ({
        ...prev,
        [sessionId]: {
          ...prev[sessionId],
          thinking: prev[sessionId]?.thinking ?? false,
          permissionMode: prevMode
        }
      }))
    try {
      const requestId = await window.api.claude.controlRequest(sessionId, {
        subtype: 'set_permission_mode',
        mode
      })
      pendingControlRef.current.set(requestId, { rollback })
    } catch (err) {
      console.error('set_permission_mode send failed:', err)
      rollback()
    }
  }, [])

  const handleSetModel = useCallback(async (sessionId: string, model: string) => {
    let prevModel: string | undefined
    setStatusBySession((prev) => {
      prevModel = prev[sessionId]?.model
      return {
        ...prev,
        [sessionId]: {
          ...prev[sessionId],
          thinking: prev[sessionId]?.thinking ?? false,
          model
        }
      }
    })
    const rollback = (): void =>
      setStatusBySession((prev) => ({
        ...prev,
        [sessionId]: {
          ...prev[sessionId],
          thinking: prev[sessionId]?.thinking ?? false,
          model: prevModel
        }
      }))
    try {
      const requestId = await window.api.claude.controlRequest(sessionId, {
        subtype: 'set_model',
        model
      })
      pendingControlRef.current.set(requestId, { rollback })
    } catch (err) {
      console.error('set_model send failed:', err)
      rollback()
    }
  }, [])

  const handleInterrupt = useCallback(async (sessionId: string) => {
    try {
      const requestId = await window.api.claude.controlRequest(sessionId, {
        subtype: 'interrupt'
      })
      // Mark this request so the response handler doesn't log it as a failure.
      // Status updates (thinking → false) come from the upcoming `result` event
      // that claude emits when a turn ends — so we don't mutate state here.
      pendingControlRef.current.set(requestId, {})
    } catch (err) {
      console.error('interrupt send failed:', err)
    }
  }, [])

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
        // On readonly open, try to import the latest /rename from the jsonl
        // into the alias store. Local store wins if it's more recent.
        void window.api.sessionAliases
          .sync(s.workspacePath, s.sessionId)
          .then((entry) => {
            setAliasesBySession((prev) => {
              if (!entry) {
                if (!(s.sessionId in prev)) return prev
                const next = { ...prev }
                delete next[s.sessionId]
                return next
              }
              const cur = prev[s.sessionId]
              if (cur && cur.alias === entry.alias && cur.setAt === entry.setAt) return prev
              return { ...prev, [s.sessionId]: entry }
            })
          })
          .catch((err) => console.error('alias sync failed:', err))
      }
    },
    [active]
  )

  const handleSetSessionAlias = useCallback(
    async (sessionId: string, alias: string) => {
      try {
        const entry = await window.api.sessionAliases.set(sessionId, alias)
        setAliasesBySession((prev) => {
          if (!entry) {
            if (!(sessionId in prev)) return prev
            const next = { ...prev }
            delete next[sessionId]
            return next
          }
          return { ...prev, [sessionId]: entry }
        })
      } catch (err) {
        console.error('set session alias failed:', err)
      }
    },
    []
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
    workspaces: workspaces.map((w) => w.path),
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
      if (!workspaces.some((w) => w.path === path)) {
        await persist([{ path }, ...workspaces])
      }
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

  const rpcControlRequest = useCallback(
    async (sessionId: string, request: Record<string, unknown>): Promise<string> => {
      return await window.api.claude.controlRequest(sessionId, request)
    },
    []
  )

  const actionsRef = useRef({
    addWorkspace: rpcAddWorkspace,
    startSession: rpcStartSession,
    selectSession: rpcSelectSession,
    activate,
    sendInput: rpcSendInput,
    controlRequest: rpcControlRequest,
    setBackend: setDefaultBackend,
    waitResult: rpcWaitResult
  })
  actionsRef.current = {
    addWorkspace: rpcAddWorkspace,
    startSession: rpcStartSession,
    selectSession: rpcSelectSession,
    activate,
    sendInput: rpcSendInput,
    controlRequest: rpcControlRequest,
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
        controlRequest: (...args) => actionsRef.current.controlRequest(...args),
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
  const selectedAlias = selected ? aliasesBySession[selected.sessionId]?.alias : undefined
  const selectedForChat = selected
    ? selectedAlias
      ? { ...selected, title: selectedAlias }
      : selected
    : null

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

  const appStyle: Record<string, string> = {
    '--sidebar-width': `${sidebarWidth}px`,
    '--ui-font-size': `${settings.fontSize}px`,
    fontSize: `${settings.fontSize}px`
  }
  if (settings.uiFonts.length > 0) appStyle['--ui-font'] = fontStackToCss(settings.uiFonts)
  if (settings.monoFonts.length > 0) appStyle['--mono-font'] = fontStackToCss(settings.monoFonts)

  return (
    <ToolDefaultOpenContext.Provider value={settings.toolCardsDefaultOpen}>
    <div className="app" style={appStyle as React.CSSProperties}>
      <Sidebar
        workspaces={workspaces}
        selected={selected}
        defaultBackend={defaultBackend}
        active={active}
        messagesBySession={messagesBySession}
        aliasesBySession={aliasesBySession}
        onChangeBackend={setDefaultBackend}
        onAddWorkspace={addWorkspaceDialog}
        onRemoveWorkspace={handleRemoveWorkspace}
        onReorderWorkspaces={handleReorderWorkspaces}
        onSetAlias={handleSetAlias}
        onSetSessionAlias={handleSetSessionAlias}
        onOpenSettings={() => setSettingsOpen(true)}
        onSelect={handleSelect}
        onStartClaude={startClaudeIn}
        onStopLive={handleStopLive}
      />
      <div
        className="splitter"
        onPointerDown={handleSplitterPointerDown}
        title="드래그하여 사이드바 너비 조정"
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
            selected={selectedForChat}
            messages={messages}
            status={status}
            settings={settings}
            onAppendBlocks={appendBlocks}
            onReplaceBlocks={replaceBlocks}
            onPrependBlocks={prependBlocks}
            onActivate={activate}
            onTurnStart={handleTurnStart}
            onSetPermissionMode={handleSetPermissionMode}
            onSetModel={handleSetModel}
            onInterrupt={handleInterrupt}
          />
        )}
        {isStartingTerminal && (
          <div className="terminal-loading-overlay">
            <div className="throbber" />
            <div className="throbber-label">터미널 시작 중…</div>
          </div>
        )}
      </div>
      <SettingsModal
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onChange={handleSettingsChange}
      />
    </div>
    </ToolDefaultOpenContext.Provider>
  )
}

export default App
