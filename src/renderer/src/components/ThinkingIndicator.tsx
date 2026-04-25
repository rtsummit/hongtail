import { useEffect, useState } from 'react'
import { formatTokens } from '../sessionStatus'

interface Props {
  verb?: string
  turnStart?: number
  outputTokens?: number
}

function ThinkingIndicator({ verb, turnStart, outputTokens }: Props): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [])

  const elapsedSec = turnStart ? Math.max(0, Math.floor((now - turnStart) / 1000)) : 0

  return (
    <div className="thinking-row">
      <span className="thinking-spinner">✦</span>
      <span className="thinking-verb">{verb ?? 'Thinking'}…</span>
      <span className="thinking-info">
        ({elapsedSec}s
        {outputTokens ? ` · ↓ ${formatTokens(outputTokens)} tokens` : ''})
      </span>
    </div>
  )
}

export default ThinkingIndicator
