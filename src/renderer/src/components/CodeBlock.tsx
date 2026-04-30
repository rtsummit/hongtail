import { canTokenize, safeLanguage } from '../prismSetup'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-diff'
import 'prismjs/components/prism-ini'
import 'prismjs/components/prism-java'
import 'prismjs/components/prism-kotlin'
import 'prismjs/components/prism-markdown'
import 'prismjs/components/prism-powershell'
import 'prismjs/components/prism-ruby'
import 'prismjs/components/prism-rust'
import 'prismjs/components/prism-toml'
import 'prismjs/components/prism-yaml'
import { Highlight, themes } from 'prism-react-renderer'
import type { Language } from 'prism-react-renderer'
import { PrismBoundary } from './PrismBoundary'

const theme = themes.vsDark

interface CodeProps {
  code: string
  language: Language | null
}

// Renders tokenized lines as <div class="token-line"> children. Caller wraps with <pre>.
export function CodeLines({ code, language }: CodeProps): React.JSX.Element {
  const lang = safeLanguage(language)
  if (!canTokenize(code, lang)) return <>{code}</>
  return (
    <PrismBoundary fallback={<>{code}</>}>
      <Highlight code={code} language={lang} theme={theme}>
        {({ tokens, getLineProps, getTokenProps }) => (
          <>
            {tokens.map((line, i) => (
              <div key={i} {...getLineProps({ line })}>
                {line.length === 0 ? (
                  <span> </span>
                ) : (
                  line.map((token, j) => <span key={j} {...getTokenProps({ token })} />)
                )}
              </div>
            ))}
          </>
        )}
      </Highlight>
    </PrismBoundary>
  )
}

// Renders inline highlighted spans for a single line. No line wrapping.
export function HighlightedLine({ code, language }: CodeProps): React.JSX.Element {
  const lang = safeLanguage(language)
  if (!canTokenize(code, lang)) return <>{code}</>
  return (
    <PrismBoundary fallback={<>{code}</>}>
      <Highlight code={code} language={lang} theme={theme}>
        {({ tokens, getTokenProps }) => (
          <>
            {tokens[0]?.map((token, j) => (
              <span key={j} {...getTokenProps({ token })} />
            ))}
          </>
        )}
      </Highlight>
    </PrismBoundary>
  )
}
