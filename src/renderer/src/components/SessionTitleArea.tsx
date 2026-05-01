import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  display: string
  baseTitle: string
  isAlias: boolean
  subtitle: string
  onCommitAlias: (next: string) => void | Promise<void>
}

function SessionTitleArea({
  display,
  baseTitle,
  isAlias,
  subtitle,
  onCommitAlias
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const begin = useCallback(() => {
    setDraft(isAlias ? display : '')
    setEditing(true)
  }, [display, isAlias])

  const commit = useCallback(() => {
    if (!editing) return
    setEditing(false)
    const trimmed = draft.trim()
    const previous = isAlias ? display : ''
    if (trimmed === previous) return
    void onCommitAlias(trimmed)
  }, [editing, draft, isAlias, display, onCommitAlias])

  const cancel = useCallback(() => {
    setEditing(false)
  }, [])

  const tooltip = isAlias
    ? `${display}${t('session.aliasHintEdit', { base: baseTitle })}`
    : `${baseTitle}${t('session.aliasHintAdd')}`

  return (
    <div
      className="session-info"
      onDoubleClick={(e) => {
        e.stopPropagation()
        begin()
      }}
      title={editing ? undefined : tooltip}
    >
      {editing ? (
        <input
          ref={inputRef}
          className="session-alias-input"
          type="text"
          value={draft}
          placeholder={t('session.aliasPlaceholder')}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              cancel()
            }
          }}
        />
      ) : (
        <span className={`session-title${isAlias ? ' aliased' : ''}`}>{display}</span>
      )}
      <span className="session-time">{subtitle}</span>
    </div>
  )
}

export default SessionTitleArea
