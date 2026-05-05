// Native window.confirm 대체용 in-app confirm modal.
// Why: Electron 의 native confirm 이 닫힐 때 BrowserWindow 가 inactive 로
// 빠져 그 다음 키 입력이 통째로 사라지는 문제 회피. 모든 confirm 류는
// appConfirm() 으로 통일.
//
// 사용:
//   const ok = await appConfirm('정말 삭제할까요?')
//   const ok = await appConfirm({ message: '...', destructive: true })
//
// App 루트에 <ConfirmHost /> 한 번 마운트해야 동작. 마운트 전 호출은 native
// window.confirm 으로 fallback (production 에서는 항상 host 가 떠 있어 무관).

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ConfirmOptions {
  message: string
  okLabel?: string
  cancelLabel?: string
  // true 면 cancel 에 default focus, OK 버튼 destructive 강조. 의도치 않은
  // Enter 클릭으로 위험 액션이 일어나는 걸 막는다.
  destructive?: boolean
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (v: boolean) => void
}

let openImpl: ((opts: ConfirmOptions) => Promise<boolean>) | null = null

export function appConfirm(messageOrOpts: string | ConfirmOptions): Promise<boolean> {
  const opts: ConfirmOptions =
    typeof messageOrOpts === 'string' ? { message: messageOrOpts } : messageOrOpts
  if (openImpl) return openImpl(opts)
  return Promise.resolve(window.confirm(opts.message))
}

export function ConfirmHost(): React.JSX.Element | null {
  const { t } = useTranslation()
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const okRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    openImpl = (opts) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...opts, resolve })
      })
    return () => {
      openImpl = null
    }
  }, [])

  // default focus — destructive 면 cancel, 아니면 ok. button 이 focus 잡고
  // 있으면 Enter/Space 로 native click 트리거됨 (별도 키 핸들러 불필요).
  useEffect(() => {
    if (!pending) return
    const target = pending.destructive ? cancelRef.current : okRef.current
    target?.focus()
  }, [pending])

  if (!pending) return null

  const respond = (v: boolean): void => {
    pending.resolve(v)
    setPending(null)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      // 글로벌 ESC interrupt 핸들러 (App.tsx) 까지 전파되지 않게.
      e.preventDefault()
      e.stopPropagation()
      respond(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        // backdrop 클릭으로 cancel — 모달 영역 안 클릭과 구분.
        if (e.target === e.currentTarget) respond(false)
      }}
      onKeyDown={onKeyDown}
    >
      <div className="modal modal-confirm" role="dialog" aria-modal="true">
        <div className="modal-body confirm-body">
          {pending.message.split('\n').map((line, i) => (
            <p key={i} className="confirm-line">
              {line || ' '}
            </p>
          ))}
        </div>
        <footer className="modal-footer">
          <button
            type="button"
            className="modal-btn secondary"
            ref={cancelRef}
            onClick={() => respond(false)}
          >
            {pending.cancelLabel ?? t('dialog.cancel')}
          </button>
          <button
            type="button"
            className={`modal-btn primary${pending.destructive ? ' destructive' : ''}`}
            ref={okRef}
            onClick={() => respond(true)}
          >
            {pending.okLabel ?? t('dialog.ok')}
          </button>
        </footer>
      </div>
    </div>
  )
}
