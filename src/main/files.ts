import { homedir } from 'os'
import { promises as fsp } from 'fs'
import { extname, join } from 'path'
import { ipcMain, shell } from 'electron'
import { registerInvoke } from './ipc'

// 이미지 외 일반 파일 첨부 저장. claude 는 절대 경로를 받아서 Read tool 로
// 읽으면 되므로 파일 본문에 대한 mime 검증은 안 한다. 단 sessionId 와
// 사용자 fileName 은 sanitize.
const SAFE_SESSION_ID = /^[A-Za-z0-9._-]+$/

function fileDir(sessionId: string): string {
  return join(homedir(), '.claude', 'file-cache', sessionId)
}

function nowStamp(): string {
  const d = new Date()
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}` +
    `-${pad(d.getMilliseconds(), 3)}`
  )
}

// 사용자 파일 이름에서 path traversal·OS 예약 문자 제거. 확장자는 보존해서
// claude 가 파일 종류를 추측할 수 있게.
function sanitizeName(raw: string): string {
  const cleaned = raw
    .replace(/[\\/]/g, '_')
    .replace(/[<>:"|?*\x00-\x1f]/g, '_')
    .trim()
  // 빈 이름 fallback
  if (!cleaned) return 'file'
  // 길이 제한 — Windows path 260 한계 안에 들어가도록 보수적으로
  if (cleaned.length > 80) {
    const ext = extname(cleaned)
    const base = cleaned.slice(0, 80 - ext.length)
    return base + ext
  }
  return cleaned
}

export async function saveFile(
  sessionId: string,
  bytes: Uint8Array,
  fileName: string
): Promise<string> {
  if (!SAFE_SESSION_ID.test(sessionId)) {
    throw new Error('invalid session id')
  }
  const safe = sanitizeName(fileName)
  const dir = fileDir(sessionId)
  await fsp.mkdir(dir, { recursive: true })
  // timestamp prefix 로 같은 이름 충돌 방지 + chronological 정렬.
  const filePath = join(dir, `${nowStamp()}-${safe}`)
  await fsp.writeFile(filePath, bytes)
  return filePath
}

export function registerFileHandlers(): void {
  // bytes 는 Electron IPC 면 Uint8Array, web 이면 base64 문자열로 들어올 수
  // 있다 (JSON 으로 바이너리 못 보냄). images.ts 와 동일 패턴.
  registerInvoke(
    'files:save',
    (sessionId: unknown, bytes: unknown, fileName: unknown) => {
      let buf: Uint8Array
      if (bytes instanceof Uint8Array) {
        buf = bytes
      } else if (typeof bytes === 'string') {
        buf = Buffer.from(bytes, 'base64')
      } else if (Array.isArray(bytes)) {
        buf = Uint8Array.from(bytes as number[])
      } else {
        throw new Error('unsupported bytes payload')
      }
      return saveFile(String(sessionId), buf, String(fileName))
    }
  )

  // 외부 앱으로 열기 — host PC 의 OS default app 에 위임. Electron 에서만
  // 의미 있어서 ipcMain.handle 로만 등록 (registerInvoke 사용 안 함).
  // 이유: web RPC 로 노출하면 web 사용자가 host PC 의 OS 에서 임의 파일을
  // 열게 되는데, 사용자는 그 결과를 자기 화면에서 볼 수 없어 무의미·혼란.
  // web 측은 fallback 으로 files:read 텍스트를 받아 hongtail 모달에 표시.
  ipcMain.handle('files:open-external', async (_e, p: unknown) => {
    if (typeof p !== 'string' || !p) throw new Error('path required')
    const err = await shell.openPath(p)
    if (err) throw new Error(err)
  })

  // 텍스트 read — Electron / web 공통. web 모드에서 모달 fallback 용.
  registerInvoke('files:read', async (p: unknown) => {
    if (typeof p !== 'string' || !p) throw new Error('path required')
    return fsp.readFile(p, 'utf-8')
  })
}
