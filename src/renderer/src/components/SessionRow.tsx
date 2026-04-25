import type { ClaudeSessionMeta } from '../types'

interface Props {
  meta: ClaudeSessionMeta
  active: boolean
  onClick: () => void
  onDelete: () => void
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function formatStartedAt(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function SessionRow({ meta, active, onClick, onDelete }: Props): React.JSX.Element {
  return (
    <div className={`session${active ? ' active' : ''}`} onClick={onClick}>
      <div className="session-info">
        <span className="session-title" title={meta.title}>
          {meta.title}
        </span>
        <span className="session-time">{formatStartedAt(meta.startedAt)}</span>
      </div>
      <button
        type="button"
        className="session-remove"
        title="세션 삭제"
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
      >
        −
      </button>
    </div>
  )
}

export default SessionRow
