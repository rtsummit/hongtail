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
