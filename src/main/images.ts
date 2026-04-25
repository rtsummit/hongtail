import { ipcMain } from 'electron'
import { homedir } from 'os'
import { promises as fsp } from 'fs'
import { join } from 'path'

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
  ipcMain.handle(
    'images:save',
    async (_e, sessionId: string, bytes: Uint8Array, mimeType: string) => {
      return await saveImage(sessionId, bytes, mimeType)
    }
  )
}
