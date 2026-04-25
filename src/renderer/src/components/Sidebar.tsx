import WorkspaceCard from './WorkspaceCard'
import type { SelectedSession } from '../types'

interface Props {
  workspaces: string[]
  selected: SelectedSession | null
  onAddWorkspace: () => void | Promise<void>
  onSelect: (s: SelectedSession | null) => void
  onStartClaude: (cwd: string) => void | Promise<void>
}

function Sidebar({
  workspaces,
  selected,
  onAddWorkspace,
  onSelect,
  onStartClaude
}: Props): React.JSX.Element {
  return (
    <aside className="sidebar">
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
