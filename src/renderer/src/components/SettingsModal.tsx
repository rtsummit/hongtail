import { useEffect, useState } from 'react'
import type { AppSettings } from '../settings'
import { DEFAULT_SETTINGS } from '../settings'

interface Props {
  open: boolean
  settings: AppSettings
  onClose: () => void
  onChange: (next: AppSettings) => void
}

function FontStackEditor({
  label,
  fonts,
  available,
  onUpdate
}: {
  label: string
  fonts: string[]
  available: string[]
  onUpdate: (next: string[]) => void
}): React.JSX.Element {
  const [pick, setPick] = useState<string>('')

  // Reset selection when fonts change so the picker doesn't stick on a now-added entry
  useEffect(() => {
    setPick('')
  }, [fonts])

  const remaining = available.filter((f) => !fonts.includes(f))

  const handleAdd = (): void => {
    if (!pick) return
    if (fonts.includes(pick)) return
    onUpdate([...fonts, pick])
  }

  const remove = (font: string): void => {
    onUpdate(fonts.filter((f) => f !== font))
  }

  const move = (idx: number, delta: number): void => {
    const target = idx + delta
    if (target < 0 || target >= fonts.length) return
    const next = fonts.slice()
    const [item] = next.splice(idx, 1)
    next.splice(target, 0, item)
    onUpdate(next)
  }

  return (
    <div className="settings-row">
      <span className="settings-label">{label}</span>
      <div className="font-chips">
        {fonts.length === 0 ? (
          <span className="font-chips-empty">기본값 사용 (시스템 폰트)</span>
        ) : (
          fonts.map((f, i) => (
            <span
              key={f}
              className="font-chip"
              style={{ fontFamily: `"${f}", sans-serif` }}
            >
              <button
                type="button"
                className="font-chip-move"
                title="우선순위 올리기"
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                ‹
              </button>
              <span className="font-chip-name">{f}</span>
              <button
                type="button"
                className="font-chip-move"
                title="우선순위 내리기"
                disabled={i === fonts.length - 1}
                onClick={() => move(i, 1)}
              >
                ›
              </button>
              <button
                type="button"
                className="font-chip-remove"
                title="제거"
                onClick={() => remove(f)}
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>
      <div className="font-add">
        <select
          className="font-select"
          value={pick}
          onChange={(e) => setPick(e.target.value)}
        >
          <option value="">— 폰트 선택 —</option>
          {remaining.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="font-add-btn"
          onClick={handleAdd}
          disabled={!pick}
          title="추가"
        >
          +
        </button>
      </div>
    </div>
  )
}

function SettingsModal({ open, settings, onClose, onChange }: Props): React.JSX.Element | null {
  const [available, setAvailable] = useState<string[]>([])
  const [loadingFonts, setLoadingFonts] = useState(false)

  useEffect(() => {
    if (!open) return
    if (available.length > 0) return
    setLoadingFonts(true)
    void window.api.fonts
      .list()
      .then((list) => setAvailable(list))
      .catch((err) => {
        console.error('font list failed:', err)
        setAvailable([])
      })
      .finally(() => setLoadingFonts(false))
  }, [open, available.length])

  if (!open) return null

  const reset = (): void => onChange({ ...DEFAULT_SETTINGS })

  const sizeChange = (raw: string): void => {
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    const clamped = Math.min(32, Math.max(8, Math.round(n)))
    onChange({ ...settings, fontSize: clamped })
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal" role="dialog" aria-label="설정">
        <header className="modal-header">
          <h2>설정</h2>
          <button type="button" className="modal-close" onClick={onClose} title="닫기">
            ×
          </button>
        </header>
        <div className="modal-body">
          {loadingFonts && (
            <p className="settings-hint">시스템 폰트 목록 가져오는 중…</p>
          )}
          <FontStackEditor
            label="UI 폰트"
            fonts={settings.uiFonts}
            available={available}
            onUpdate={(next) => onChange({ ...settings, uiFonts: next })}
          />
          <FontStackEditor
            label="코드 폰트 (mono)"
            fonts={settings.monoFonts}
            available={available}
            onUpdate={(next) => onChange({ ...settings, monoFonts: next })}
          />
          <label className="settings-row">
            <span className="settings-label">
              글자 크기 <span className="settings-value">{settings.fontSize}px</span>
            </span>
            <input
              type="number"
              min={8}
              max={32}
              step={1}
              value={settings.fontSize}
              onChange={(e) => sizeChange(e.target.value)}
            />
          </label>
          <p className="settings-hint">
            폰트는 추가한 순서대로 fallback 됩니다 (왼쪽이 우선). ‹ › 로 우선순위 변경.
          </p>
          <hr className="settings-divider" />
          <label className="settings-row">
            <span className="settings-label">
              읽기 전용 한 번에 불러올 줄 수
              <span className="settings-value">{settings.readonlyChunkSize}</span>
            </span>
            <input
              type="number"
              min={20}
              max={2000}
              step={50}
              value={settings.readonlyChunkSize}
              onChange={(e) => {
                const n = Math.min(2000, Math.max(20, Math.round(Number(e.target.value))))
                if (Number.isFinite(n)) onChange({ ...settings, readonlyChunkSize: n })
              }}
            />
          </label>
          <label className="settings-row settings-row-inline">
            <input
              type="checkbox"
              checked={settings.toolCardsDefaultOpen}
              onChange={(e) =>
                onChange({ ...settings, toolCardsDefaultOpen: e.target.checked })
              }
            />
            <span className="settings-label-inline">도구 카드 (Bash/Edit 등) 기본 펼침</span>
          </label>
          <hr className="settings-divider" />
          <label className="settings-row settings-row-inline">
            <input
              type="checkbox"
              checked={settings.defaultBackend === 'terminal'}
              onChange={(e) =>
                onChange({
                  ...settings,
                  defaultBackend: e.target.checked ? 'terminal' : 'app'
                })
              }
            />
            <span className="settings-label-inline">대화를 터미널로 열기</span>
          </label>
          <p className="settings-hint">
            끄면 앱 모드 (기본). 새 대화 시작 시에만 적용 — 기존 진행 중 대화에는 영향 없음.
          </p>
        </div>
        <footer className="modal-footer">
          <button type="button" className="modal-btn secondary" onClick={reset}>
            기본값
          </button>
          <button type="button" className="modal-btn primary" onClick={onClose}>
            완료
          </button>
        </footer>
      </div>
    </div>
  )
}

export default SettingsModal
