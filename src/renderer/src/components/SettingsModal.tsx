import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppSettings, PermissionModeSetting } from '../settings'
import { DEFAULT_SETTINGS, KNOWN_TOOL_NAMES, PERMISSION_MODE_VALUES } from '../settings'
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
  const { t } = useTranslation()
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
          <span className="font-chips-empty">{t('settings.fontChip.empty')}</span>
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
                title={t('settings.fontChip.up')}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                ‹
              </button>
              <span className="font-chip-name">{f}</span>
              <button
                type="button"
                className="font-chip-move"
                title={t('settings.fontChip.down')}
                disabled={i === fonts.length - 1}
                onClick={() => move(i, 1)}
              >
                ›
              </button>
              <button
                type="button"
                className="font-chip-remove"
                title={t('settings.fontChip.remove')}
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
          <option value="">{t('settings.fontChip.pick')}</option>
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
          title={t('settings.fontChip.add')}
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
  const { t } = useTranslation()
  const [available, setAvailable] = useState<string[]>([])
  const [loadingFonts, setLoadingFonts] = useState(false)
  const [web, setWeb] = useState<WebSettings | null>(null)
  const [webError, setWebError] = useState<string>('')
  const [hasPassword, setHasPassword] = useState<boolean>(false)
  const [pwDraft, setPwDraft] = useState<string>('')
  const [pwConfirm, setPwConfirm] = useState<string>('')
  const [pwMessage, setPwMessage] = useState<string>('')
  const [sizeDraft, setSizeDraft] = useState<string>(String(settings.fontSize))
  const [chunkDraft, setChunkDraft] = useState<string>(String(settings.readonlyChunkSize))
  // 호스트가 dev 모드인지 — Electron 창은 import.meta.env.DEV 와 일치하지만
  // web 사용자는 production 빌드를 받기 때문에 RPC 로 따로 물어야 한다.
  const [devAvailable, setDevAvailable] = useState<boolean>(false)

  // Sync draft when external settings change (e.g. reset to defaults)
  useEffect(() => {
    setSizeDraft(String(settings.fontSize))
  }, [settings.fontSize])

  useEffect(() => {
    setChunkDraft(String(settings.readonlyChunkSize))
  }, [settings.readonlyChunkSize])

  useEffect(() => {
    if (!open) return
    void window.api.dev
      .available()
      .then(setDevAvailable)
      .catch(() => setDevAvailable(false))
  }, [open])

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

  // ESC 로 모달 닫기. capture + stopPropagation 으로 등록해 글로벌 ESC interrupt
  // 핸들러보다 먼저 잡고 전파 막음.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (e.isComposing || e.keyCode === 229) return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  const submitPassword = (): void => {
    setPwMessage('')
    if (pwDraft.length < 8) {
      setPwMessage(t('settings.password.tooShort'))
      return
    }
    if (pwDraft !== pwConfirm) {
      setPwMessage(t('settings.password.mismatch'))
      return
    }
    void window.api.web
      .setPassword(pwDraft)
      .then(() => {
        setHasPassword(true)
        setPwDraft('')
        setPwConfirm('')
        setPwMessage(t('settings.password.changed'))
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

  const commitChunk = (): void => {
    const n = Number(chunkDraft)
    if (!Number.isFinite(n)) {
      setChunkDraft(String(settings.readonlyChunkSize))
      return
    }
    const clamped = Math.min(2000, Math.max(20, Math.round(n)))
    setChunkDraft(String(clamped))
    if (clamped !== settings.readonlyChunkSize) {
      onChange({ ...settings, readonlyChunkSize: clamped })
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal" role="dialog" aria-label={t('settings.title')}>
        <header className="modal-header">
          <h2>{t('settings.title')}</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            title={t('settings.close')}
          >
            ×
          </button>
        </header>
        <div className="modal-body">
          <label className="settings-row">
            <span className="settings-label">{t('settings.language')}</span>
            <select
              value={settings.language}
              onChange={(e) =>
                onChange({
                  ...settings,
                  language: e.target.value as AppSettings['language']
                })
              }
            >
              <option value="auto">{t('settings.language.auto')}</option>
              <option value="ko">{t('settings.language.ko')}</option>
              <option value="en">{t('settings.language.en')}</option>
            </select>
          </label>
          <hr className="settings-divider" />
          {loadingFonts && (
            <p className="settings-hint">{t('settings.loadingFonts')}</p>
          )}
          <FontStackEditor
            label={t('settings.font')}
            fonts={settings.fonts}
            available={available}
            onUpdate={(next) => onChange({ ...settings, fonts: next })}
          />
          <label className="settings-row">
            <span className="settings-label">
              {t('settings.fontSize')}{' '}
              <span className="settings-value">{settings.fontSize}px</span>
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
          <p className="settings-hint">{t('settings.fontHint')}</p>
          <hr className="settings-divider" />
          <label className="settings-row">
            <span className="settings-label">
              {t('settings.readonlyChunkSize')}
              <span className="settings-value">{settings.readonlyChunkSize}</span>
            </span>
            <input
              type="number"
              min={20}
              max={2000}
              step={50}
              value={chunkDraft}
              onChange={(e) => setChunkDraft(e.target.value)}
              onBlur={commitChunk}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitChunk()
                }
              }}
            />
          </label>
          <ToolCardsDefaultOpenEditor
            value={settings.toolCardsDefaultOpen}
            onUpdate={(next) => onChange({ ...settings, toolCardsDefaultOpen: next })}
          />
          <label className="settings-row">
            <span className="settings-label">{t('settings.defaultPermissionMode')}</span>
            <select
              value={settings.defaultPermissionMode}
              onChange={(e) =>
                onChange({
                  ...settings,
                  defaultPermissionMode: e.target.value as PermissionModeSetting
                })
              }
            >
              {PERMISSION_MODE_VALUES.map((m) => (
                <option key={m} value={m}>
                  {t(`usage.mode.${m}.hint`)} — {m}
                </option>
              ))}
            </select>
          </label>
          <p className="settings-hint">{t('settings.defaultPermissionModeHint')}</p>
          {web && (
            <>
              <hr className="settings-divider" />
              <h3 className="settings-section-title">{t('settings.web.title')}</h3>
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
              {web.enabled && (
                <>
                  <div className="settings-row">
                    <span className="settings-label">
                      {t('settings.web.password')}{' '}
                      {hasPassword
                        ? t('settings.web.passwordSet')
                        : t('settings.web.passwordUnset')}
                    </span>
                    <input
                      type="password"
                      value={pwDraft}
                      onChange={(e) => setPwDraft(e.target.value)}
                      placeholder={t('settings.web.passwordPlaceholder')}
                      autoComplete="new-password"
                    />
                    <input
                      type="password"
                      value={pwConfirm}
                      onChange={(e) => setPwConfirm(e.target.value)}
                      placeholder={t('settings.web.passwordConfirm')}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="settings-tls-btn"
                      onClick={submitPassword}
                      disabled={!pwDraft || !pwConfirm}
                    >
                      {hasPassword
                        ? t('settings.web.passwordSubmitChange')
                        : t('settings.web.passwordSubmitSet')}
                    </button>
                    {pwMessage && <p className="settings-hint">{pwMessage}</p>}
                  </div>
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
            </>
          )}
          {devAvailable && (
            <>
              <hr className="settings-divider" />
              <h3 className="settings-section-title">개발</h3>
              <div className="settings-row">
                <span className="settings-label">dev 재시작</span>
                <button
                  type="button"
                  className="settings-tls-btn"
                  onClick={() => {
                    void window.api.dev.restart().catch((err) => {
                      console.error('dev restart failed:', err)
                    })
                  }}
                >
                  실행
                </button>
              </div>
              <p className="settings-hint">
                기존 electron · vite · 자식 프로세스 정리 후 새 PowerShell 창에서
                npm run dev 재시작. 현재 인스턴스에 맞춰 -Test 자동 토글
                (HONGTAIL_TEST=1 → -Test).
              </p>
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
