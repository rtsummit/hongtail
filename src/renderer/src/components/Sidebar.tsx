import { useState } from 'react'
import WorkspaceCard from './WorkspaceCard'
import type {
  Backend,
  Block,
  LiveSessionInfo,
  SelectedSession,
  SessionStatus,
  WorkspaceEntry
} from '../types'
import type { SessionAlias } from '../../../preload/index.d'

interface ActiveLike {
  workspacePath: string
  mode: 'new' | 'resume-full' | 'resume-summary'
  backend: Backend
}

interface Props {
  workspaces: WorkspaceEntry[]
  selected: SelectedSession | null
  active: Record<string, ActiveLike>
  messagesBySession: Record<string, Block[]>
  aliasesBySession: Record<string, SessionAlias>
  statusBySession: Record<string, SessionStatus>
  onAddWorkspace: () => void | Promise<void>
  onRemoveWorkspace: (path: string) => void | Promise<void>
  onReorderWorkspaces: (fromPath: string, toPath: string, before: boolean) => void | Promise<void>
  onSetAlias: (path: string, alias: string) => void | Promise<void>
  onSetSessionAlias: (sessionId: string, alias: string) => void | Promise<void>
  onOpenSettings: () => void
  onSelect: (s: SelectedSession | null) => void
  onStartClaude: (cwd: string) => void | Promise<void>
  onStopLive: (sessionId: string) => void | Promise<void>
}

function deriveLiveTitle(blocks: Block[] | undefined): string {
  if (blocks) {
    for (const b of blocks) {
      if (b.kind === 'user-text') {
        const first = b.text.trim().split(/\r?\n/)[0]
        return first.length > 50 ? first.slice(0, 50) + '…' : first
      }
    }
  }
  return '새로운 대화'
}

function Sidebar({
  workspaces,
  selected,
  active,
  messagesBySession,
  aliasesBySession,
  statusBySession,
  onAddWorkspace,
  onRemoveWorkspace,
  onReorderWorkspaces,
  onSetAlias,
  onSetSessionAlias,
  onOpenSettings,
  onSelect,
  onStartClaude,
  onStopLive
}: Props): React.JSX.Element {
  const [draggingPath, setDraggingPath] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<{ path: string; before: boolean } | null>(null)
  const liveByWorkspace = new Map<string, LiveSessionInfo[]>()
  for (const [sessionId, a] of Object.entries(active)) {
    const list = liveByWorkspace.get(a.workspacePath) ?? []
    const blocks = messagesBySession[sessionId]
    // App mode: user-text block existence is graduation signal.
    // Terminal mode: claude creates JSONL on session start (~1s) and we don't
    //   track PTY content, so there's no meaningful "fresh" phase — treat as
    //   graduated immediately so it appears as a normal live entry.
    const hasUserMessage =
      a.backend === 'app' ? (blocks?.some((b) => b.kind === 'user-text') ?? false) : true
    list.push({
      sessionId,
      title: deriveLiveTitle(blocks),
      backend: a.backend,
      isNew: a.mode === 'new',
      hasUserMessage
    })
    liveByWorkspace.set(a.workspacePath, list)
  }

  return (
    <aside className="sidebar">
      <button
        type="button"
        className="new-session-btn"
        onClick={() => void onAddWorkspace()}
      >
        <span className="plus">+</span>
        <span>Workspace 추가</span>
      </button>

      <div className="workspace-list">
        {workspaces.map(({ path, alias }) => (
          <WorkspaceCard
            key={path}
            path={path}
            alias={alias}
            liveSessions={liveByWorkspace.get(path) ?? []}
            aliasesBySession={aliasesBySession}
            statusBySession={statusBySession}
            selectedId={selected?.workspacePath === path ? selected.sessionId : null}
            onSelect={onSelect}
            onStartClaude={onStartClaude}
            onStopLive={onStopLive}
            onRemove={onRemoveWorkspace}
            onSetAlias={onSetAlias}
            onSetSessionAlias={onSetSessionAlias}
            isDragging={draggingPath === path}
            dragOverPosition={dragOver?.path === path ? (dragOver.before ? 'top' : 'bottom') : null}
            onDragStart={() => setDraggingPath(path)}
            onDragEnd={() => {
              setDraggingPath(null)
              setDragOver(null)
            }}
            onDragOverHeader={(before) => {
              if (!draggingPath || draggingPath === path) return
              setDragOver((prev) =>
                prev?.path === path && prev.before === before ? prev : { path, before }
              )
            }}
            onDragLeaveHeader={() => {
              setDragOver((prev) => (prev?.path === path ? null : prev))
            }}
            onDropHeader={(before) => {
              if (draggingPath && draggingPath !== path) {
                void onReorderWorkspaces(draggingPath, path, before)
              }
              setDraggingPath(null)
              setDragOver(null)
            }}
          />
        ))}
      </div>

      <div className="sidebar-footer">
        <button
          type="button"
          className="settings-btn"
          onClick={onOpenSettings}
          title="설정"
        >
          ⚙ <span>설정</span>
        </button>
      </div>
    </aside>
  )
}

export default Sidebar
