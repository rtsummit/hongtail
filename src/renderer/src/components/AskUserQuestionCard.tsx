import { memo, useMemo, useState } from 'react'
import type { AskUserQuestionDef } from '../types'

interface Props {
  questions: AskUserQuestionDef[]
  resolved?: { answers: Record<string, string | string[]> } | { cancelled: true }
  onSubmit: (answers: Record<string, string>) => void
  onCancel: () => void
}

// AskUserQuestion 의 호스트 confirm 카드. 자식이 보낸 questions 배열을 라디오/
// 체크박스로 렌더, 사용자 선택을 answers map (question text → label string,
// multiSelect 면 콤마 구분) 으로 모아 onSubmit 으로 통보.
//
// claude-code-main 의 answers schema (AskUserQuestionTool.tsx:71): record<string,
// string> — key 는 question text. 자세히는 docs/host-confirm-ui-plan.md §11.3.
function AskUserQuestionCard({
  questions,
  resolved,
  onSubmit,
  onCancel
}: Props): React.JSX.Element {
  // 각 질문별 선택 상태 — 단일 (string) 또는 다중 (Set<string>)
  const initial = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const q of questions) map.set(q.question, new Set())
    return map
  }, [questions])
  const [selections, setSelections] = useState<Map<string, Set<string>>>(initial)

  const disabled = !!resolved
  const wasCancelled = resolved && 'cancelled' in resolved

  const toggle = (questionText: string, label: string, multiSelect: boolean): void => {
    setSelections((prev) => {
      const next = new Map(prev)
      const set = new Set(next.get(questionText) ?? [])
      if (multiSelect) {
        if (set.has(label)) set.delete(label)
        else set.add(label)
      } else {
        // 단일 선택 — 다른 옵션 제거
        set.clear()
        set.add(label)
      }
      next.set(questionText, set)
      return next
    })
  }

  const allAnswered = questions.every((q) => (selections.get(q.question)?.size ?? 0) > 0)

  const handleSubmit = (): void => {
    const answers: Record<string, string> = {}
    for (const q of questions) {
      const set = selections.get(q.question) ?? new Set()
      // multiSelect: 콤마 구분, 그 외: 단일 라벨
      answers[q.question] = Array.from(set).join(',')
    }
    onSubmit(answers)
  }

  return (
    <div className={`confirm-card ask-user-question${disabled ? ' resolved' : ''}`}>
      <div className="confirm-header">
        <span className="confirm-icon">?</span>
        <span className="confirm-title">사용자 입력 요청</span>
        {disabled && !wasCancelled ? (
          <span className="confirm-status approved">응답됨</span>
        ) : null}
        {wasCancelled ? <span className="confirm-status denied">취소됨</span> : null}
      </div>
      <div className="confirm-body">
        {questions.map((q, qi) => {
          const multi = !!q.multiSelect
          const selectedSet = selections.get(q.question) ?? new Set<string>()
          const resolvedAnswer = !disabled || wasCancelled
            ? null
            : (resolved as { answers: Record<string, string | string[]> }).answers[q.question]
          return (
            <div className="ask-question" key={qi}>
              <div className="ask-question-text">{q.question}</div>
              {q.header && q.header !== q.question ? (
                <div className="ask-question-header">{q.header}</div>
              ) : null}
              <div className="ask-options">
                {q.options.map((opt, oi) => {
                  const isSelected = disabled
                    ? Array.isArray(resolvedAnswer)
                      ? resolvedAnswer.includes(opt.label)
                      : typeof resolvedAnswer === 'string' &&
                        resolvedAnswer.split(',').includes(opt.label)
                    : selectedSet.has(opt.label)
                  return (
                    <label
                      key={oi}
                      className={`ask-option${isSelected ? ' selected' : ''}${disabled ? ' disabled' : ''}`}
                    >
                      <input
                        type={multi ? 'checkbox' : 'radio'}
                        name={`q-${qi}`}
                        checked={isSelected}
                        disabled={disabled}
                        onChange={() => toggle(q.question, opt.label, multi)}
                      />
                      <span className="ask-option-label">{opt.label}</span>
                      {opt.description ? (
                        <span className="ask-option-desc">{opt.description}</span>
                      ) : null}
                    </label>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      {!disabled ? (
        <div className="confirm-actions">
          <button
            type="button"
            className="btn primary"
            disabled={!allAnswered}
            onClick={handleSubmit}
          >
            제출
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            취소
          </button>
        </div>
      ) : null}
    </div>
  )
}

export default memo(AskUserQuestionCard)
