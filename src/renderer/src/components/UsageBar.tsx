import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatModelDisplay, formatTokens, pctClass } from '../sessionStatus'
import type { SessionStatus } from '../types'
import type { UsageData } from '../../../preload/index.d'

interface Props {
  status?: SessionStatus
  onSetPermissionMode?: (mode: string) => void
  onSetModel?: (model: string) => void
  // usage bar 의 우측 끝에 붙는 추가 element (예: 파일 첨부 버튼).
  trailing?: React.ReactNode
}

// hintKey 는 i18n dict 의 키. 렌더 시 t(hintKey) 로 lookup.
const MODEL_OPTIONS: { value: string; label: string; hintKey: string }[] = [
  { value: 'default', label: 'default', hintKey: 'usage.model.default.hint' },
  { value: 'opus', label: 'Opus', hintKey: 'usage.model.opus.hint' },
  { value: 'sonnet', label: 'Sonnet', hintKey: 'usage.model.sonnet.hint' },
  { value: 'haiku', label: 'Haiku', hintKey: 'usage.model.haiku.hint' }
]

function modelFamily(model: string | undefined): string | null {
  if (!model) return null
  const m = model.match(/^claude-(opus|sonnet|haiku)-/i)
  return m ? m[1].toLowerCase() : null
}

const MODE_LABEL: Record<string, string> = {
  default: 'default',
  auto: 'auto',
  acceptEdits: 'accept',
  bypassPermissions: 'bypass',
  plan: 'plan',
  dontAsk: 'dont-ask'
}

const MODE_OPTIONS: { value: string; label: string; hintKey: string }[] = [
  { value: 'default', label: 'default', hintKey: 'usage.mode.default.hint' },
  { value: 'auto', label: 'auto', hintKey: 'usage.mode.auto.hint' },
  { value: 'plan', label: 'plan', hintKey: 'usage.mode.plan.hint' },
  { value: 'acceptEdits', label: 'accept', hintKey: 'usage.mode.acceptEdits.hint' },
  { value: 'bypassPermissions', label: 'bypass', hintKey: 'usage.mode.bypassPermissions.hint' }
]

function modeClass(mode: string): string {
  if (mode === 'plan') return 'plan'
  if (mode === 'bypassPermissions') return 'bypass'
  if (mode === 'auto') return 'auto'
  if (mode === 'acceptEdits') return 'accept'
  return 'default'
}

// pure helper — usage.reset / usage.resetDone 키는 컴포넌트에서 t() 로 wrap.
function formatRemaining(resetMs: number, nowMs: number): { time: string | null } {
  const ms = resetMs - nowMs
  if (ms <= 0) return { time: null }
  const totalMin = Math.floor(ms / 60000)
  const days = Math.floor(totalMin / (60 * 24))
  if (days >= 1) {
    const h = Math.floor((totalMin - days * 60 * 24) / 60)
    return { time: `${days}d ${h}h` }
  }
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h >= 1) return { time: `${h}h ${m}m` }
  return { time: `${m}m` }
}

function ContextBar({ percent }: { percent: number }): React.JSX.Element {
  const cells = 10
  const filled = Math.max(0, Math.min(cells, Math.round((percent / 100) * cells)))
  return (
    <span className="ctx-bar" aria-hidden="true">
      <span className="ctx-filled">{'▮'.repeat(filled)}</span>
      <span className="ctx-empty">{'▱'.repeat(cells - filled)}</span>
    </span>
  )
}

function UsageBar({
  status,
  onSetPermissionMode,
  onSetModel,
  trailing
}: Props): React.JSX.Element | null {
  const { t } = useTranslation()
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [, setTick] = useState(0)
  const [modeOpen, setModeOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  // 모바일에서 reset 시간은 평소 가려두고 % 클릭 시 잠깐 (3초) 위에 띄움.
  // 데스크톱은 CSS 로 항상 inline 표시 — 이 state 영향 없음.
  const [openReset, setOpenReset] = useState<'fiveHour' | 'sevenDay' | null>(null)
  const lastSigRef = useRef<string>('')

  // close dropdowns on outside click
  useEffect(() => {
    if (!modeOpen && !modelOpen) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as HTMLElement
      if (modeOpen && t.closest?.('.usage-mode-wrap')) return
      if (modelOpen && t.closest?.('.usage-model-wrap')) return
      setModeOpen(false)
      setModelOpen(false)
    }
    const id = setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    return () => {
      clearTimeout(id)
      document.removeEventListener('mousedown', onDown)
    }
  }, [modeOpen, modelOpen])

  useEffect(() => {
    let cancelled = false
    const fetchOnce = async (): Promise<void> => {
      try {
        const u = await window.api.usage.get()
        if (cancelled) return
        const sig = u ? `${u.cachedAt}:${u.stale ? 1 : 0}:${u.apiError ?? ''}` : 'null'
        if (sig === lastSigRef.current) return
        lastSigRef.current = sig
        setUsage(u)
      } catch {
        // ignore
      }
    }
    void fetchOnce()
    const id = window.setInterval(fetchOnce, 1000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  // 1-minute ticker so reset countdowns refresh.
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000)
    return () => window.clearInterval(id)
  }, [])

  // 모바일에서 % 클릭 → reset 시간 popover 3초 노출 후 자동 hide. 같은 % 다시
  // 클릭하면 즉시 닫힘 (toggle).
  useEffect(() => {
    if (!openReset) return
    const id = window.setTimeout(() => setOpenReset(null), 3000)
    return () => window.clearTimeout(id)
  }, [openReset])

  const modelDisplay = status?.model ? formatModelDisplay(status.model) : null
  const currentFamily = modelFamily(status?.model)
  const showModel = !!onSetModel
  const modelLabel = modelDisplay ?? 'default'
  const ctxPercent =
    status?.contextUsedTokens != null && status?.contextWindow
      ? Math.min(100, Math.round((status.contextUsedTokens / status.contextWindow) * 100))
      : null
  const mode = status?.permissionMode
  const showMode = !!mode && !!onSetPermissionMode

  const sessionInTokens =
    (status?.sessionInputTokens ?? 0) + (status?.sessionCacheTokens ?? 0)
  const sessionOutTokens = status?.sessionOutputTokens ?? 0
  const hasSessionTokens = sessionInTokens > 0 || sessionOutTokens > 0

  // Hide entirely if there's nothing to show.
  const hasUsage = usage && (usage.fiveHour != null || usage.sevenDay != null)
  if (
    !modelDisplay &&
    ctxPercent == null &&
    !hasUsage &&
    !hasSessionTokens &&
    !showMode &&
    !showModel
  )
    return null

  const now = Date.now()
  const remainingLabel = (resetMs: number): string => {
    const r = formatRemaining(resetMs, now)
    return r.time ? t('usage.reset', { time: r.time }) : t('usage.resetDone')
  }
  return (
    <div className={`usage-bar ${usage?.stale ? 'stale' : ''}`}>
      {modelDisplay && !showModel && <span className="usage-model">[{modelDisplay}]</span>}
      {showModel && (
        <span className="usage-model-wrap">
          <button
            type="button"
            className="usage-model"
            onClick={() => setModelOpen((o) => !o)}
            title={t('usage.modelChange')}
          >
            [{modelLabel}] ▾
          </button>
          {modelOpen && (
            <div className="usage-mode-menu">
              {MODEL_OPTIONS.map((opt) => {
                const active =
                  opt.value === 'default'
                    ? currentFamily == null || !MODEL_OPTIONS.some((o) => o.value === currentFamily)
                    : opt.value === currentFamily
                return (
                  <button
                    type="button"
                    key={opt.value}
                    className={`usage-mode-option ${active ? 'active' : ''}`}
                    onClick={() => {
                      setModelOpen(false)
                      if (!active) onSetModel?.(opt.value)
                    }}
                  >
                    <span className="usage-mode-label">{opt.label}</span>
                    <span className="usage-mode-hint">{t(opt.hintKey)}</span>
                  </button>
                )
              })}
            </div>
          )}
        </span>
      )}

      {ctxPercent != null && (
        <span className="usage-window">
          <span className="usage-label">Context</span>
          <ContextBar percent={ctxPercent} />
          <span className={`usage-pct ${pctClass(ctxPercent)}`}>{ctxPercent}%</span>
        </span>
      )}

      {hasSessionTokens && (
        <span className="usage-window" title={t('usage.sessionTotalTitle')}>
          <span className="usage-label">Σ</span>
          <span className="usage-tokens">
            ↑{formatTokens(sessionInTokens)} ↓{formatTokens(sessionOutTokens)}
          </span>
        </span>
      )}

      {usage?.planName && <span className="usage-plan">{usage.planName}</span>}

      {usage?.fiveHour != null && (
        <span className={`usage-window${openReset === 'fiveHour' ? ' show-reset' : ''}`}>
          <span className="usage-label">5h</span>
          <button
            type="button"
            className={`usage-pct ${pctClass(usage.fiveHour)}`}
            onClick={() =>
              setOpenReset((prev) => (prev === 'fiveHour' ? null : 'fiveHour'))
            }
          >
            {usage.fiveHour}%
          </button>
          {usage.fiveHourResetAt != null && (
            <span className="usage-reset">({remainingLabel(usage.fiveHourResetAt)})</span>
          )}
        </span>
      )}

      {usage?.sevenDay != null && (
        <span className={`usage-window${openReset === 'sevenDay' ? ' show-reset' : ''}`}>
          <span className="usage-label">7d</span>
          <button
            type="button"
            className={`usage-pct ${pctClass(usage.sevenDay)}`}
            onClick={() =>
              setOpenReset((prev) => (prev === 'sevenDay' ? null : 'sevenDay'))
            }
          >
            {usage.sevenDay}%
          </button>
          {usage.sevenDayResetAt != null && (
            <span className="usage-reset">({remainingLabel(usage.sevenDayResetAt)})</span>
          )}
        </span>
      )}

      {usage?.stale && <span className="usage-stale-tag">stale</span>}

      {showMode && (
        <span className="usage-mode-wrap">
          <button
            type="button"
            className={`usage-mode ${modeClass(mode!)}`}
            onClick={() => setModeOpen((o) => !o)}
            title={t('usage.modeChange')}
          >
            {MODE_LABEL[mode!] ?? mode} ▾
          </button>
          {modeOpen && (
            <div className="usage-mode-menu">
              {MODE_OPTIONS.map((opt) => (
                <button
                  type="button"
                  key={opt.value}
                  className={`usage-mode-option ${opt.value === mode ? 'active' : ''}`}
                  onClick={() => {
                    setModeOpen(false)
                    if (opt.value !== mode) onSetPermissionMode?.(opt.value)
                  }}
                >
                  <span className={`usage-mode-dot ${modeClass(opt.value)}`} />
                  <span className="usage-mode-label">{opt.label}</span>
                  <span className="usage-mode-hint">{t(opt.hintKey)}</span>
                </button>
              ))}
            </div>
          )}
        </span>
      )}

      {trailing && <span className="usage-trailing">{trailing}</span>}
    </div>
  )
}

export default UsageBar
