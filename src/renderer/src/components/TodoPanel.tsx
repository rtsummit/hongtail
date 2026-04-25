import { memo, useState } from 'react'
import type { TodoState } from '../todoState'

interface Props {
  state: TodoState
}

function statusIcon(s: string): string {
  if (s === 'completed') return '☑'
  if (s === 'in_progress') return '◐'
  return '☐'
}

function TodoPanel({ state }: Props): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const total = state.tasks.length
  if (total === 0) return null

  return (
    <details
      className="todo-panel"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="todo-panel-summary">
        <span className="todo-panel-count">{total} tasks</span>
        <span className="todo-panel-stats">
          (<span className="done">{state.done} done</span>,{' '}
          <span className="in-progress">{state.inProgress} in progress</span>,{' '}
          <span className="pending">{state.pending} open</span>)
        </span>
        {!open && state.inProgress > 0 && (
          <span className="todo-panel-active">
            {' '}
            ◼ {state.tasks.find((t) => t.status === 'in_progress')?.activeForm ??
              state.tasks.find((t) => t.status === 'in_progress')?.subject}
          </span>
        )}
      </summary>
      <ul className="todo-panel-list">
        {state.tasks.map((t) => (
          <li key={t.id} className={`todo-panel-item ${t.status}`}>
            <span className="todo-panel-mark">{statusIcon(t.status)}</span>
            <span className="todo-panel-text">
              {t.status === 'in_progress' && t.activeForm ? t.activeForm : t.subject}
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}

export default memo(TodoPanel)
