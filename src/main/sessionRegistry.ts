// 활성 세션 (app / terminal / interactive 모두) 의 메타 등록 + 변경 알림.
// 서로 다른 client (Electron BrowserWindow + 외부 web) 가 같은 main 의 세션
// 목록을 같이 보도록, 시작/종료 시 broadcast 한다.
//
// 채널:
//   session:started  payload = ActiveSessionMeta
//   session:ended    payload = { sessionId }
//
// 새 client 가 떠올 때 listActive RPC 로 현재 상태 한 번 받아간 뒤 채널을
// 구독하면 일관된 view 가 됨.
import { broadcast } from './dispatch'

export type SessionBackend = 'app' | 'terminal' | 'interactive'
export type SessionMode = 'new' | 'resume-full' | 'resume-summary' | 'resume'

export interface ActiveSessionMeta {
  sessionId: string
  workspacePath: string
  backend: SessionBackend
  mode: SessionMode
}

const active = new Map<string, ActiveSessionMeta>()

export function announceStart(meta: ActiveSessionMeta): void {
  active.set(meta.sessionId, meta)
  broadcast('session:started', meta)
}

export function announceEnd(sessionId: string): void {
  if (!active.delete(sessionId)) return
  broadcast('session:ended', { sessionId })
}

export function listActive(): ActiveSessionMeta[] {
  return Array.from(active.values())
}
