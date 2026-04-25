import WorkspaceCard from './WorkspaceCard'
import type {
  Backend,
  Block,
  LiveSessionInfo,
  SelectedSession
} from '../types'

interface ActiveLike {
  workspacePath: string
  mode: 'new' | 'resume-full' | 'resume-summary'
  backend: Backend
}

interface Props {
  workspaces: string[]
  selected: SelectedSession | null
  defaultBackend: Backend
  active: Record<string, ActiveLike>
  messagesBySession: Record<string, Block[]>
  onChangeBackend: (b: Backend) => void
  onAddWorkspace: () => void | Promise<void>
  onSelect: (s: SelectedSession | null) => void
  onStartClaude: (cwd: string) => void | Promise<void>
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
  defaultBackend,
  active,
  messagesBySession,
  onChangeBackend,
  onAddWorkspace,
  onSelect,
  onStartClaude
}: Props): React.JSX.Element {
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
      <div className="mode-toggle" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={defaultBackend === 'app'}
          className={`mode-toggle-btn${defaultBackend === 'app' ? ' active' : ''}`}
          onClick={() => onChangeBackend('app')}
        >
          앱 모드
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={defaultBackend === 'terminal'}
          className={`mode-toggle-btn${defaultBackend === 'terminal' ? ' active' : ''}`}
          onClick={() => onChangeBackend('terminal')}
        >
          터미널 모드
        </button>
      </div>

      <button
        type="button"
        className="new-session-btn"
        onClick={() => void onAddWorkspace()}
      >
        <span className="plus">+</span>
        <span>Workspace 추가</span>
      </button>

      <div className="workspace-list">
        {workspaces.map((path) => (
          <WorkspaceCard
            key={path}
            path={path}
            liveSessions={liveByWorkspace.get(path) ?? []}
            selectedId={selected?.workspacePath === path ? selected.sessionId : null}
            onSelect={onSelect}
            onStartClaude={onStartClaude}
          />
        ))}
      </div>
    </aside>
  )
}

export default Sidebar
