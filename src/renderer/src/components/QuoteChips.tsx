export interface Quote {
  id: string
  text: string
  comment: string
}

interface Props {
  quotes: Quote[]
  onRemove: (id: string) => void
}

function previewText(s: string, n = 40): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > n ? flat.slice(0, n) + '…' : flat
}

function QuoteChips({ quotes, onRemove }: Props): React.JSX.Element | null {
  if (quotes.length === 0) return null
  return (
    <div className="quote-chips">
      {quotes.map((q) => (
        <span
          key={q.id}
          className="quote-chip"
          title={`"${q.text}"\n\n${q.comment}`}
        >
          <span className="quote-chip-text">› {previewText(q.text)}</span>
          {q.comment && (
            <span className="quote-chip-comment">— {previewText(q.comment, 30)}</span>
          )}
          <button
            type="button"
            className="quote-chip-remove"
            onClick={() => onRemove(q.id)}
            aria-label="인용 제거"
          >
            ✕
          </button>
        </span>
      ))}
    </div>
  )
}

export default QuoteChips
