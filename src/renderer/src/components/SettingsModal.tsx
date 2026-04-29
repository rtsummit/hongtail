import { useEffect, useState } from 'react'
import type { AppSettings } from '../settings'
import { DEFAULT_SETTINGS, KNOWN_TOOL_NAMES } from '../settings'
import type { WebSettings } from '../../../preload/index.d'

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

function ToolCardsDefaultOpenEditor({
  value,
  onUpdate
}: {
  value: string[]
  onUpdate: (next: string[]) => void
}): React.JSX.Element {
  const set = new Set(value)
  const allOn = KNOWN_TOOL_NAMES.every((n) => set.has(n))
  const noneOn = KNOWN_TOOL_NAMES.every((n) => !set.has(n))

  const toggle = (name: string): void => {
    const next = new Set(set)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    onUpdate(KNOWN_TOOL_NAMES.filter((n) => next.has(n)))
  }
  const setAll = (on: boolean): void => {
    onUpdate(on ? [...KNOWN_TOOL_NAMES] : [])
  }

  return (
    <div className="settings-row tool-cards-default-open">
      <span className="settings-label">기본 펼침 도구 카드</span>
      <div className="tool-cards-default-open-grid">
        {KNOWN_TOOL_NAMES.map((name) => (
          <label key={name} className="tool-cards-default-open-item">
            <input
              type="checkbox"
              checked={set.has(name)}
              onChange={() => toggle(name)}
            />
            <span>{name}</span>
          </label>
        ))}
        <div className="tool-cards-default-open-actions">
          <button type="button" onClick={() => setAll(true)} disabled={allOn}>
            모두
          </button>
          <button type="button" onClick={() => setAll(false)} disabled={noneOn}>
            없음
          </button>
        </div>
      </div>
    </div>
  )
}

function SettingsModal({ open, settings, onClose, onChange }: Props): React.JSX.Element | null {
  const [available, setAvailable] = useState<string[]>([])
  const [loadingFonts, setLoadingFonts] = useState(false)
  const [web, setWeb] = useState<WebSettings | null>(null)
  const [webError, setWebError] = useState<string>('')
  const [hasPassword, setHasPassword] = useState<boolean>(false)
  const [pwDraft, setPwDraft] = useState<string>('')
  const [pwConfirm, setPwConfirm] = useState<string>('')
  const [pwMessage, setPwMessage] = useState<string>('')
  const [sizeDraft, setSizeDraft] = useState<string>(String(settings.fontSize))

  // Sync draft when external settings change (e.g. reset to defaults)
  useEffect(() => {
    setSizeDraft(String(settings.fontSize))
  }, [settings.fontSize])

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

  useEffect(() => {
    if (!open) return
    void window.api.web
      .getSettings()
      .then((s) => setWeb(s))
      .catch((err) => {
        console.error('load web settings failed:', err)
        setWeb(null)
      })
    void window.api.web
      .hasPassword()
      .then(setHasPassword)
      .catch(() => setHasPassword(false))
    setPwDraft('')
    setPwConfirm('')
    setPwMessage('')
  }, [open])

  const submitPassword = (): void => {
    setPwMessage('')
    if (pwDraft.length < 8) {
      setPwMessage('비밀번호는 8자 이상이어야 합니다')
      return
    }
    if (pwDraft !== pwConfirm) {
      setPwMessage('두 비밀번호가 일치하지 않습니다')
      return
    }
    void window.api.web
      .setPassword(pwDraft)
      .then(() => {
        setHasPassword(true)
        setPwDraft('')
        setPwConfirm('')
        setPwMessage('변경됨. 모든 기존 세션 무효화.')
      })
      .catch((err) => {
        setPwMessage(String(err))
      })
  }

  const updateWeb = (patch: Partial<WebSettings>): void => {
    if (!web) return
    const next = { ...web, ...patch }
    setWeb(next)
    setWebError('')
    void window.api.web
      .setSettings(patch)
      .then((applied) => setWeb(applied))
      .catch((err) => {
        console.error('save web settings failed:', err)
        setWebError(String(err))
      })
  }

  if (!open) return null

  const reset = (): void => onChange({ ...DEFAULT_SETTINGS })

  const commitSize = (): void => {
    const n = Number(sizeDraft)
    if (!Number.isFinite(n)) {
      setSizeDraft(String(settings.fontSize))
      return
    }
    const clamped = Math.min(32, Math.max(8, Math.round(n)))
    setSizeDraft(String(clamped))
    if (clamped !== settings.fontSize) onChange({ ...settings, fontSize: clamped })
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
            label="폰트"
            fonts={settings.fonts}
            available={available}
            onUpdate={(next) => onChange({ ...settings, fonts: next })}
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
              value={sizeDraft}
              onChange={(e) => setSizeDraft(e.target.value)}
              onBlur={commitSize}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitSize()
                }
              }}
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
          <ToolCardsDefaultOpenEditor
            value={settings.toolCardsDefaultOpen}
            onUpdate={(next) => onChange({ ...settings, toolCardsDefaultOpen: next })}
          />
          {web && (
            <>
              <hr className="settings-divider" />
              <h3 className="settings-section-title">웹 모드</h3>
              <div className="settings-row">
                <span className="settings-label">
                  비밀번호 {hasPassword ? '(설정됨)' : '— 미설정'}
                </span>
                <input
                  type="password"
                  value={pwDraft}
                  onChange={(e) => setPwDraft(e.target.value)}
                  placeholder="새 비밀번호 (8자 이상)"
                  autoComplete="new-password"
                />
                <input
                  type="password"
                  value={pwConfirm}
                  onChange={(e) => setPwConfirm(e.target.value)}
                  placeholder="비밀번호 확인"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="settings-tls-btn"
                  onClick={submitPassword}
                  disabled={!pwDraft || !pwConfirm}
                >
                  {hasPassword ? '변경' : '설정'}
                </button>
                {pwMessage && <p className="settings-hint">{pwMessage}</p>}
              </div>
              <label className="settings-row settings-row-inline">
                <input
                  type="checkbox"
                  checked={web.enabled}
                  onChange={(e) => updateWeb({ enabled: e.target.checked })}
                />
                <span className="settings-label-inline">
                  웹 서버 활성화 (외부 브라우저 / 모바일에서 접속)
                </span>
              </label>
              <label className="settings-row">
                <span className="settings-label">포트</span>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  step={1}
                  value={web.port}
                  onChange={(e) => {
                    const n = Math.round(Number(e.target.value))
                    if (Number.isFinite(n) && n > 0 && n < 65536) {
                      updateWeb({ port: n })
                    }
                  }}
                />
              </label>
              <div className="settings-row">
                <span className="settings-label">TLS 인증서 (.pem) — 비우면 HTTP</span>
                <div className="settings-tls-row">
                  <span className="settings-tls-path" title={web.tlsCertPath ?? ''}>
                    {web.tlsCertPath || '(없음)'}
                  </span>
                  <button
                    type="button"
                    className="settings-tls-btn"
                    onClick={() =>
                      void window.api.web.pickTlsFile().then((p) => {
                        if (p) updateWeb({ tlsCertPath: p })
                      })
                    }
                  >
                    선택…
                  </button>
                  {web.tlsCertPath && (
                    <button
                      type="button"
                      className="settings-tls-btn"
                      onClick={() => updateWeb({ tlsCertPath: null })}
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
              <div className="settings-row">
                <span className="settings-label">TLS 키 (.pem)</span>
                <div className="settings-tls-row">
                  <span className="settings-tls-path" title={web.tlsKeyPath ?? ''}>
                    {web.tlsKeyPath || '(없음)'}
                  </span>
                  <button
                    type="button"
                    className="settings-tls-btn"
                    onClick={() =>
                      void window.api.web.pickTlsFile().then((p) => {
                        if (p) updateWeb({ tlsKeyPath: p })
                      })
                    }
                  >
                    선택…
                  </button>
                  {web.tlsKeyPath && (
                    <button
                      type="button"
                      className="settings-tls-btn"
                      onClick={() => updateWeb({ tlsKeyPath: null })}
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
              <p className="settings-hint">
                cert + key 두 파일을 모두 지정하면 자동으로 HTTPS. 변경 시 즉시
                서버 재시작. 활성 상태에서 포트 변경 시에도 같은 포트로 listen
                중이면 EADDRINUSE 로 비활성될 수 있으니 잠시 후 다시 켜기.
              </p>
              {webError && <p className="settings-hint" style={{ color: '#ff6b6b' }}>{webError}</p>}
            </>
          )}
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
