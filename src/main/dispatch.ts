// 모든 BrowserWindow 의 webContents 와 web SSE 구독자에게 같은 이벤트를
// forward 하는 helper. 기존 webContents.send(channel, event) 호출처를 이걸로
// 바꾸면 web 클라이언트가 별도 처리 없이 같은 채널을 SSE 로 받을 수 있다.
import { BrowserWindow } from 'electron'
import { emitSse } from './web'

export function broadcast(channel: string, event?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send(channel, event)
  }
  emitSse(channel, event)
}
