import { memo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Props {
  plan: string
  planFilePath?: string
  resolved?: 'approve' | 'deny'
  onApprove: () => void
  onDeny: (message: string) => void
}

// ExitPlanMode 의 호스트 confirm 카드. 자식이 보낸 plan 텍스트를 markdown 으로
// 보여주고 승인/거부 버튼. 거부 시 사용자가 피드백 입력 가능 (모델이 plan
// 다시 짜는 데 활용). 자세히는 docs/host-confirm-ui-plan.md §11.3.
function ExitPlanModeCard({
  plan,
  planFilePath,
  resolved,
  onApprove,
  onDeny
}: Props): React.JSX.Element {
  const [denyMode, setDenyMode] = useState(false)
  const [feedback, setFeedback] = useState('')

  const disabled = !!resolved
  const approved = resolved === 'approve'
  const denied = resolved === 'deny'

  return (
    <div className={`confirm-card exit-plan-mode${disabled ? ' resolved' : ''}`}>
      <div className="confirm-header">
        <span className="confirm-icon">▤</span>
        <span className="confirm-title">Plan 승인 요청</span>
        {approved ? <span className="confirm-status approved">승인됨</span> : null}
        {denied ? <span className="confirm-status denied">거절됨</span> : null}
      </div>
      <div className="confirm-body bubble-markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{plan}</ReactMarkdown>
      </div>
      {planFilePath ? (
        <div className="confirm-meta">
          저장 위치: <code>{planFilePath}</code>
        </div>
      ) : null}
      {!disabled && !denyMode ? (
        <div className="confirm-actions">
          <button type="button" className="btn primary" onClick={onApprove}>
            승인하고 진행
          </button>
          <button type="button" className="btn" onClick={() => setDenyMode(true)}>
            거절하고 피드백
          </button>
        </div>
      ) : null}
      {!disabled && denyMode ? (
        <div className="confirm-deny-form">
          <textarea
            className="confirm-feedback"
            value={feedback}
            placeholder="plan 의 어떤 부분을 고쳐야 하는지 적어주세요."
            onChange={(e) => setFeedback(e.target.value)}
            rows={3}
            autoFocus
          />
          <div className="confirm-actions">
            <button
              type="button"
              className="btn primary"
              disabled={!feedback.trim()}
              onClick={() => onDeny(feedback.trim())}
            >
              거절 보내기
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setDenyMode(false)
                setFeedback('')
              }}
            >
              취소
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default memo(ExitPlanModeCard)
