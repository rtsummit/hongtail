import { useCallback, useEffect, useState } from 'react'
import SessionRow from './SessionRow'
import type { ClaudeSessionMeta, LiveSessionInfo, SelectedSession } from '../types'

interface Props {
  path: string
  liveSessions: LiveSessionInfo[]
  selectedId: string | null
  onSelect: (s: SelectedSession | null) => void
  onStartClaude: (cwd: string) => void | Promise<void>
}

function WorkspaceCard({
  path,
  liveSessions,
  selectedId,
  onSelect,
  onStartClaude
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

  // Refresh past sessions when live count changes (new JSONL may have appeared)
  useEffect(() => {
    if (liveSessions.length === 0) return
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
  const filteredPast = (sessions ?? []).filter((s) => !liveIds.has(s.id))

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
            className="new-conversation"
            onClick={handleNewConversation}
            title="이 디렉터리에서 새 대화 시작 (현재 모드 사용)"
          >
            <span className="new-conversation-plus">+</span>
            <span className="new-conversation-label">새로운 대화</span>
          </div>

          {liveSessions.map((s) => (
            <div
              key={s.sessionId}
              className={`session live${selectedId === s.sessionId ? ' active' : ''}`}
              onClick={() =>
                onSelect({
                  workspacePath: path,
                  sessionId: s.sessionId,
                  title: s.title,
                  mode: 'readonly'
                })
              }
            >
              <span className="live-dot" title={`${s.backend} · live`}>●</span>
              <div className="session-info">
                <span className="session-title" title={s.title}>
                  {s.title}
                </span>
                <span className="session-time">
                  {s.backend}
                  {s.isNew ? ' · new' : ' · resumed'}
                </span>
              </div>
            </div>
          ))}

          {sessions === null && liveSessions.length === 0 ? null : (
            filteredPast.map((s) => (
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
            ))
          )}
        </div>
      )}
    </section>
  )
}

export default WorkspaceCard
