import { homedir } from 'os'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { registerInvoke } from './ipc'

const SAFE_SESSION_ID = /^[A-Za-z0-9._-]+$/

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg'
}

function imageDir(sessionId: string): string {
  return join(homedir(), '.claude', 'image-cache', sessionId)
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

export async function saveImage(
  sessionId: string,
  bytes: Uint8Array,
  mimeType: string
): Promise<string> {
  if (!SAFE_SESSION_ID.test(sessionId)) {
    throw new Error('invalid session id')
  }
  const ext = EXT_BY_MIME[mimeType.toLowerCase()] ?? 'png'
  const dir = imageDir(sessionId)
  await fsp.mkdir(dir, { recursive: true })
  const filePath = join(dir, `${nowStamp()}.${ext}`)
  await fsp.writeFile(filePath, bytes)
  return filePath
}

export function registerImageHandlers(): void {
  // bytes 는 Electron IPC 면 Uint8Array, web 이면 base64 문자열로 들어올 수
  // 있다 (JSON 으로 바이너리 못 보냄). 후자면 디코드.
  registerInvoke(
    'images:save',
    (sessionId: unknown, bytes: unknown, mimeType: unknown) => {
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
      return saveImage(String(sessionId), buf, String(mimeType))
    }
  )
}
