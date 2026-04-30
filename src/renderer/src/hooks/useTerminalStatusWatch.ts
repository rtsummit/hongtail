import { useEffect } from 'react'
import type { ActiveEntry } from '../rpcBridge'

// 'terminal' 백엔드 라이브 세션의 jsonl 을 tail 해서 sidebar 의 thinking dot /
// model 라벨 같은 status 만 추출한다. messages append 는 안 함 — terminal 은
// xterm raw 가 본체이므로 chat block 으로 그릴 게 없다. 'app' 백엔드는
// stream-json IPC 가 본체라 별도 watch 불필요. readonly·resume 후 신선한
// 이벤트만 보기 위해 init 단계는 마지막 라인 1개로 offset 만 잡는다.
export function useTerminalStatusWatch(
  active: Record<string, ActiveEntry>,
  handleClaudeEvent: (sessionId: string, event: unknown, opts?: { appendMessages?: boolean }) => void
): void {
  useEffect(() => {
    const cleanups: Array<() => void> = []
    for (const [sessionId, a] of Object.entries(active)) {
      if (a.backend !== 'terminal') continue
      const wsPath = a.workspacePath
      let offset = 0
      let cancelled = false

      const init = async (): Promise<void> => {
        try {
          const tail = await window.api.claude.readSessionTail(wsPath, sessionId, 1)
          if (cancelled) return
          offset = tail.newOffset
          for (const event of tail.events) {
            handleClaudeEvent(sessionId, event, { appendMessages: false })
          }
        } catch (err) {
          console.error('terminal jsonl init failed:', err)
        }
      }

      void init()
      void window.api.claude.watchSession(wsPath, sessionId)
      const unsub = window.api.claude.onSessionChanged(sessionId, () => {
        void window.api.claude.readSessionFrom(wsPath, sessionId, offset).then(
          ({ events, newOffset, truncated }) => {
            if (cancelled) return
            offset = newOffset
            if (truncated) return
            for (const event of events) {
              handleClaudeEvent(sessionId, event, { appendMessages: false })
            }
          }
        )
      })

      cleanups.push(() => {
        cancelled = true
        unsub()
        void window.api.claude.unwatchSession(sessionId)
      })
    }
    return () => {
      for (const c of cleanups) c()
    }
  }, [active, handleClaudeEvent])
}
