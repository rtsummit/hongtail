import { useCallback, useEffect, useState } from 'react'
import SessionRow from './SessionRow'
import type { ClaudeSessionMeta, SelectedSession } from '../types'

interface Props {
  path: string
  selectedId: string | null
  onSelect: (s: SelectedSession | null) => void
  onStartClaude: (cwd: string) => void | Promise<void>
}

function WorkspaceCard({ path, selectedId, onSelect, onStartClaude }: Props): React.JSX.Element {
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

  const handleAdd = useCallback(async () => {
    await onStartClaude(path)
    window.setTimeout(() => void refresh(), 2000)
  }, [path, onStartClaude, refresh])

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

  return (
    <section className={`workspace${collapsed ? ' collapsed' : ''}`}>
      <header className="workspace-header" onClick={() => setCollapsed((v) => !v)}>
        <span className="chevron">▾</span>
        <span className="workspace-name" title={path}>
          {path}
        </span>
        <button
          type="button"
          className="workspace-add"
          title="이 디렉터리에서 claude 실행"
          onClick={(e) => {
            e.stopPropagation()
            void handleAdd()
          }}
        >
          +
        </button>
      </header>

      {!collapsed && (
        <div className="session-list">
          {sessions === null ? (
            <div className="session-empty">loading…</div>
          ) : sessions.length === 0 ? (
            <div className="session-empty">(아직 없음)</div>
          ) : (
            sessions.map((s) => (
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
