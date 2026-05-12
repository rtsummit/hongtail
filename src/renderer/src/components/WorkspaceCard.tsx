import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import SessionRow from './SessionRow'
import SessionTitleArea from './SessionTitleArea'
import { appConfirm } from '../confirm'
import { loadSettings } from '../settings'
import type {
  Backend,
  ClaudeSessionMeta,
  LiveSessionInfo,
  SelectedSession,
  SessionStatus
} from '../types'
import type { SessionAlias } from '../../../preload/index.d'

interface Props {
  path: string
  alias?: string
  liveSessions: LiveSessionInfo[]
  aliasesBySession: Record<string, SessionAlias>
  statusBySession: Record<string, SessionStatus>
  selectedId: string | null
  // 사이드바 필터:
  //   숫자 = 최근 N일 안에 활동한 readonly 세션만 표시
  //   'active' = readonly 다 숨김 (라이브만)
  //   null = 모두
  // live / fresh 는 'active' 외 모드에서 항상 표시.
  dateFilterDays: 1 | 3 | 7 | 'active' | null
  // 다른 client 가 세션 시작/종료한 신호. 변경 시 listSessions 재호출.
  refreshTick: number
  // 사이드바가 최소화 (icon-only) 상태인지. true 면 워크스페이스를 첫 글자
  // 경계 마커로만 렌더하고, 그 아래에 active(라이브) 세션들만 아이콘으로
  // 나열. 워크스페이스 마커 클릭으로 펼침/접기 토글.
  iconOnly: boolean
  onSelect: (s: SelectedSession | null) => void
  onStartClaude: (cwd: string, backend: Backend) => void | Promise<void>
  onStopLive: (sessionId: string) => void | Promise<void>
  onRemove: (path: string) => void | Promise<void>
  onSetAlias: (path: string, alias: string) => void | Promise<void>
  onSetSessionAlias: (sessionId: string, alias: string) => void | Promise<void>
  isDragging: boolean
  dragOverPosition: 'top' | 'bottom' | null
  onDragStart: () => void
  onDragEnd: () => void
  onDragOverHeader: (before: boolean) => void
  onDragLeaveHeader: () => void
  onDropHeader: (before: boolean) => void
}

function WorkspaceCard({
  path,
  alias,
  liveSessions,
  aliasesBySession,
  statusBySession,
  selectedId,
  dateFilterDays,
  refreshTick,
  iconOnly,
  onSelect,
  onStartClaude,
  onStopLive,
  onRemove,
  onSetAlias,
  onSetSessionAlias,
  isDragging,
  dragOverPosition,
  onDragStart,
  onDragEnd,
  onDragOverHeader,
  onDragLeaveHeader,
  onDropHeader
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [editingAlias, setEditingAlias] = useState(false)
  const [aliasDraft, setAliasDraft] = useState('')
  const aliasInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingAlias) {
      aliasInputRef.current?.focus()
      aliasInputRef.current?.select()
    }
  }, [editingAlias])

  const beginEditAlias = useCallback(() => {
    setAliasDraft(alias ?? '')
    setEditingAlias(true)
  }, [alias])

  const commitAlias = useCallback(() => {
    if (!editingAlias) return
    setEditingAlias(false)
    if (aliasDraft.trim() !== (alias ?? '')) void onSetAlias(path, aliasDraft.trim())
  }, [editingAlias, aliasDraft, alias, path, onSetAlias])

  const cancelEditAlias = useCallback(() => {
    setEditingAlias(false)
  }, [])
  const [collapsed, setCollapsed] = useState(false)
  const [sessions, setSessions] = useState<ClaudeSessionMeta[] | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  const openFolder = useCallback(() => {
    const cmd = loadSettings().folderOpenCommand
    void window.api.files.openFolder(path, cmd).catch((err) => {
      console.error('openFolder failed:', err)
    })
  }, [path])

  useEffect(() => {
    if (!contextMenu) return
    const close = (): void => setContextMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setContextMenu(null)
      }
    }
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [contextMenu])

  const refresh = useCallback(async () => {
    try {
      const list = await window.api.claude.listSessions(path)
      setSessions(list)
    } catch (err) {
      console.error('listSessions failed:', err)
      setSessions([])
    }
  }, [path])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Refresh shortly after a live session count changes (created or exited)
  // — catches both fast graduation and post-exit JSONL appearance.
  useEffect(() => {
    const id = window.setTimeout(() => void refresh(), 2000)
    return () => window.clearTimeout(id)
  }, [liveSessions.length, refresh])

  // 다른 client 가 세션 시작/종료한 신호 (refreshTick) 변경 시. 즉시 + 2초 뒤
  // 한 번 더 (인터랙티브 신규 세션은 jsonl 가 spawn 직후 약간 지연되어 생김).
  useEffect(() => {
    if (refreshTick === 0) return
    void refresh()
    const id = window.setTimeout(() => void refresh(), 2000)
    return () => window.clearTimeout(id)
  }, [refreshTick, refresh])

  const handleNewConversation = useCallback(
    (backend: Backend) => {
      void onStartClaude(path, backend)
    },
    [path, onStartClaude]
  )

  const handleDelete = useCallback(
    async (sessionId: string, title: string) => {
      const ok = await appConfirm({
        message: `"${title}" 대화를 삭제할까요?`,
        destructive: true
      })
      if (!ok) return
      try {
        await window.api.claude.deleteSession(path, sessionId)
      } catch (err) {
        console.error('deleteSession failed:', err)
        return
      }
      if (selectedId === sessionId) onSelect(null)
      await refresh()
    },
    [path, refresh, selectedId, onSelect]
  )

  const liveIds = new Set(liveSessions.map((s) => s.sessionId))
  const jsonlIds = new Set((sessions ?? []).map((s) => s.id))
  const jsonlById = new Map((sessions ?? []).map((s) => [s.id, s]))

  // Decide fresh vs graduated.
  // Fresh: hasn't received first user message yet (app: no user-text block; terminal: no JSONL)
  // Graduated: has at least one exchange
  const liveExt = liveSessions.map((s) => ({
    ...s,
    graduated: s.hasUserMessage || jsonlIds.has(s.sessionId),
    jsonlTitle: jsonlById.get(s.sessionId)?.title
  }))
  // Fresh 는 backend 별로 따로 추적 — 'app' 만 graduate 전 단계가 의미가 있고
  // 'terminal' 은 spawn 즉시 graduated=true 라 사실상 fresh 가 없음.
  const fresh = liveExt.find((s) => !s.graduated && s.backend === 'app') ?? null
  const graduatedLives = liveExt.filter((s) => s.graduated)
  const filteredPast = (sessions ?? []).filter((s) => {
    if (liveIds.has(s.id)) return false
    if (dateFilterDays === 'active') return false
    if (dateFilterDays == null) return true
    const cutoff = Date.now() - dateFilterDays * 24 * 60 * 60 * 1000
    return s.lastActivityMs >= cutoff
  })

  // Manual session order: new sessions are prepended (newest at top),
  // removed sessions are dropped, manual drag order is preserved.
  const [sessionOrder, setSessionOrder] = useState<string[]>([])
  const liveKey = graduatedLives.map((s) => s.sessionId).join('|')
  useEffect(() => {
    setSessionOrder((prev) => {
      const currentIds = new Set(graduatedLives.map((s) => s.sessionId))
      const kept = prev.filter((id) => currentIds.has(id))
      const fresh = graduatedLives.map((s) => s.sessionId).filter((id) => !prev.includes(id))
      return [...fresh, ...kept]
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey])

  const orderedLives = useMemo(() => {
    const byId = new Map(graduatedLives.map((s) => [s.sessionId, s]))
    // Sessions already tracked in manual order
    const tracked = sessionOrder
      .map((id) => byId.get(id))
      .filter(Boolean) as typeof graduatedLives
    // New sessions not yet synced into sessionOrder (one-render gap before
    // useEffect runs) — show them at the TOP immediately so users see the
    // newly-graduated conversation jump to the top right away.
    const trackedIds = new Set(sessionOrder)
    const untracked = graduatedLives.filter((s) => !trackedIds.has(s.sessionId))
    return [...untracked, ...tracked]
  }, [sessionOrder, graduatedLives])

  const [draggingSession, setDraggingSession] = useState<string | null>(null)
  const [sessionDropTarget, setSessionDropTarget] = useState<{
    id: string
    before: boolean
  } | null>(null)

  const handleSessionDrop = useCallback(
    (targetId: string, before: boolean) => {
      if (!draggingSession || draggingSession === targetId) return
      setSessionOrder((prev) => {
        const without = prev.filter((id) => id !== draggingSession)
        const idx = without.indexOf(targetId)
        if (idx === -1) return prev
        const at = before ? idx : idx + 1
        return [...without.slice(0, at), draggingSession, ...without.slice(at)]
      })
    },
    [draggingSession]
  )

  const freshSelected = fresh && selectedId === fresh.sessionId
  const newConversationClasses = ['new-conversation']
  if (fresh) newConversationClasses.push('has-fresh')
  if (freshSelected) newConversationClasses.push('selected')

  const handleNewConversationClick = (): void => {
    if (fresh) {
      onSelect({
        workspacePath: path,
        sessionId: fresh.sessionId,
        title: fresh.title,
        mode: 'readonly'
      })
    } else {
      handleNewConversation('app')
    }
  }

  const handleTerminalClick = (): void => {
    handleNewConversation('terminal')
  }

  const headerClasses = ['workspace-header']
  if (isDragging) headerClasses.push('dragging')
  if (dragOverPosition === 'top') headerClasses.push('drag-over-top')
  if (dragOverPosition === 'bottom') headerClasses.push('drag-over-bottom')

  if (iconOnly) {
    const displayName =
      alias?.trim() ||
      path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ||
      path
    const iconChar = (displayName[0] || '?').toUpperCase()
    return (
      <section className="workspace icon-only-card">
        <button
          type="button"
          className={`workspace-icon-marker${collapsed ? ' collapsed' : ''}`}
          onClick={() => setCollapsed((v) => !v)}
          title={`${displayName} (${liveSessions.length} active)`}
          aria-expanded={!collapsed}
          aria-label={displayName}
        >
          {iconChar}
        </button>
        {!collapsed &&
          liveSessions.map((s) => {
            const aliasEntry = aliasesBySession[s.sessionId]
            const display = aliasEntry?.alias ?? s.title
            const sessionChar = (display[0] || '·').toUpperCase()
            const isThinking = !!statusBySession[s.sessionId]?.thinking
            const isSelected = selectedId === s.sessionId
            const cls = [
              'session-icon-btn',
              isSelected ? 'active' : '',
              isThinking ? 'busy' : ''
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <button
                key={s.sessionId}
                type="button"
                className={cls}
                onClick={() =>
                  onSelect({
                    workspacePath: path,
                    sessionId: s.sessionId,
                    title: display,
                    mode: 'readonly'
                  })
                }
                aria-label={display}
              >
                <span className="session-icon-letter">{sessionChar}</span>
                <span className="sidebar-icon-tooltip">{display}</span>
              </button>
            )
          })}
      </section>
    )
  }

  return (
    <section className={`workspace${collapsed ? ' collapsed' : ''}`}>
      <header
        className={headerClasses.join(' ')}
        draggable={!editingAlias}
        onContextMenu={(e) => {
          if (editingAlias) return
          e.preventDefault()
          e.stopPropagation()
          setContextMenu({ x: e.clientX, y: e.clientY })
        }}
        onDragStart={(e) => {
          if (editingAlias) {
            e.preventDefault()
            return
          }
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', path)
          onDragStart()
        }}
        onDragEnd={onDragEnd}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          const rect = e.currentTarget.getBoundingClientRect()
          const before = e.clientY < rect.top + rect.height / 2
          onDragOverHeader(before)
        }}
        onDragLeave={onDragLeaveHeader}
        onDrop={(e) => {
          e.preventDefault()
          const rect = e.currentTarget.getBoundingClientRect()
          const before = e.clientY < rect.top + rect.height / 2
          onDropHeader(before)
        }}
        onClick={() => {
          if (editingAlias) return
          setCollapsed((v) => !v)
        }}
      >
        <span className="drag-handle" title={t('workspace.dragHint')}>⋮⋮</span>
        <span className="chevron">▾</span>
        <div
          className="workspace-meta"
          onDoubleClick={(e) => {
            e.stopPropagation()
            beginEditAlias()
          }}
          title={alias ? `${alias}\n${path}\n\n더블클릭: 별칭 편집` : `${path}\n\n더블클릭: 별칭 추가`}
        >
          {editingAlias ? (
            <input
              ref={aliasInputRef}
              className="workspace-alias-input"
              type="text"
              value={aliasDraft}
              placeholder={t('workspace.aliasPlaceholder')}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setAliasDraft(e.target.value)}
              onBlur={commitAlias}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitAlias()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  cancelEditAlias()
                }
              }}
            />
          ) : alias ? (
            <span className="workspace-alias">{alias}</span>
          ) : (
            <span className="workspace-name">
              {path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path}
            </span>
          )}
        </div>
        <button
          type="button"
          className="workspace-remove"
          title={t('workspace.removeTitle')}
          onClick={(e) => {
            e.stopPropagation()
            void onRemove(path)
          }}
        >
          −
        </button>
      </header>

      {contextMenu && (
        <div
          className="workspace-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          role="menu"
        >
          <button
            type="button"
            className="workspace-context-menu-item"
            role="menuitem"
            onClick={() => {
              setContextMenu(null)
              openFolder()
            }}
          >
            {t('workspace.openFolder')}
          </button>
        </div>
      )}

      {!collapsed && (
        <div className="session-list">
          <div className="new-conversation-row">
            <div
              className={newConversationClasses.join(' ')}
              onClick={handleNewConversationClick}
              title={
                fresh ? t('workspace.newSessionPending') : t('workspace.newSessionStart')
              }
            >
              <span className="new-conversation-plus">+</span>
              <span className="new-conversation-label">{t('workspace.newConversation')}</span>
              {fresh && (
                <span className="live-dot" title={`${fresh.backend} · waiting`}>
                  ●
                </span>
              )}
            </div>
            <div
              className="new-conversation new-conversation-terminal"
              onClick={handleTerminalClick}
              title={t('workspace.newTerminalStart')}
            >
              <span className="new-conversation-plus">+</span>
              <span className="new-conversation-label">{t('workspace.newTerminal')}</span>
            </div>
          </div>

          {orderedLives.map((s) => {
            const baseTitle = s.jsonlTitle ?? s.title
            const aliasEntry = aliasesBySession[s.sessionId]
            const display = aliasEntry?.alias ?? baseTitle
            const isDraggingThis = draggingSession === s.sessionId
            const dropPos =
              sessionDropTarget?.id === s.sessionId ? sessionDropTarget.before : null
            const cls = [
              'session live',
              selectedId === s.sessionId ? 'active' : '',
              isDraggingThis ? 'session-dragging' : '',
              dropPos === true ? 'session-drag-over-top' : '',
              dropPos === false ? 'session-drag-over-bottom' : ''
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <div
                key={s.sessionId}
                className={cls}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', s.sessionId)
                  setDraggingSession(s.sessionId)
                }}
                onDragEnd={() => {
                  setDraggingSession(null)
                  setSessionDropTarget(null)
                }}
                onDragOver={(e) => {
                  if (!draggingSession || draggingSession === s.sessionId) return
                  e.preventDefault()
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  const before = e.clientY < rect.top + rect.height / 2
                  setSessionDropTarget((prev) =>
                    prev?.id === s.sessionId && prev.before === before
                      ? prev
                      : { id: s.sessionId, before }
                  )
                }}
                onDragLeave={() => {
                  setSessionDropTarget((prev) => (prev?.id === s.sessionId ? null : prev))
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  const before = e.clientY < rect.top + rect.height / 2
                  handleSessionDrop(s.sessionId, before)
                  setDraggingSession(null)
                  setSessionDropTarget(null)
                }}
                onClick={() =>
                  onSelect({
                    workspacePath: path,
                    sessionId: s.sessionId,
                    title: display,
                    mode: 'readonly'
                  })
                }
              >
                <span
                  className={`live-dot${statusBySession[s.sessionId]?.thinking ? ' busy' : ''}`}
                  title={`${s.backend} · ${statusBySession[s.sessionId]?.thinking ? 'working' : 'live'}`}
                >
                  ●
                </span>
                <SessionTitleArea
                  display={display}
                  baseTitle={baseTitle}
                  isAlias={!!aliasEntry}
                  subtitle={`${s.backend}${s.isNew ? ' · new' : ' · resumed'}`}
                  onCommitAlias={(next) => onSetSessionAlias(s.sessionId, next)}
                />
                <button
                  type="button"
                  className="session-stop"
                  title={t('workspace.stopSession')}
                  onClick={(e) => {
                    e.stopPropagation()
                    void onStopLive(s.sessionId)
                  }}
                >
                  ◼
                </button>
              </div>
            )
          })}

          {filteredPast.map((s) => {
            const aliasEntry = aliasesBySession[s.id]
            const display = aliasEntry?.alias ?? s.title
            return (
              <SessionRow
                key={s.id}
                meta={s}
                aliasEntry={aliasEntry}
                active={selectedId === s.id}
                onClick={() =>
                  onSelect({
                    workspacePath: path,
                    sessionId: s.id,
                    title: display,
                    mode: 'readonly'
                  })
                }
                onDelete={() => handleDelete(s.id, s.title)}
                onSetAlias={(next) => onSetSessionAlias(s.id, next)}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}

export default WorkspaceCard
