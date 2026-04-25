import SessionTitleArea from './SessionTitleArea'
import type { ClaudeSessionMeta } from '../types'
import type { SessionAlias } from '../../../preload/index.d'

interface Props {
  meta: ClaudeSessionMeta
  aliasEntry: SessionAlias | undefined
  active: boolean
  onClick: () => void
  onDelete: () => void
  onSetAlias: (alias: string) => void | Promise<void>
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

function SessionRow({
  meta,
  aliasEntry,
  active,
  onClick,
  onDelete,
  onSetAlias
}: Props): React.JSX.Element {
  const display = aliasEntry?.alias ?? meta.title
  return (
    <div className={`session${active ? ' active' : ''}`} onClick={onClick}>
      <SessionTitleArea
        display={display}
        baseTitle={meta.title}
        isAlias={!!aliasEntry}
        subtitle={formatStartedAt(meta.startedAt)}
        onCommitAlias={onSetAlias}
      />
      <button
        type="button"
        className="session-remove"
        title="대화 삭제"
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
