import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  containerRef: React.RefObject<HTMLElement | null>
  onAdd: (text: string, comment: string, range: Range) => void
}

interface SelInfo {
  text: string
  rect: DOMRect
  range: Range
}

function QuoteAffordance({ containerRef, onAdd }: Props): React.JSX.Element | null {
  const { t } = useTranslation()
  const [sel, setSel] = useState<SelInfo | null>(null)
  const [popoverFor, setPopoverFor] = useState<SelInfo | null>(null)
  const [comment, setComment] = useState('')
  const popoverRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const handler = (): void => {
      if (popoverFor) return
      const container = containerRef.current
      if (!container) return
      const s = window.getSelection()
      if (!s || s.isCollapsed || s.rangeCount === 0) {
        setSel(null)
        return
      }
      const range = s.getRangeAt(0)
      if (!container.contains(range.commonAncestorContainer)) {
        setSel(null)
        return
      }
      const text = s.toString().trim()
      if (!text) {
        setSel(null)
        return
      }
      const rect = range.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) {
        setSel(null)
        return
      }
      setSel({ text, rect, range: range.cloneRange() })
    }
    document.addEventListener('selectionchange', handler)
    return () => document.removeEventListener('selectionchange', handler)
  }, [containerRef, popoverFor])

  // 팝오버 열린 동안 바깥 클릭 닫기
  useEffect(() => {
    if (!popoverFor) return
    const handler = (e: MouseEvent): void => {
      if (popoverRef.current?.contains(e.target as Node)) return
      setPopoverFor(null)
      setComment('')
    }
    // 즉시 등록되면 popover를 연 클릭이 그대로 잡혀서 닫힘 → 다음 tick에 등록
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', handler)
    }
  }, [popoverFor])

  // popover 열릴 때 textarea focus
  useEffect(() => {
    if (popoverFor) textareaRef.current?.focus()
  }, [popoverFor])

  const openPopover = (): void => {
    if (!sel) return
    setPopoverFor(sel)
    setComment('')
  }

  const submit = (): void => {
    if (!popoverFor) return
    const c = comment.trim()
    if (!c) return
    onAdd(popoverFor.text, c, popoverFor.range)
    setPopoverFor(null)
    setComment('')
    setSel(null)
    window.getSelection()?.removeAllRanges()
  }

  const cancel = (): void => {
    setPopoverFor(null)
    setComment('')
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
      return
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      submit()
    }
  }

  const target = popoverFor ?? sel
  if (!target) return null

  // 위치: 셀렉션 오른쪽 위. viewport 넘치면 클램프. 모바일/좁은 화면에서
  // 320 폭이 viewport 를 넘는 케이스 (아이폰 SE 320px 등) 는 화면 폭에 맞춰 축소.
  const margin = 8
  const btnH = 28
  const popH = popoverFor ? 180 : btnH
  const popW = popoverFor
    ? Math.min(320, window.innerWidth - margin * 2)
    : 90
  let top = target.rect.top - popH - margin
  if (top < margin) top = target.rect.bottom + margin
  let left = target.rect.right - popW
  if (left < margin) left = margin
  const maxLeft = window.innerWidth - popW - margin
  if (left > maxLeft) left = maxLeft

  if (popoverFor) {
    return (
      <div
        ref={popoverRef}
        className="quote-popover"
        style={{ top, left, width: popW }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="quote-popover-quote">
          {popoverFor.text.length > 140
            ? popoverFor.text.slice(0, 140) + '…'
            : popoverFor.text}
        </div>
        <textarea
          ref={textareaRef}
          className="quote-popover-input"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('quote.placeholder')}
          rows={3}
        />
        <div className="quote-popover-actions">
          <button type="button" className="quote-btn-cancel" onClick={cancel}>
            {t('confirm.cancel')}
          </button>
          <button
            type="button"
            className="quote-btn-add"
            onClick={submit}
            disabled={!comment.trim()}
          >
            {t('quote.add')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      type="button"
      className="quote-affordance"
      style={{ top, left, width: popW, height: btnH }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={openPopover}
    >
      {t('quote.affordance')}
    </button>
  )
}

export default QuoteAffordance
