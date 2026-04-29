import { Component, type ReactNode } from 'react'

interface Props {
  fallback: ReactNode
  children: ReactNode
}

interface State {
  failed: boolean
}

// prism-react-renderer 의 <Highlight> 는 prism-powershell 등 일부 언어 토크나이저
// 가 특정 입력에서 throw 하면 React 트리 전체를 unmount 시켜 화면이 완전히 검게
// 비는 사고가 난다 (관측 사례: matchGrammar → currentNode.value.length 에서
// undefined 접근). 한 셀의 syntax highlight 가 깨지더라도 plain text 로
// 폴백해서 페이지가 살아있게 격리한다.
export class PrismBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: unknown): void {
    console.warn('[PrismBoundary] highlight failed, falling back to plain text:', error)
  }

  render(): ReactNode {
    if (this.state.failed) return this.props.fallback
    return this.props.children
  }
}
