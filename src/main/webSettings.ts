// 웹 모드 설정. app.getPath('userData')/web-settings.json 에 저장.
// 환경변수 (HONGLUADE_WEB, HONGLUADE_WEB_PORT, HONGLUADE_WEB_HOST,
// HONGLUADE_WEB_TLS_CERT, HONGLUADE_WEB_TLS_KEY) 는 같은 키가 있으면 file
// 보다 우선. 운영자가 강제 설정하고 싶을 때 사용.
import { promises as fs } from 'fs'
import { join } from 'path'
import { app } from 'electron'

export interface WebSettings {
  enabled: boolean
  port: number
  tlsCertPath: string | null
  tlsKeyPath: string | null
}

// host 는 무조건 0.0.0.0 — 같은 PC / LAN / 외부 모두에서 접근 가능. 단일
// 토큰/비밀번호 인증이 있으므로 binding 자체는 wide open 으로.
export const WEB_HOST = '0.0.0.0'

const DEFAULT_SETTINGS: WebSettings = {
  enabled: false,
  port: 9879,
  tlsCertPath: null,
  tlsKeyPath: null
}

function settingsFile(): string {
  return join(app.getPath('userData'), 'web-settings.json')
}

function normalize(parsed: Partial<WebSettings>): WebSettings {
  const port = Number(parsed.port)
  return {
    enabled: !!parsed.enabled,
    port: Number.isFinite(port) && port > 0 && port < 65536 ? port : DEFAULT_SETTINGS.port,
    tlsCertPath:
      typeof parsed.tlsCertPath === 'string' && parsed.tlsCertPath.trim()
        ? parsed.tlsCertPath.trim()
        : null,
    tlsKeyPath:
      typeof parsed.tlsKeyPath === 'string' && parsed.tlsKeyPath.trim()
        ? parsed.tlsKeyPath.trim()
        : null
  }
}

export async function loadWebSettings(): Promise<WebSettings> {
  try {
    const raw = await fs.readFile(settingsFile(), 'utf-8')
    return normalize(JSON.parse(raw) as Partial<WebSettings>)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export async function saveWebSettings(next: WebSettings): Promise<void> {
  await fs.writeFile(settingsFile(), JSON.stringify(normalize(next), null, 2), 'utf-8')
}

// env 우선 적용. file 의 settings 위에 env 값을 덮어씀. 운영자가 명시 강제할
// 때만 사용 — 일반 사용자는 GUI 의 설정만 만져야 함.
export function applyEnvOverrides(s: WebSettings): WebSettings {
  const out = { ...s }
  if (process.env.HONGLUADE_WEB === '1') out.enabled = true
  if (process.env.HONGLUADE_WEB === '0') out.enabled = false
  const portEnv = Number(process.env.HONGLUADE_WEB_PORT)
  if (Number.isFinite(portEnv) && portEnv > 0 && portEnv < 65536) out.port = portEnv
  if (process.env.HONGLUADE_WEB_TLS_CERT) out.tlsCertPath = process.env.HONGLUADE_WEB_TLS_CERT
  if (process.env.HONGLUADE_WEB_TLS_KEY) out.tlsKeyPath = process.env.HONGLUADE_WEB_TLS_KEY
  return out
}
