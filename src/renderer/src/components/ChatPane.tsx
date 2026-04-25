import type { SelectedSession } from '../types'

interface Props {
  selected: SelectedSession | null
}

function ChatPane({ selected }: Props): React.JSX.Element {
  return (
    <main className="chat-pane">
      {selected ? (
        <div className="chat-header">
          <div className="chat-title">{selected.title}</div>
          <div className="chat-subtitle">
            {selected.workspacePath} · {selected.sessionId}
          </div>
        </div>
      ) : (
        <div className="chat-empty">
          <p>워크스페이스를 선택하거나 + 새 세션 으로 시작하세요</p>
        </div>
      )}
    </main>
  )
}

export default ChatPane
