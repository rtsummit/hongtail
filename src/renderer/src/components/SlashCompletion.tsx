import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SlashCommand } from '../../../preload/index.d'

interface Props {
  commands: SlashCommand[]
  selectedIndex: number
  anchorRef: React.RefObject<HTMLElement | null>
  onPick: (cmd: SlashCommand) => void
  onHover: (i: number) => void
}

interface AnchorRect {
  top: number
  left: number
  width: number
  maxHeight: number
}

const SOURCE_LABEL: Record<SlashCommand['source'], string> = {
  builtin: 'cli',
  user: 'user',
  project: 'project',
  plugin: 'plugin'
}

function SlashCompletion({
  commands,
  selectedIndex,
  anchorRef,
  onPick,
  onHover
}: Props): React.JSX.Element | null {
  const listRef = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<AnchorRect | null>(null)

  useLayoutEffect(() => {
    const compute = (): void => {
      const el = anchorRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const margin = 8
      const maxHeight = Math.min(320, Math.max(0, r.top - margin - 16))
      setRect({ top: r.top - margin, left: r.left, width: r.width, maxHeight })
    }
    compute()
    window.addEventListener('resize', compute)
    window.addEventListener('scroll', compute, true)
    return () => {
      window.removeEventListener('resize', compute)
      window.removeEventListener('scroll', compute, true)
    }
  }, [anchorRef, commands.length])

  // Keep selected item visible
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-slash-index="${selectedIndex}"]`
    )
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (commands.length === 0 || !rect) return null

  return (
    <div
      className="slash-completion"
      ref={listRef}
      style={{
        top: rect.top,
        left: rect.left,
        width: rect.width,
        maxHeight: rect.maxHeight,
        transform: 'translateY(-100%)'
      }}
    >
      {commands.map((c, i) => (
        <div
          key={`${c.source}:${c.name}`}
          data-slash-index={i}
          className={`slash-item ${i === selectedIndex ? 'selected' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault()
            onPick(c)
          }}
          onMouseEnter={() => onHover(i)}
          title={c.origin ?? ''}
        >
          <span className="slash-name">/{c.name}</span>
          {c.description && <span className="slash-desc">{c.description}</span>}
          <span className={`slash-source ${c.source}`}>{SOURCE_LABEL[c.source]}</span>
        </div>
      ))}
    </div>
  )
}

export default SlashCompletion
