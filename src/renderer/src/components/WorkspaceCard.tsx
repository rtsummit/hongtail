import { useCallback, useEffect, useRef, useState } from 'react'
import SessionRow from './SessionRow'
import SessionTitleArea from './SessionTitleArea'
import type { ClaudeSessionMeta, LiveSessionInfo, SelectedSession } from '../types'
import type { SessionAlias } from '../../../preload/index.d'

interface Props {
  path: string
  alias?: string
  liveSessions: LiveSessionInfo[]
  aliasesBySession: Record<string, SessionAlias>
  lastActivityBySession: Record<string, number>
  selectedId: string | null
  onSelect: (s: SelectedSession | null) => void
  onStartClaude: (cwd: string) => void | Promise<void>
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
  lastActivityBySession,
  selectedId,
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

  const handleNewConversation = useCallback(() => {
    void onStartClaude(path)
  }, [path, onStartClaude])

  const handleDelete = useCallback(
    async (sessionId: string, title: string) => {
      const ok = window.confirm(`"${title}" 대화를 삭제할까요?`)
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
  // At most one fresh per workspace (we only allow one at a time).
  const fresh = liveExt.find((s) => !s.graduated) ?? null
  const graduatedLives = liveExt
    .filter((s) => s.graduated)
    .sort(
      (a, b) =>
        (lastActivityBySession[b.sessionId] ?? 0) -
        (lastActivityBySession[a.sessionId] ?? 0)
    )
  const filteredPast = (sessions ?? []).filter((s) => !liveIds.has(s.id))

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
      handleNewConversation()
    }
  }

  const headerClasses = ['workspace-header']
  if (isDragging) headerClasses.push('dragging')
  if (dragOverPosition === 'top') headerClasses.push('drag-over-top')
  if (dragOverPosition === 'bottom') headerClasses.push('drag-over-bottom')

  return (
    <section className={`workspace${collapsed ? ' collapsed' : ''}`}>
      <header
        className={headerClasses.join(' ')}
        draggable={!editingAlias}
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
        <span className="drag-handle" title="드래그하여 순서 변경">⋮⋮</span>
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
              placeholder="별칭 (비우면 제거)"
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
          title="이 워크스페이스를 목록에서 제거"
          onClick={(e) => {
            e.stopPropagation()
            void onRemove(path)
          }}
        >
          −
        </button>
      </header>

      {!collapsed && (
        <div className="session-list">
          <div
            className={newConversationClasses.join(' ')}
            onClick={handleNewConversationClick}
            title={
              fresh
                ? '대기 중인 새로운 대화 (선택)'
                : '이 디렉터리에서 새 대화 시작 (현재 모드 사용)'
            }
          >
            <span className="new-conversation-plus">+</span>
            <span className="new-conversation-label">새로운 대화</span>
            {fresh && (
              <span className="live-dot" title={`${fresh.backend} · waiting`}>
                ●
              </span>
            )}
          </div>

          {graduatedLives.map((s) => {
            const baseTitle = s.jsonlTitle ?? s.title
            const aliasEntry = aliasesBySession[s.sessionId]
            const display = aliasEntry?.alias ?? baseTitle
            return (
              <div
                key={s.sessionId}
                className={`session live${selectedId === s.sessionId ? ' active' : ''}`}
                onClick={() =>
                  onSelect({
                    workspacePath: path,
                    sessionId: s.sessionId,
                    title: display,
                    mode: 'readonly'
                  })
                }
              >
                <span className="live-dot" title={`${s.backend} · live`}>
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
                  title="이 라이브 대화 중지"
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
