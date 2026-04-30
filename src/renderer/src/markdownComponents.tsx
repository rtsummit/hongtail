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

export const markdownComponents = {
  code: MarkdownCode
}
