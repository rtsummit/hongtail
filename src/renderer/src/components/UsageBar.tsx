import { useEffect, useRef, useState } from 'react'
import { formatModelDisplay, formatTokens, pctClass } from '../sessionStatus'
import type { SessionStatus } from '../types'
import type { UsageData } from '../../../preload/index.d'

interface Props {
  status?: SessionStatus
  onSetPermissionMode?: (mode: string) => void
  onSetModel?: (model: string) => void
}

const MODEL_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: 'default', label: 'default', hint: '기본 (대화 시작 시 모델)' },
  { value: 'opus', label: 'Opus', hint: '최고 성능 — 비싸고 느림' },
  { value: 'sonnet', label: 'Sonnet', hint: '균형 — 일상 작업' },
  { value: 'haiku', label: 'Haiku', hint: '빠르고 저렴 — 단순 작업' }
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

const MODE_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: 'default', label: 'default', hint: '기본 — 매 도구 호출 확인' },
  { value: 'auto', label: 'auto', hint: '자동 분류 (안전한 건 통과)' },
  { value: 'plan', label: 'plan', hint: '도구 차단, 계획만 작성' },
  { value: 'acceptEdits', label: 'accept', hint: '파일 편집 자동 승인' },
  { value: 'bypassPermissions', label: 'bypass', hint: '⚠ 모든 권한 무시' }
]

function modeClass(mode: string): string {
  if (mode === 'plan') return 'plan'
  if (mode === 'bypassPermissions') return 'bypass'
  if (mode === 'auto') return 'auto'
  if (mode === 'acceptEdits') return 'accept'
  return 'default'
}

function formatRemaining(resetMs: number, nowMs: number): string {
  const ms = resetMs - nowMs
  if (ms <= 0) return '리셋됨'
  const totalMin = Math.floor(ms / 60000)
  const days = Math.floor(totalMin / (60 * 24))
  if (days >= 1) {
    const h = Math.floor((totalMin - days * 60 * 24) / 60)
    return `${days}d ${h}h`
  }
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h >= 1) return `${h}h ${m}m`
  return `${m}m`
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
  onSetModel
}: Props): React.JSX.Element | null {
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [, setTick] = useState(0)
  const [modeOpen, setModeOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
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
  const sessionCost = status?.sessionCostUsd ?? 0
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
  return (
    <div className={`usage-bar ${usage?.stale ? 'stale' : ''}`}>
      {modelDisplay && !showModel && <span className="usage-model">[{modelDisplay}]</span>}
      {showModel && (
        <span className="usage-model-wrap">
          <button
            type="button"
            className="usage-model"
            onClick={() => setModelOpen((o) => !o)}
            title="모델 변경"
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
                    <span className="usage-mode-hint">{opt.hint}</span>
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
        <span className="usage-window" title="이 세션 누적 (sub-agent 포함)">
          <span className="usage-label">Σ</span>
          <span className="usage-tokens">
            ↑{formatTokens(sessionInTokens)} ↓{formatTokens(sessionOutTokens)}
          </span>
          {sessionCost > 0 && (
            <span className="usage-cost">${sessionCost.toFixed(2)}</span>
          )}
        </span>
      )}

      {usage?.planName && <span className="usage-plan">{usage.planName}</span>}

      {usage?.fiveHour != null && (
        <span className="usage-window">
          <span className="usage-label">5h</span>
          <span className={`usage-pct ${pctClass(usage.fiveHour)}`}>{usage.fiveHour}%</span>
          {usage.fiveHourResetAt != null && (
            <span className="usage-reset">({formatRemaining(usage.fiveHourResetAt, now)})</span>
          )}
        </span>
      )}

      {usage?.sevenDay != null && (
        <span className="usage-window">
          <span className="usage-label">7d</span>
          <span className={`usage-pct ${pctClass(usage.sevenDay)}`}>{usage.sevenDay}%</span>
          {usage.sevenDayResetAt != null && (
            <span className="usage-reset">({formatRemaining(usage.sevenDayResetAt, now)})</span>
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
            title="권한 모드 변경"
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
                  <span className="usage-mode-hint">{opt.hint}</span>
                </button>
              ))}
            </div>
          )}
        </span>
      )}
    </div>
  )
}

export default UsageBar
