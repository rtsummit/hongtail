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
  host: string
  tlsCertPath: string | null
  tlsKeyPath: string | null
}

const DEFAULT_SETTINGS: WebSettings = {
  enabled: false,
  port: 9879,
  host: '127.0.0.1',
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
    host:
      typeof parsed.host === 'string' && parsed.host.trim()
        ? parsed.host.trim()
        : DEFAULT_SETTINGS.host,
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

// env 우선 적용. file 의 settings 위에 env 값을 덮어씀.
export function applyEnvOverrides(s: WebSettings): WebSettings {
  const out = { ...s }
  if (process.env.HONGLUADE_WEB === '1') out.enabled = true
  if (process.env.HONGLUADE_WEB === '0') out.enabled = false
  const portEnv = Number(process.env.HONGLUADE_WEB_PORT)
  if (Number.isFinite(portEnv) && portEnv > 0 && portEnv < 65536) out.port = portEnv
  if (process.env.HONGLUADE_WEB_HOST) out.host = process.env.HONGLUADE_WEB_HOST
  if (process.env.HONGLUADE_WEB_TLS_CERT) out.tlsCertPath = process.env.HONGLUADE_WEB_TLS_CERT
  if (process.env.HONGLUADE_WEB_TLS_KEY) out.tlsKeyPath = process.env.HONGLUADE_WEB_TLS_KEY
  return out
}
