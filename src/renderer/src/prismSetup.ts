// Must be imported before any `prismjs/components/*` so that the IIFEs
// can find `Prism` on globalThis and extend the same shared instance.
import { Prism } from 'prism-react-renderer'
import type { Language } from 'prism-react-renderer'

;(globalThis as unknown as { Prism: typeof Prism }).Prism = Prism

// prism-react-renderer 의 <Highlight> 는 등록되지 않은 language 를 받으면
// tokenize(text, undefined) 를 호출하면서 grammar.rest 접근으로 throw 한다.
// ErrorBoundary 가 없으면 React 트리 전체가 unmount 돼서 화면이 통째로 검게
// 비는 사고가 난다 (예: ```pwsh 같은 alias 가 prism 에 없을 때). 모든 호출
// 직전에 이 함수로 감싸 미등록 언어는 'markup' (plain) 로 폴백.
export function safeLanguage(lang: Language | string | null | undefined): Language {
  if (!lang) return 'markup'
  const key = String(lang).toLowerCase()
  // Prism.languages 의 entry 는 grammar object 이거나 helper function — 둘 다
  // truthy. helper (extend, insertBefore, DFS) 는 lang 키로 안 들어옴.
  return (Prism.languages as Record<string, unknown>)[key] ? (key as Language) : 'markup'
}

// 어떤 (code, lang) 조합은 prism 의 grammar 가 특정 입력에서 throw 한다 (관측:
// matchGrammar → currentNode.value.length undefined). PrismBoundary 가 React
// 트리 unmount 는 막지만, React 는 boundary 가 catch 한 에러도 무조건 console
// 에 logging 한다 — 콘솔이 시끄럽고 user 입장에서 "뻗었다" 처럼 보임. Highlight
// 가 사용하는 동일한 Prism 인스턴스로 미리 tokenize 를 시도해서 throw 면 false
// 를 리턴 — 호출처에서 plain text fallback 으로 분기시켜 throw 자체를 회피.
export function canTokenize(code: string, lang: Language): boolean {
  if (typeof code !== 'string') return false
  const grammar = (Prism.languages as Record<string, unknown>)[lang]
  if (!grammar || typeof grammar !== 'object') return false
  try {
    Prism.tokenize(code, grammar as never)
    return true
  } catch {
    return false
  }
}
