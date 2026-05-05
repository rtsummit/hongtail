// 라이브 세션의 system/init·result.modelUsage 에서 본 model→contextWindow 매핑을
// localStorage 에 캐싱. readonly 모드는 jsonl 에 system/init·result 가 없고
// assistant.message.model 은 suffix 없는 bare ID (e.g. `claude-opus-4-7`) 만 들어있어
// parseContextWindowFromModel 이 항상 undefined → ctxPercent 못 계산. 라이브로 같은
// 모델을 한 번이라도 본 적 있으면 cache hit 으로 채워줌.
//
// 추가로 "마지막에 본 라이브 모델" 도 같이 추적 — claude -p 는 첫 turn 직전까지
// system/init 을 안 emit 해서 새 세션 spawn 직후엔 status.model/contextWindow 가
// 비어있다. 첫 메시지 전에도 Context 0% 를 보여주려고 라이브 새 세션에서 seed
// 용으로 사용.

const KEY = 'hongtail:contextWindowByModel'
const LAST_MODEL_KEY = 'hongtail:lastLiveModel'

type Map = Record<string, number>

function read(): Map {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Map) : {}
  } catch {
    return {}
  }
}

export function getCachedContextWindow(model: string): number | undefined {
  if (!model) return undefined
  const map = read()
  return map[model]
}

export function cacheContextWindow(model: string, contextWindow: number): void {
  if (!model || !contextWindow) return
  try {
    const map = read()
    if (map[model] === contextWindow) return
    map[model] = contextWindow
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    // ignore quota / serialization failures
  }
}

export function stripModelSuffix(model: string): string {
  return model.replace(/\[\d+[mk]\]$/i, '')
}

export function getLastLiveModel(): string | undefined {
  try {
    const v = localStorage.getItem(LAST_MODEL_KEY)
    return v && typeof v === 'string' ? v : undefined
  } catch {
    return undefined
  }
}

export function setLastLiveModel(model: string): void {
  if (!model) return
  try {
    localStorage.setItem(LAST_MODEL_KEY, model)
  } catch {
    // ignore
  }
}
