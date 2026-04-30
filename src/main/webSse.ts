// Web 모드 SSE 푸시 채널. emit 측 (dispatch.broadcast) 과 수신 측 (GET /events
// 핸들러) 양쪽이 같은 sseBus 에 lazy 로 추가된다 — 어느 쪽이 먼저 들어오든 무관.
//
// 첫 subscriber 가 EventSource connection 을 여는 데 한두 RTT 필요한데, 그
// 사이 emit 된 이벤트가 손실되면 클라이언트가 첫 신호를 놓쳐 hang 한다 (예:
// PTY spawn 직후 첫 data 가 spinner 를 풀어주는데 그게 누락). 해결: subscriber
// 가 0 일 때 emit 은 ring buffer 에 쌓아두고, 첫 subscriber 가 붙는 순간 flush.
import type { IncomingMessage, ServerResponse } from 'http'

type EventEmit = (event: unknown) => void

const sseBus = new Map<string, Set<EventEmit>>()
const sseBuffer = new Map<string, unknown[]>()
const SSE_BUFFER_LIMIT = 1000

function busSet(topic: string): Set<EventEmit> {
  let set = sseBus.get(topic)
  if (!set) {
    set = new Set()
    sseBus.set(topic, set)
  }
  return set
}

export function emitSse(topic: string, event: unknown): void {
  const set = busSet(topic)
  if (set.size > 0) {
    // emit 이 throw (예: res.destroyed 직후 write → ERR_STREAM_DESTROYED, 또는
    // event 가 circular 라 JSON.stringify throw) 하면 그 stale emitter 를 set
    // 에서 제거하고 다음 emitter 로 계속. 보호 안 하면 한 client 의 socket 절단
    // 이 모든 후속 broadcast 를 stuck 시켜 전 세션 hang 을 유발 (관측 사례).
    for (const emit of set) {
      try {
        emit(event)
      } catch (err) {
        console.warn('[web] sse emit failed — dropping subscriber:', err)
        set.delete(emit)
      }
    }
    return
  }
  let buf = sseBuffer.get(topic)
  if (!buf) {
    buf = []
    sseBuffer.set(topic, buf)
  }
  buf.push(event)
  if (buf.length > SSE_BUFFER_LIMIT) buf.shift()
}

function attachSseEmitter(topic: string, emit: EventEmit): () => void {
  const set = busSet(topic)
  // 첫 connection 시 buffered 부터 flush. 한 이벤트가 throw 해도 나머지를
  // 계속 시도 — 첫 client 가 일부만 받더라도 페이지 자체는 살아있게.
  const buffered = sseBuffer.get(topic)
  if (buffered) {
    for (const e of buffered) {
      try {
        emit(e)
      } catch (err) {
        console.warn('[web] sse buffered flush failed:', err)
      }
    }
    sseBuffer.delete(topic)
  }
  set.add(emit)
  return () => set.delete(emit)
}

export function handleSseEvents(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://x')
  const topic = url.searchParams.get('topic')
  if (!topic) {
    res.statusCode = 400
    res.end('topic required')
    return
  }
  // 모든 topic 은 동적. emit 측이 아직 호출되지 않은 topic 도 OK — 빈 set 에
  // emitter 추가해두고 emit 되면 forward.
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()
  res.write(': ok\n\n')
  const emit: EventEmit = (event) => {
    // socket 이 끝났거나 destroyed 면 write 가 throw 한다 (ERR_STREAM_DESTROYED).
    // 일반 backpressure 는 false 리턴이라 OK. 호출자 (emitSse) 의 try/catch 가
    // stale emitter 를 set 에서 제거할 수 있게 throw 는 그대로 propagate.
    if (res.writableEnded || res.destroyed) return
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }
  const detach = attachSseEmitter(topic, emit)
  req.on('close', () => {
    try {
      detach()
    } catch (err) {
      console.error('[web] detach failed:', err)
    }
  })
}
