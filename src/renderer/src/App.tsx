import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Sidebar from './components/Sidebar'
import ChatPane from './components/ChatPane'
import SideChatPanel from './components/SideChatPanel'
import TerminalSession, { type TerminalSearchHandle } from './components/TerminalSession'
import { useTerminalStatusWatch } from './hooks/useTerminalStatusWatch'
import SettingsModal from './components/SettingsModal'
import FindBar from './components/FindBar'
import { appConfirm, ConfirmHost } from './confirm'
import { buildBtwSystemPrompt } from './btwPrompt'
import { fontStackToCss, loadSettings, saveSettings, type AppSettings } from './settings'
import { i18n, resolveLang } from './locale'
import { ToolDefaultOpenContext } from './toolContext'
import { parseClaudeEvent } from './claudeEvents'
import {
  extractAllModelContextWindows,
  extractAssistantModel,
  extractContextTokens,
  extractContextWindowFromResult,
  extractControlResponse,
  extractInit,
  extractPermissionModeEvent,
  extractRateLimit,
  extractResultTotals,
  extractUsage,
  isAssistantTurnEnd,
  isResultEvent,
  parseContextWindowFromModel,
  patchSessionStatus,
  pickVerb
} from './sessionStatus'
import {
  cacheContextWindow,
  getCachedContextWindow,
  stripModelSuffix
} from './contextWindowCache'
import {
  installRpcBridge,
  type ActiveEntry,
  type ActiveMode,
  type RpcSnapshot,
  type RpcWaiterEntry
} from './rpcBridge'
import type {
  AskUserQuestionDef,
  Backend,
  Block,
  SelectedSession,
  SessionStatus,
  WorkspaceEntry
} from './types'
import type { SessionAlias } from '../../preload/index.d'

// Shift+Tab 으로 사이클링되는 permission mode 들. Claude Code CLI 와 동일하게
// bypassPermissions / auto 는 우발 진입 방지를 위해 사이클에서 제외 — 메뉴로만 진입.
const PERMISSION_MODE_CYCLE = ['default', 'acceptEdits', 'plan'] as const

// main 측 src/main/workspaces.ts 와 동일 규칙. web 모드 텍스트 입력 경로와
// OS 다이얼로그(backslash) 가 한 entry 로 묶이게 forward slash 로 통일.
function normalizeWorkspacePath(p: string): string {
  let s = p.trim()
  if (!s) return s
  s = s.replace(/\\/g, '/')
  if (/^[a-z]:/.test(s)) s = s[0].toUpperCase() + s.slice(1)
  if (s.length > 3 && s.endsWith('/')) s = s.slice(0, -1)
  return s
}

// 새로고침을 가로질러 selected 만 복원한다. 라이브 mode/backend 는 mount 직후
// listRunning reconcile 이 active 매핑으로 덮어쓰므로, 복원 시점엔 일단
// readonly 로 강제. messages·status 는 jsonl 리플레이로 ChatPane / reconcile
// 흐름이 자동 재구성한다.
const SELECTED_STORAGE_KEY = 'hongtail.selected'
const SIDEBAR_WIDTH_KEY = 'hongtail.sidebarWidth'
const SIDE_CHAT_COLLAPSED_KEY = 'hongtail.sideChatCollapsed'

function loadSelectedFromStorage(): SelectedSession | null {
  try {
    const raw = sessionStorage.getItem(SELECTED_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SelectedSession> | null
    if (
      parsed &&
      typeof parsed.workspacePath === 'string' &&
      typeof parsed.sessionId === 'string' &&
      typeof parsed.title === 'string'
    ) {
      return {
        workspacePath: parsed.workspacePath,
        sessionId: parsed.sessionId,
        title: parsed.title,
        mode: 'readonly',
        backend: typeof parsed.backend === 'string' ? (parsed.backend as Backend) : undefined
      }
    }
  } catch {
    /* corrupt or unavailable */
  }
  return null
}

function saveSelectedToStorage(s: SelectedSession | null): void {
  try {
    if (s) sessionStorage.setItem(SELECTED_STORAGE_KEY, JSON.stringify(s))
    else sessionStorage.removeItem(SELECTED_STORAGE_KEY)
  } catch {
    /* quota / private mode */
  }
}

function App(): React.JSX.Element {
  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([])
  const [selected, setSelected] = useState<SelectedSession | null>(() =>
    loadSelectedFromStorage()
  )
  const [messagesBySession, setMessagesBySession] = useState<Record<string, Block[]>>({})
  const [active, setActive] = useState<Record<string, ActiveEntry>>({})
  const [terminalReady, setTerminalReady] = useState<Record<string, boolean>>({})
  const [statusBySession, setStatusBySession] = useState<Record<string, SessionStatus>>({})
  const [aliasesBySession, setAliasesBySession] = useState<Record<string, SessionAlias>>({})
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
    return Number.isFinite(stored) && stored >= 180 && stored <= 600 ? stored : 240
  })
  // 모바일에서만 의미 — 사이드바 toggle. 데스크톱은 CSS 로 항상 보이므로
  // 이 state 는 무관.
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  // 라이브 settings 를 콜백 안에서 stale 없이 읽기 위한 ref. 새 세션 spawn 시
  // settings.defaultPermissionMode / 터미널 명령 string 등이 참조.
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  // settings.language 변화 시 i18n 동기화. 'auto' 면 browser locale 로 해석.
  useEffect(() => {
    const target = resolveLang(settings.language)
    if (i18n.language !== target) void i18n.changeLanguage(target)
  }, [settings.language])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [btwMessagesBySession, setBtwMessagesBySession] = useState<Record<string, Block[]>>({})
  const [btwThinkingBySession, setBtwThinkingBySession] = useState<Record<string, boolean>>({})
  const [sideChatCollapsed, setSideChatCollapsed] = useState<boolean>(() => {
    const stored = localStorage.getItem(SIDE_CHAT_COLLAPSED_KEY)
    if (stored !== null) return stored === '1'
    // 모바일 첫 진입은 collapsed 로 시작. 안 하면 320px overlay 가
    // 채팅 본체 위에 통째로 깔려 첫 인상이 깨진다. localStorage 저장 시점부터는
    // 사용자 선택 우선.
    return typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches
  })
  const btwSubscriptionsRef = useRef<Map<string, () => void>>(new Map())
  const terminalRefs = useRef<Map<string, TerminalSearchHandle | null>>(new Map())
  const activeTerminalRef = useRef<TerminalSearchHandle | null>(null)

  // Ctrl+Tab MRU cycling — VS Code 패턴.
  //   mruRef : most-recently-used selected 들의 stack ([0] = 가장 최근).
  //   cyclingRef / cycleIdxRef : Ctrl 누르고 있는 동안의 cycle 상태. Ctrl 떼는
  //     순간 현재 위치의 세션이 head 로 확정되며 cycle 종료.
  //   - Ctrl+Tab        → mru 의 다음 (idx +1) 으로
  //   - Ctrl+Shift+Tab  → 반대 방향 (idx -1)
  const mruRef = useRef<SelectedSession[]>([])
  const cyclingRef = useRef(false)
  const cycleIdxRef = useRef(0)

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
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(finalWidth))
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

  // selected 를 sessionStorage 에 sync — 웹/Electron 새로고침을 가로질러 복원.
  // sessionStorage 라 탭 닫으면 사라지고 디바이스 간 동기화도 없다 (의도).
  useEffect(() => {
    saveSelectedToStorage(selected)
  }, [selected])

  // Multi-client 동기화 — 5초마다 sidebar 의 session list refresh. 다른 client
  // 가 시작/종료한 세션은 jsonl 이 생기는 시점에 자동으로 readonly entry 로
  // 잡힘. SSE / subscribe 흐름 없이 단순 polling.
  const [sidebarRefreshTick, setSidebarRefreshTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setSidebarRefreshTick((n) => n + 1), 5000)
    return () => window.clearInterval(id)
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
    let picked = await window.api.workspaces.pickDirectory()
    // Web 환경에서는 OS 다이얼로그가 없어 null 이 돌아온다 → 텍스트 입력으로
    // fallback. 호스트 머신 기준 절대 경로를 받는다.
    if (!picked) {
      const typed = window.prompt(i18n.t('app.workspacePathPrompt'))
      if (!typed) return
      picked = typed.trim()
      if (!picked) return
    }
    picked = normalizeWorkspacePath(picked)
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
    (
      sessionId: string,
      event: unknown,
      options?: { appendMessages?: boolean; readonly?: boolean }
    ) => {
      // jsonl tail 흐름이 ChatPane 에서 이미 messages 를 onAppendBlocks 로
      // 그렸을 때 중복 append 방지를 위해 status 추출만 돌리는 옵션.
      if (options?.appendMessages !== false) {
        const parsed = parseClaudeEvent(event)
        if (parsed.length > 0) {
          appendBlocks(sessionId, parsed)
        }
      }

      // readonly 는 historical jsonl 리플레이라 thinking·rateLimit·
      // permissionMode·세션 누적 토큰·control_response 같은 "라이브 상태"
      // 시그널을 건드리면 안 된다. model/contextWindow/contextUsedTokens 만
      // 반영해서 UsageBar 의 Context% 가 뜨게 한다.
      const readonly = options?.readonly === true

      if (!readonly) {
        const usage = extractUsage(event)
        if (usage?.outputTokens !== undefined) {
          setStatusBySession((prev) =>
            patchSessionStatus(prev, sessionId, { outputTokens: usage.outputTokens })
          )
        }

        const rateLimit = extractRateLimit(event)
        if (rateLimit) {
          setStatusBySession((prev) => patchSessionStatus(prev, sessionId, { rateLimit }))
        }
      }

      const init = extractInit(event)
      if (init) {
        if (init.contextWindow) {
          cacheContextWindow(init.model, init.contextWindow)
          cacheContextWindow(stripModelSuffix(init.model), init.contextWindow)
        }
        setStatusBySession((prev) =>
          patchSessionStatus(prev, sessionId, (cur) => ({
            model: init.model,
            permissionMode: readonly ? cur?.permissionMode : init.permissionMode,
            contextWindow: init.contextWindow ?? cur?.contextWindow
          }))
        )
      } else {
        // assistant.message.model 로 model 추적. init 이 못 오는 케이스:
        // - readonly jsonl tail (system/init 이 jsonl 에 없음)
        // - resume / subscription race
        // - /model 로 mid-session 스위치 (claude CLI 가 새 init 을 다시 emit 안
        //   하는 듯, 다음 assistant 만 새 model 로 옴)
        //
        // 비교는 stripModelSuffix 로. init 이 박은 `claude-opus-4-7[1m]` 와
        // 다음 assistant 의 bare `claude-opus-4-7` 는 같은 모델로 취급 → no-op.
        // 다른 family 로 갈아타면 strip 결과가 달라 업데이트. contextWindow 는
        // 새 model 의 suffix → cache 순서로 추론하고, 둘 다 실패하면 cur 값을
        // 살려둔다 (라이브에서 init 이 줬던 분모 유지).
        const assistantModel = extractAssistantModel(event)
        if (assistantModel) {
          setStatusBySession((prev) =>
            patchSessionStatus(prev, sessionId, (cur) => {
              const curBare = cur?.model ? stripModelSuffix(cur.model) : null
              if (curBare === assistantModel) return null
              return {
                model: assistantModel,
                contextWindow:
                  parseContextWindowFromModel(assistantModel) ??
                  getCachedContextWindow(assistantModel) ??
                  cur?.contextWindow
              }
            })
          )
        }
        if (!readonly) {
          const pmode = extractPermissionModeEvent(event)
          if (pmode) {
            setStatusBySession((prev) =>
              patchSessionStatus(prev, sessionId, { permissionMode: pmode })
            )
          }
        }
      }

      const ctxTokens = extractContextTokens(event)
      if (ctxTokens != null) {
        setStatusBySession((prev) =>
          patchSessionStatus(prev, sessionId, { contextUsedTokens: ctxTokens })
        )
      }

      const allCtxWindows = extractAllModelContextWindows(event)
      if (allCtxWindows) {
        for (const [model, cw] of Object.entries(allCtxWindows)) {
          cacheContextWindow(model, cw)
          cacheContextWindow(stripModelSuffix(model), cw)
        }
      }

      const ctxWindow = extractContextWindowFromResult(
        event,
        statusBySession[sessionId]?.model
      )
      if (ctxWindow != null) {
        setStatusBySession((prev) =>
          patchSessionStatus(prev, sessionId, { contextWindow: ctxWindow })
        )
      }

      if (readonly) return

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

      // assistant chunk 도착 = thinking 진행 중 신호. terminal 백엔드는
      // ChatPane 을 안 거치므로 onTurnStart 호출이 없어 이게 thinking=true
      // 의 유일한 트리거. stream-json (app) 백엔드는 onTurnStart 가 이미
      // true 로 set 했으니 idempotent.
      const ev = event as { type?: string; parent_tool_use_id?: unknown; isSidechain?: unknown }
      if (
        ev?.type === 'assistant' &&
        ev.parent_tool_use_id == null &&
        ev.isSidechain !== true &&
        !isAssistantTurnEnd(event)
      ) {
        setStatusBySession((prev) =>
          patchSessionStatus(prev, sessionId, (cur) =>
            cur?.thinking ? null : { thinking: true }
          )
        )
      }

      // 'terminal' 백엔드는 stream-json result 이벤트가 없으니 assistant
      // record 의 stop_reason='end_turn'/'stop_sequence' 로 turn 종료를 감지.
      // stream-json 모드에서도 결국 result 가 곧 따라오니 idempotent.
      if (isAssistantTurnEnd(event)) {
        setStatusBySession((prev) =>
          patchSessionStatus(prev, sessionId, (cur) =>
            !cur || cur.thinking === false ? null : { thinking: false }
          )
        )
      }

      if (isResultEvent(event)) {
        const finalUsage = extractUsage(event)
        const totals = extractResultTotals(event)
        setStatusBySession((prev) =>
          patchSessionStatus(prev, sessionId, (cur) => {
            const cumulative = totals
              ? {
                  sessionInputTokens: (cur?.sessionInputTokens ?? 0) + totals.inputTokens,
                  sessionCacheTokens:
                    (cur?.sessionCacheTokens ?? 0) +
                    totals.cacheReadTokens +
                    totals.cacheCreationTokens,
                  sessionOutputTokens: (cur?.sessionOutputTokens ?? 0) + totals.outputTokens,
                  sessionCostUsd: (cur?.sessionCostUsd ?? 0) + totals.costUsd
                }
              : null
            return {
              thinking: false,
              usage: finalUsage ?? cur?.usage,
              ...(cumulative ?? {})
            }
          })
        )

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

  const handleBtwEvent = useCallback(
    (ownerId: string, event: unknown) => {
      const parsed = parseClaudeEvent(event)
      if (parsed.length > 0) {
        setBtwMessagesBySession((prev) => ({
          ...prev,
          [ownerId]: [...(prev[ownerId] ?? []), ...parsed]
        }))
      }
      const ev = event as { type?: string }
      if (
        isResultEvent(event) ||
        ev?.type === 'closed' ||
        ev?.type === 'spawn_error'
      ) {
        setBtwThinkingBySession((prev) =>
          prev[ownerId] ? { ...prev, [ownerId]: false } : prev
        )
      }
    },
    []
  )

  const ensureBtwSubscription = useCallback(
    (ownerId: string) => {
      if (btwSubscriptionsRef.current.has(ownerId)) return
      const unsub = window.api.btw.onEvent(ownerId, (event) =>
        handleBtwEvent(ownerId, event)
      )
      btwSubscriptionsRef.current.set(ownerId, unsub)
    },
    [handleBtwEvent]
  )

  const handleBtwAsk = useCallback(
    async (text: string) => {
      if (!selected) return
      const ownerId = selected.sessionId
      ensureBtwSubscription(ownerId)
      const userBlock: Block = { kind: 'user-text', text }
      const mainHistorySnap = messagesBySession[ownerId] ?? []
      const btwHistorySnap = btwMessagesBySession[ownerId] ?? []
      const systemPrompt = buildBtwSystemPrompt(mainHistorySnap, btwHistorySnap)

      setBtwMessagesBySession((prev) => ({
        ...prev,
        [ownerId]: [...(prev[ownerId] ?? []), userBlock]
      }))
      setBtwThinkingBySession((prev) => ({ ...prev, [ownerId]: true }))

      try {
        await window.api.btw.ask({
          ownerId,
          workspacePath: selected.workspacePath,
          systemPrompt,
          question: text
        })
      } catch (err) {
        setBtwMessagesBySession((prev) => ({
          ...prev,
          [ownerId]: [
            ...(prev[ownerId] ?? []),
            { kind: 'error', text: `BTW 시작 실패: ${String(err)}` }
          ]
        }))
        setBtwThinkingBySession((prev) => ({ ...prev, [ownerId]: false }))
      }
    },
    [selected, messagesBySession, btwMessagesBySession, ensureBtwSubscription]
  )

  const handleBtwCancel = useCallback(async () => {
    if (!selected) return
    const ownerId = selected.sessionId
    try {
      await window.api.btw.cancel(ownerId)
    } catch (err) {
      console.error('btw cancel failed:', err)
    }
    setBtwThinkingBySession((prev) =>
      prev[ownerId] ? { ...prev, [ownerId]: false } : prev
    )
  }, [selected])

  const handleBtwClear = useCallback(() => {
    if (!selected) return
    const ownerId = selected.sessionId
    setBtwMessagesBySession((prev) => {
      if (!(ownerId in prev)) return prev
      const next = { ...prev }
      delete next[ownerId]
      return next
    })
  }, [selected])

  const handleToggleSideChat = useCallback(() => {
    setSideChatCollapsed((prev) => {
      const next = !prev
      localStorage.setItem(SIDE_CHAT_COLLAPSED_KEY, next ? '1' : '0')
      return next
    })
  }, [])

  const ensureClaudeSubscription = useCallback(
    (sessionId: string) => {
      if (subscriptionsRef.current.has(sessionId)) return
      const unsub = window.api.claude.onEvent(sessionId, (event) =>
        handleClaudeEvent(sessionId, event)
      )
      // 자식 → 호스트 incoming control_request 구독.
      // - AskUserQuestion / ExitPlanMode: 호스트 카드 Block 으로 push, 사용자 응답
      //   까지 자식 stdin 회신 보류. (실제 control_response 는 onAskUserQuestion*
      //   / onExitPlanMode* 핸들러에서 송신.)
      // - 그 외 tool_name: Phase 2 fallback — 자동 allow + updatedInput:{}.
      // wire format: docs/host-confirm-ui-plan.md §11.3.
      const unsubCtrl = window.api.claude.onControlRequest(sessionId, (event) => {
        const req = event?.request as
          | {
              subtype?: string
              tool_name?: string
              tool_use_id?: string
              input?: Record<string, unknown>
            }
          | undefined
        const requestId = event?.request_id as string | undefined
        if (!requestId || req?.subtype !== 'can_use_tool') return

        if (req.tool_name === 'AskUserQuestion') {
          const questions = (req.input?.questions as AskUserQuestionDef[] | undefined) ?? []
          appendBlocks(sessionId, [
            {
              kind: 'ask-user-question',
              requestId,
              toolUseId: req.tool_use_id,
              questions
            }
          ])
          return
        }
        if (req.tool_name === 'ExitPlanMode') {
          const plan = (req.input?.plan as string | undefined) ?? ''
          const planFilePath = req.input?.planFilePath as string | undefined
          appendBlocks(sessionId, [
            {
              kind: 'exit-plan-mode',
              requestId,
              toolUseId: req.tool_use_id,
              plan,
              planFilePath
            }
          ])
          return
        }
        // 그 외 deferred tool: 자동 allow (§7 fallback). 일반 도구는 보통
        // bypassPermissions 로 'ask' 까지 안 올라가지만 content-specific ask
        // (`.git/`, `.claude/` safety 룰) 가 올라올 수 있어 안전하게 처리.
        void window.api.claude.respondControl(sessionId, {
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: requestId,
            response: { behavior: 'allow', updatedInput: {} }
          }
        })
      })
      subscriptionsRef.current.set(sessionId, () => {
        unsub()
        unsubCtrl()
      })
    },
    [handleClaudeEvent, appendBlocks]
  )

  // 카드 응답을 control_response 로 변환해 자식에 회신 + Block 의 resolved 갱신.
  // resolved 는 카드 disable + 결과 표시용. wire format §11.3.
  const sendControlAllow = useCallback(
    (sessionId: string, requestId: string, updatedInput: Record<string, unknown>) => {
      void window.api.claude.respondControl(sessionId, {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: requestId,
          response: { behavior: 'allow', updatedInput }
        }
      })
    },
    []
  )

  const sendControlDeny = useCallback(
    (sessionId: string, requestId: string, message: string) => {
      void window.api.claude.respondControl(sessionId, {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: requestId,
          response: { behavior: 'deny', message }
        }
      })
    },
    []
  )

  // requestId 로 messages 안의 카드 Block 을 찾아 resolved 갱신. update 함수가
  // 새 resolved 객체 반환.
  const resolveCardBlock = useCallback(
    (sessionId: string, requestId: string, update: (block: Block) => Block) => {
      setMessagesBySession((prev) => {
        const blocks = prev[sessionId]
        if (!blocks) return prev
        let changed = false
        const next = blocks.map((b) => {
          if (
            (b.kind === 'ask-user-question' || b.kind === 'exit-plan-mode') &&
            b.requestId === requestId
          ) {
            changed = true
            return update(b)
          }
          return b
        })
        if (!changed) return prev
        return { ...prev, [sessionId]: next }
      })
    },
    []
  )

  const handleAskUserQuestionAnswer = useCallback(
    (sessionId: string, requestId: string, answers: Record<string, string>) => {
      // updatedInput 은 원본 input + answers. AskUserQuestionTool.tsx 의 schema
      // (line 56) 가 input 에 questions + 선택적 answers 를 받음. 비어 있으면 자식이
      // 원본 input 사용 (§11.3) 인데 answers 가 비면 모델이 빈 답으로 받음.
      // 안전하게 questions 를 같이 보내 schema 통과.
      let questions: AskUserQuestionDef[] = []
      setMessagesBySession((prev) => {
        const blocks = prev[sessionId]
        if (!blocks) return prev
        for (const b of blocks) {
          if (b.kind === 'ask-user-question' && b.requestId === requestId) {
            questions = b.questions
            break
          }
        }
        return prev
      })
      sendControlAllow(sessionId, requestId, { questions, answers })
      resolveCardBlock(sessionId, requestId, (b) =>
        b.kind === 'ask-user-question' ? { ...b, resolved: { answers } } : b
      )
    },
    [sendControlAllow, resolveCardBlock]
  )

  const handleAskUserQuestionCancel = useCallback(
    (sessionId: string, requestId: string) => {
      sendControlDeny(sessionId, requestId, 'User cancelled the question.')
      resolveCardBlock(sessionId, requestId, (b) =>
        b.kind === 'ask-user-question' ? { ...b, resolved: { cancelled: true as const } } : b
      )
    },
    [sendControlDeny, resolveCardBlock]
  )

  const handleExitPlanModeApprove = useCallback(
    (sessionId: string, requestId: string) => {
      sendControlAllow(sessionId, requestId, {})
      resolveCardBlock(sessionId, requestId, (b) =>
        b.kind === 'exit-plan-mode' ? { ...b, resolved: 'approve' as const } : b
      )
    },
    [sendControlAllow, resolveCardBlock]
  )

  const handleExitPlanModeDeny = useCallback(
    (sessionId: string, requestId: string, message: string) => {
      sendControlDeny(sessionId, requestId, message)
      resolveCardBlock(sessionId, requestId, (b) =>
        b.kind === 'exit-plan-mode' ? { ...b, resolved: 'deny' as const } : b
      )
    },
    [sendControlDeny, resolveCardBlock]
  )

  // readonly 모드의 jsonl tail 흐름이 ChatPane 안에서 일어나지만 status 추출
  // (UsageBar 의 model / contextTokens 등) 은 App 의 setStatusBySession 만 본다.
  // 그래서 ChatPane 이 raw events 배열을 그대로 흘려주면 여기서 messages append
  // 는 빼고 status 만 처리. readonly 의 thinking 같은 라이브 시그널은
  // handleClaudeEvent 안에서 가드된다 — UsageBar 의 Context %·model 만 켜진다.
  const handleLiveJsonlEvents = useCallback(
    (sessionId: string, events: unknown[], readonly?: boolean) => {
      for (const event of events) {
        handleClaudeEvent(sessionId, event, { appendMessages: false, readonly })
      }
    },
    [handleClaudeEvent]
  )

  // 새로고침 reconcile — mount 직후 1회. main 의 살아있는 세션 (app + pty 기반)
  // 을 가져와 active state 를 복원한다. 'app' 백엔드는 stream-json IPC 가 끊긴
  // 상태라 onEvent 재구독 + jsonl 리플레이로 messages/status 도 같이 채운다.
  // 'terminal' 은 active 만 채우면 별도 useEffect 가 jsonl watch 를 걸어 status
  // 만 추출한다.
  //
  // race 노트: app 라이브 세션이 '응답 진행 중' 일 때 새로고침되면 readSession
  // (jsonl) 과 onEvent (stream-json) 양쪽이 같은 마지막 turn 을 노릴 수 있다.
  // jsonl 은 자식이 동시 기록하므로 거의 같은 내용이고, replaceBlocks 가
  // 덮어쓴다. 이후 turn 의 새 stream-json event 는 정상 append. 짧은 race 로
  // 마지막 turn 의 일부 출력이 잃을 수 있지만 PoC 단계에서는 무시한다.
  const reconcileFnsRef = useRef({
    ensureClaudeSubscription,
    handleClaudeEvent,
    replaceBlocks
  })
  reconcileFnsRef.current = {
    ensureClaudeSubscription,
    handleClaudeEvent,
    replaceBlocks
  }
  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      let appActive: Array<{ sessionId: string; workspacePath: string; backend: 'app' }> = []
      let ptyActive: Array<{
        sessionId: string
        workspacePath: string
        backend: 'terminal'
      }> = []
      try {
        const [a, p] = await Promise.all([
          window.api.claude.listActive(),
          window.api.pty.listActive()
        ])
        appActive = a as typeof appActive
        ptyActive = p as typeof ptyActive
      } catch (err) {
        console.error('[reconcile] listActive failed:', err)
        return
      }
      if (cancelled) return

      const all = [...appActive, ...ptyActive]
      if (all.length === 0) {
        // 살아있는 세션 없음 — 복원된 selected 가 있어도 readonly 그대로 둔다
        // (Phase 1 에서 이미 readonly 로 강제됨). ChatPane 이 jsonl 을 자체 로드.
        return
      }

      setActive((prev) => {
        const next = { ...prev }
        for (const a of all) {
          if (next[a.sessionId]) continue
          next[a.sessionId] = {
            workspacePath: a.workspacePath,
            mode: 'resume-full',
            backend: a.backend
          }
        }
        return next
      })

      // 'app' 백엔드 — stream-json IPC 끊김 → 재구독 + jsonl 리플레이
      for (const a of appActive) {
        if (cancelled) return
        reconcileFnsRef.current.ensureClaudeSubscription(a.sessionId)
        try {
          const events = await window.api.claude.readSession(a.workspacePath, a.sessionId)
          if (cancelled) return
          const blocks: Block[] = []
          for (const e of events) {
            blocks.push(...parseClaudeEvent(e))
            // status 추출 (model/permissionMode/contextTokens/usage 등)
            reconcileFnsRef.current.handleClaudeEvent(a.sessionId, e, {
              appendMessages: false
            })
          }
          reconcileFnsRef.current.replaceBlocks(a.sessionId, blocks)
        } catch (err) {
          console.error('[reconcile] readSession failed:', err)
        }
      }

      if (cancelled) return
      // selected 보정 — 복원된 selected 가 라이브로 잡히면 mode/backend 를 active 로 덮어씀.
      // sessionStorage 의 selected 는 readonly 로 강제되어 있었음.
      setSelected((prev) => {
        if (!prev) return prev
        const match = all.find((a) => a.sessionId === prev.sessionId)
        if (!match) return prev
        if (prev.mode !== 'readonly' && prev.backend === match.backend) return prev
        return { ...prev, mode: 'resume-full', backend: match.backend }
      })
    }
    void run()
    return () => {
      cancelled = true
    }
    // mount 1회만. ref 패턴으로 stale closure 회피.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useTerminalStatusWatch(active, handleClaudeEvent)

  const startAppLive = useCallback(
    async (sessionId: string, workspacePath: string, mode: ActiveMode) => {
      ensureClaudeSubscription(sessionId)
      // claude -p emits system/init only on the first turn, so seed the
      // permission mode now from settings — model fills in once init arrives;
      // UsageBar 는 그동안 settings 모드를 placeholder 로 보여준다. Context 는
      // 분자 0 / 분모 미관측 = 0% 로 그려져서 contextWindow 를 seed 안 해도
      // 첫 turn 전부터 0% 게이지가 보인다.
      const permissionMode = settingsRef.current.defaultPermissionMode
      setStatusBySession((prev) =>
        patchSessionStatus(prev, sessionId, (cur) =>
          cur?.permissionMode ? null : { permissionMode }
        )
      )
      try {
        await window.api.claude.startSession(
          workspacePath,
          sessionId,
          mode === 'new' ? 'new' : 'resume',
          permissionMode
        )
        if (mode === 'resume-summary') {
          await new Promise((r) => setTimeout(r, 500))
          await window.api.claude.sendInput(sessionId, '/compact')
          appendBlocks(sessionId, [{ kind: 'system', text: i18n.t('app.compactRequested') }])
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
    (cwd: string, backend: Backend) => {
      const sessionId = crypto.randomUUID()
      setSelected({
        workspacePath: cwd,
        sessionId,
        title: 'New session',
        mode: 'new',
        backend
      })
      void startLive(sessionId, cwd, 'new', backend)
    },
    [startLive]
  )

  const activate = useCallback(
    (mode: 'resume-full' | 'resume-summary', backendOverride?: Backend) => {
      if (!selected) return
      const backend = backendOverride ?? 'app'
      setSelected((prev) => (prev ? { ...prev, mode, backend } : prev))
      void startLive(selected.sessionId, selected.workspacePath, mode, backend)
    },
    [selected, startLive]
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
      const ok = await appConfirm({
        message: `워크스페이스를 목록에서 제거할까요?\n${path}${livePart}\n\n(저장된 대화 기록 자체는 삭제되지 않습니다)`,
        destructive: true
      })
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
      const ok = await appConfirm({
        message: i18n.t('app.confirmStopSession'),
        destructive: true
      })
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

  const handleSetPermissionMode = useCallback(
    async (sessionId: string, mode: string) => {
      let prevMode: string | undefined
      setStatusBySession((prev) =>
        patchSessionStatus(prev, sessionId, (cur) => {
          prevMode = cur?.permissionMode
          return { permissionMode: mode }
        })
      )
      const rollback = (): void =>
        setStatusBySession((prev) =>
          patchSessionStatus(prev, sessionId, { permissionMode: prevMode })
        )
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
    },
    []
  )

  const handleSetModel = useCallback(
    async (sessionId: string, model: string) => {
      let prevModel: string | undefined
      setStatusBySession((prev) =>
        patchSessionStatus(prev, sessionId, (cur) => {
          prevModel = cur?.model
          return { model }
        })
      )
      const rollback = (): void =>
        setStatusBySession((prev) =>
          patchSessionStatus(prev, sessionId, { model: prevModel })
        )
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
    },
    []
  )

  const handleInterrupt = useCallback(async (sessionId: string) => {
    try {
      const requestId = await window.api.claude.controlRequest(sessionId, {
        subtype: 'interrupt'
      })
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
    setStatusBySession((prev) =>
      patchSessionStatus(prev, sessionId, (cur) => ({
        thinking: true,
        turnStart: Date.now(),
        verb: pickVerb(),
        outputTokens: undefined,
        usage: cur?.usage
      }))
    )
  }, [])

  const handleSelect = useCallback(
    (s: SelectedSession | null) => {
      // 모바일에서 세션 선택 시 사이드바 자동 닫힘. 데스크톱은 CSS 가 항상 보이게
      // 처리하므로 이 state 변화는 무관.
      setSidebarOpen(false)
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
    messageCounts: {}
  })
  const messagesRef = useRef<Record<string, Block[]>>({})

  stateRef.current = {
    workspaces: workspaces.map((w) => w.path),
    selected,
    active,
    status: statusBySession,
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
    waitResult: rpcWaitResult
  })
  actionsRef.current = {
    addWorkspace: rpcAddWorkspace,
    startSession: rpcStartSession,
    selectSession: rpcSelectSession,
    activate,
    sendInput: rpcSendInput,
    controlRequest: rpcControlRequest,
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
        waitResult: (...args) => actionsRef.current.waitResult(...args)
      }
    })
    return uninstall
  }, [])

  // Cleanup all subscriptions on unmount
  useEffect(() => {
    const subs = subscriptionsRef.current
    const btwSubs = btwSubscriptionsRef.current
    return () => {
      for (const unsub of subs.values()) unsub()
      subs.clear()
      for (const unsub of btwSubs.values()) unsub()
      btwSubs.clear()
    }
  }, [])

  // Global Ctrl+F to open the find bar (works in both app + terminal modes).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        e.stopPropagation()
        if (findOpen) {
          const input = document.querySelector<HTMLInputElement>('.find-bar .find-input')
          input?.focus()
          input?.select()
        } else {
          setFindOpen(true)
        }
      } else if (e.key === 'Escape' && findOpen) {
        // Let FindBar's own Escape close it; this is a fallback when bar lacks focus.
        const target = e.target as HTMLElement
        if (!target.closest('.find-bar')) {
          setFindOpen(false)
          // 아래 글로벌 ESC interrupt 가 같이 발사되지 않도록 전파 차단.
          e.stopPropagation()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [findOpen])

  // ESC 로 진행 중 turn 인터럽트. bubble 단계로 등록 — 모달/find-bar/slash
  // popup 등 자체 ESC 를 처리하는 곳이 stopPropagation 하면 여기까지 안 옴.
  // textarea·input 안에서도 동작 (textarea ESC 의 default 동작은 없음).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (e.isComposing || e.keyCode === 229) return
      if (!selected) return
      const status = statusBySession[selected.sessionId]
      if (!status?.thinking) return
      e.preventDefault()
      void handleInterrupt(selected.sessionId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, statusBySession, handleInterrupt])

  // selected 변경 시 MRU 갱신. cycle 중에는 갱신 skip — cycle 끝나는 시점에
  // 한 번에 정리 (finishCycle).
  useEffect(() => {
    if (cyclingRef.current) return
    if (!selected) return
    const cur = selected
    mruRef.current = [
      cur,
      ...mruRef.current.filter((s) => s.sessionId !== cur.sessionId)
    ]
  }, [selected])

  const finishCycle = useCallback(() => {
    if (!cyclingRef.current) return
    cyclingRef.current = false
    cycleIdxRef.current = 0
    if (selected) {
      const cur = selected
      mruRef.current = [
        cur,
        ...mruRef.current.filter((s) => s.sessionId !== cur.sessionId)
      ]
    }
  }, [selected])

  // Global Ctrl+Tab MRU cycling.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab' || !e.ctrlKey || e.altKey || e.metaKey) return
      if (e.isComposing || e.keyCode === 229) return
      const mru = mruRef.current
      if (mru.length < 2) return
      e.preventDefault()
      e.stopImmediatePropagation()
      const dir = e.shiftKey ? -1 : 1
      if (!cyclingRef.current) {
        cyclingRef.current = true
        cycleIdxRef.current = dir > 0 ? 1 : mru.length - 1
      } else {
        cycleIdxRef.current =
          (cycleIdxRef.current + dir + mru.length) % mru.length
      }
      const target = mru[cycleIdxRef.current]
      if (target) handleSelect(target)
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === 'Control') finishCycle()
    }
    const onBlur = (): void => finishCycle()
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [handleSelect, finishCycle])

  // Global Ctrl+W to close (stop) the currently-selected live session.
  // handleStopLive 가 자체적으로 confirm 팝업을 띄운다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'w' && e.key !== 'W') return
      if (!e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
      if (e.isComposing || e.keyCode === 229) return
      if (!selected) return
      if (!active[selected.sessionId]) return
      e.preventDefault()
      e.stopImmediatePropagation()
      void handleStopLive(selected.sessionId)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [selected, active, handleStopLive])

  // Global Shift+Tab to cycle permission mode on the active app session.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab' || !e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return
      if (e.isComposing || e.keyCode === 229) return
      if (!selected || selected.backend !== 'app' || selected.mode === 'readonly') return
      e.preventDefault()
      e.stopPropagation()
      const sessionId = selected.sessionId
      const current = statusBySession[sessionId]?.permissionMode ?? 'default'
      const idx = PERMISSION_MODE_CYCLE.indexOf(
        current as (typeof PERMISSION_MODE_CYCLE)[number]
      )
      const next =
        PERMISSION_MODE_CYCLE[idx === -1 ? 0 : (idx + 1) % PERMISSION_MODE_CYCLE.length]
      void handleSetPermissionMode(sessionId, next)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [selected, statusBySession, handleSetPermissionMode])

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

  // Keep activeTerminalRef in sync with current selection so FindBar uses the
  // right xterm SearchAddon when switching between terminals.
  if (selected?.backend === 'terminal') {
    activeTerminalRef.current = terminalRefs.current.get(selected.sessionId) ?? null
  } else {
    activeTerminalRef.current = null
  }

  const findMode: 'app' | 'terminal' =
    selected?.backend === 'terminal' && selected.mode !== 'readonly' ? 'terminal' : 'app'

  // 'terminal' 백엔드 라이브일 때만 ChatPane 을 hide (xterm 이 그 자리를 차지).
  const showChatPane =
    !selected ||
    selected.backend !== 'terminal' ||
    selected.mode === 'readonly' ||
    isStartingTerminal

  const appStyle: Record<string, string> = {
    '--sidebar-width': `${sidebarWidth}px`,
    '--font-size': `${settings.fontSize}px`,
    fontSize: `${settings.fontSize}px`
  }
  if (settings.fonts.length > 0) {
    const stack = fontStackToCss(settings.fonts)
    appStyle['--font'] = stack
    appStyle.fontFamily = stack
  }

  const toolDefaultOpenSet = useMemo(
    () => new Set(settings.toolCardsDefaultOpen),
    [settings.toolCardsDefaultOpen]
  )

  return (
    <ToolDefaultOpenContext.Provider value={toolDefaultOpenSet}>
    <div
      className={`app${sidebarOpen ? ' sidebar-open' : ''}${
        selected && !sideChatCollapsed ? ' side-chat-open' : ''
      }`}
      style={appStyle as React.CSSProperties}
    >
      <button
        type="button"
        className="mobile-sidebar-toggle"
        aria-label={i18n.t('sidebar.toggle.aria')}
        onClick={() => setSidebarOpen((v) => !v)}
      >
        ☰
      </button>
      {selected && (
        <button
          type="button"
          className="mobile-sidechat-toggle"
          aria-label={i18n.t('sideChat.toggle.aria')}
          onClick={() => handleToggleSideChat()}
        >
          BTW
        </button>
      )}
      <div
        className="mobile-sidebar-backdrop"
        onClick={() => setSidebarOpen(false)}
      />
      <div
        className="mobile-sidechat-backdrop"
        onClick={() => !sideChatCollapsed && handleToggleSideChat()}
      />
      <Sidebar
        workspaces={workspaces}
        selected={selected}
        active={active}
        messagesBySession={messagesBySession}
        aliasesBySession={aliasesBySession}
        statusBySession={statusBySession}
        refreshTick={sidebarRefreshTick}
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
        title={i18n.t('splitter.title')}
      />
      <div className="main-area">
        {terminalSessionList.map((t) => {
          const visible =
            !!selected &&
            selected.sessionId === t.sessionId &&
            selected.backend === 'terminal'
          const pm = settings.defaultPermissionMode
          const command =
            t.mode === 'new'
              ? `claude --permission-mode ${pm} --session-id ${t.sessionId}`
              : `claude --permission-mode ${pm} --resume ${t.sessionId}`
          // 사용자 폰트는 mono 가 아닐 수 있으므로 기존 mono fallback chain 을 뒤에 항상 붙임.
          const monoFallback = '"Cascadia Code", "Consolas", "Menlo", monospace'
          const terminalFont = settings.fonts.length > 0
            ? `${fontStackToCss(settings.fonts)}, ${monoFallback}`
            : monoFallback
          return (
            <TerminalSession
              key={t.sessionId}
              ref={(handle) => {
                if (handle) terminalRefs.current.set(t.sessionId, handle)
                else terminalRefs.current.delete(t.sessionId)
                if (selected?.sessionId === t.sessionId) {
                  activeTerminalRef.current = handle ?? null
                }
              }}
              sessionId={t.sessionId}
              workspacePath={t.workspacePath}
              initialCommand={command}
              visible={visible && terminalReady[t.sessionId] !== false}
              fontFamily={terminalFont}
              fontSize={settings.fontSize}
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
            onLiveJsonlEvents={handleLiveJsonlEvents}
            onAskUserQuestionAnswer={handleAskUserQuestionAnswer}
            onAskUserQuestionCancel={handleAskUserQuestionCancel}
            onExitPlanModeApprove={handleExitPlanModeApprove}
            onExitPlanModeDeny={handleExitPlanModeDeny}
          />
        )}
        {isStartingTerminal && (
          <div className="terminal-loading-overlay">
            <div className="throbber" />
            <div className="throbber-label">터미널 시작 중…</div>
          </div>
        )}
      </div>
      <SideChatPanel
        enabled={!!selected}
        messages={selected ? (btwMessagesBySession[selected.sessionId] ?? []) : []}
        thinking={selected ? !!btwThinkingBySession[selected.sessionId] : false}
        collapsed={sideChatCollapsed}
        onToggleCollapse={handleToggleSideChat}
        onAsk={handleBtwAsk}
        onCancel={handleBtwCancel}
        onClear={handleBtwClear}
      />
      <FindBar
        open={findOpen}
        mode={findMode}
        terminalRef={activeTerminalRef}
        onClose={() => setFindOpen(false)}
      />
      <SettingsModal
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onChange={handleSettingsChange}
      />
      <ConfirmHost />
    </div>
    </ToolDefaultOpenContext.Provider>
  )
}

export default App
