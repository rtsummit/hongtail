import WorkspaceCard from './WorkspaceCard'
import type { Backend, SelectedSession } from '../types'

interface Props {
  workspaces: string[]
  selected: SelectedSession | null
  defaultBackend: Backend
  onChangeBackend: (b: Backend) => void
  onAddWorkspace: () => void | Promise<void>
  onSelect: (s: SelectedSession | null) => void
  onStartClaude: (cwd: string) => void | Promise<void>
}

function Sidebar({
  workspaces,
  selected,
  defaultBackend,
  onChangeBackend,
  onAddWorkspace,
  onSelect,
  onStartClaude
}: Props): React.JSX.Element {
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
        <span>새 세션</span>
      </button>

      <div className="workspace-list">
        {workspaces.map((path) => (
          <WorkspaceCard
            key={path}
            path={path}
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
