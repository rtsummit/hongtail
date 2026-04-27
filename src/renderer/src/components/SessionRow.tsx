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

// Sidebar 는 jsonl mtime (lastActivityMs) 으로 정렬하므로, 부제도 같은
// 기준으로 보여줘야 사용자에게 정렬이 깨져 보이지 않는다. resumed 된
// 옛날 세션은 startedAt 이 오래되어도 위로 떠오르기 때문에 startedAt
// 을 보여주면 순서가 뒤섞인 것처럼 보임.
function formatLastActivity(ms: number, fallbackIso: string): string {
  const d = ms > 0 ? new Date(ms) : fallbackIso ? new Date(fallbackIso) : null
  if (!d || Number.isNaN(d.getTime())) return fallbackIso
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
        subtitle={formatLastActivity(meta.lastActivityMs, meta.startedAt)}
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
