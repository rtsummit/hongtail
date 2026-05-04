// 라이브 세션의 system/init·result.modelUsage 에서 본 model→contextWindow 매핑을
// localStorage 에 캐싱. readonly 모드는 jsonl 에 system/init·result 가 없고
// assistant.message.model 은 suffix 없는 bare ID (e.g. `claude-opus-4-7`) 만 들어있어
// parseContextWindowFromModel 이 항상 undefined → ctxPercent 못 계산. 라이브로 같은
// 모델을 한 번이라도 본 적 있으면 cache hit 으로 채워줌.

const KEY = 'hongtail:contextWindowByModel'

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
