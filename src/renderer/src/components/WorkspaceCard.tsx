import { useCallback, useEffect, useState } from 'react'
import SessionRow from './SessionRow'
import type { ClaudeSessionMeta, LiveSessionInfo, SelectedSession } from '../types'

interface Props {
  path: string
  liveSessions: LiveSessionInfo[]
  selectedId: string | null
  onSelect: (s: SelectedSession | null) => void
  onStartClaude: (cwd: string) => void | Promise<void>
  onStopLive: (sessionId: string) => void | Promise<void>
}

function WorkspaceCard({
  path,
  liveSessions,
  selectedId,
  onSelect,
  onStartClaude,
  onStopLive
}: Props): React.JSX.Element {
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
      const ok = window.confirm(`"${title}" 세션을 삭제할까요?`)
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
  const graduatedLives = liveExt.filter((s) => s.graduated)
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

  return (
    <section className={`workspace${collapsed ? ' collapsed' : ''}`}>
      <header className="workspace-header" onClick={() => setCollapsed((v) => !v)}>
        <span className="chevron">▾</span>
        <span className="workspace-name" title={path}>
          {path}
        </span>
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

          {graduatedLives.map((s) => (
            <div
              key={s.sessionId}
              className={`session live${selectedId === s.sessionId ? ' active' : ''}`}
              onClick={() =>
                onSelect({
                  workspacePath: path,
                  sessionId: s.sessionId,
                  title: s.jsonlTitle ?? s.title,
                  mode: 'readonly'
                })
              }
            >
              <span className="live-dot" title={`${s.backend} · live`}>●</span>
              <div className="session-info">
                <span className="session-title" title={s.jsonlTitle ?? s.title}>
                  {s.jsonlTitle ?? s.title}
                </span>
                <span className="session-time">
                  {s.backend}
                  {s.isNew ? ' · new' : ' · resumed'}
                </span>
              </div>
              <button
                type="button"
                className="session-remove"
                title="이 라이브 세션 종료"
                onClick={(e) => {
                  e.stopPropagation()
                  void onStopLive(s.sessionId)
                }}
              >
                −
              </button>
            </div>
          ))}

          {filteredPast.map((s) => (
            <SessionRow
              key={s.id}
              meta={s}
              active={selectedId === s.id}
              onClick={() =>
                onSelect({
                  workspacePath: path,
                  sessionId: s.id,
                  title: s.title,
                  mode: 'readonly'
                })
              }
              onDelete={() => handleDelete(s.id, s.title)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export default WorkspaceCard
