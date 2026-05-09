/* eslint-disable react-refresh/only-export-components */
import { Highlight, themes } from 'prism-react-renderer'
import { canTokenize, safeLanguage } from './prismSetup'
import { PrismBoundary } from './components/PrismBoundary'

interface CodeProps {
  className?: string
  children?: React.ReactNode
}

function MarkdownCode({ className, children, ...rest }: CodeProps): React.JSX.Element {
  const match = /language-([\w+#-]+)/.exec(className ?? '')
  if (!match?.[1]) {
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    )
  }
  const lang = safeLanguage(match[1])
  const code = String(children).replace(/\n$/, '')
  if (!canTokenize(code, lang)) return <code className={className}>{code}</code>
  return (
    <PrismBoundary fallback={<code className={className}>{code}</code>}>
      <Highlight code={code} language={lang} theme={themes.vsDark}>
        {({ tokens, getLineProps, getTokenProps }) => (
          <code className={className}>
            {tokens.map((line, i) => (
              <div key={i} {...getLineProps({ line })}>
                {line.length === 0 ? (
                  <span> </span>
                ) : (
                  line.map((token, j) => <span key={j} {...getTokenProps({ token })} />)
                )}
              </div>
            ))}
          </code>
        )}
      </Highlight>
    </PrismBoundary>
  )
}

interface AnchorProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  children?: React.ReactNode
}

// http(s) 링크는 항상 외부 브라우저로. Electron 메인은 setWindowOpenHandler 가
// target=_blank 를 가로채 shell.openExternal 로 보내고, web 모드는 새 탭에서
// 정상으로 열린다. 상대 경로·앵커 등은 그대로 둔다 (기본 동작).
function MarkdownLink({ href, children, ...rest }: AnchorProps): React.JSX.Element {
  const isExternal = typeof href === 'string' && /^https?:\/\//i.test(href)
  if (isExternal) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    )
  }
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}

export const markdownComponents = {
  code: MarkdownCode,
  a: MarkdownLink
}

// react-markdown v10 의 기본 urlTransform 은 data:image/svg+xml 을 차단해서
// assistant 가 인라인 SVG 시안 같은 걸 못 띄움. img-src CSP 는 이미 'self' data:
// 로 좁혀 있으니, javascript:/vbscript: 만 막고 나머지는 그대로 통과시킨다.
export function markdownUrlTransform(url: string): string | undefined {
  const t = url.trim().toLowerCase()
  if (t.startsWith('javascript:') || t.startsWith('vbscript:')) return undefined
  return url
}
