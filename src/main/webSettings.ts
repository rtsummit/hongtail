// 웹 모드 설정. app.getPath('userData')/web-settings.json 에 저장.
// 환경변수 (HONGTAIL_WEB, HONGTAIL_WEB_PORT, HONGTAIL_WEB_HOST,
// HONGTAIL_WEB_TLS_CERT, HONGTAIL_WEB_TLS_KEY) 는 같은 키가 있으면 file
// 보다 우선. 운영자가 강제 설정하고 싶을 때 사용.
import { join } from 'path'
import { app } from 'electron'
import { readJsonFile, writeJsonFile } from './jsonFile'

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
  // fallthrough: ENOENT 외 parse 실패도 디폴트로 흡수 — 손상된 파일이 앱 부팅을
  // 막지 않게.
  const parsed = await readJsonFile<WebSettings>(settingsFile(), { ...DEFAULT_SETTINGS }, {
    fallthrough: true
  })
  return normalize(parsed as Partial<WebSettings>)
}

export async function saveWebSettings(next: WebSettings): Promise<void> {
  await writeJsonFile(settingsFile(), normalize(next))
}
