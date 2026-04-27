// Electron IPC 와 web RPC 양쪽에 같은 핸들러를 노출하는 helper.
// event 객체 (event.sender, event.frame 등) 가 필요 없는 단순한 invoke 류는
// 이걸 통해 한 번에 등록한다. event 가 필요한 핸들러는 직접 ipcMain.handle
// 사용 + 필요 시 web 측은 별도 처리.
import { ipcMain } from 'electron'
import { registerRpc } from './web'

type AnyHandler = (...args: unknown[]) => unknown | Promise<unknown>

export function registerInvoke(channel: string, handler: AnyHandler): void {
  ipcMain.handle(channel, async (_event, ...args) => handler(...args))
  registerRpc(channel, async (args) => handler(...args))
}
