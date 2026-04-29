import { useContext, useMemo, useState } from 'react'
import { diffLines } from 'diff'
import { Highlight, themes } from 'prism-react-renderer'
import type { Language } from 'prism-react-renderer'
import { ToolDefaultOpenContext } from '../toolContext'
import { detectLanguage } from '../langDetect'
import { HighlightedLine } from './CodeBlock'
import type { Block } from '../types'

type ToolUseBlock = Extract<Block, { kind: 'tool-use' }>
type ToolResultBlock = Extract<Block, { kind: 'tool-result' }>

interface Props {
  use: ToolUseBlock
  result?: ToolResultBlock
}

interface BashInput {
  command?: string
  description?: string
}
interface ReadInput {
  file_path?: string
  offset?: number
  limit?: number
}
interface EditInput {
  file_path?: string
  old_string?: string
  new_string?: string
  replace_all?: boolean
}
interface WriteInput {
  file_path?: string
  content?: string
}
interface GrepInput {
  pattern?: string
  path?: string
  glob?: string
  '-i'?: boolean
}
interface GlobInput {
  pattern?: string
  path?: string
}
interface TodoItem {
  content?: string
  status?: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
}
interface TodoWriteInput {
  todos?: TodoItem[]
}

function shortenPath(p: string): string {
  if (!p) return ''
  const segs = p.replace(/[\\/]+$/, '').split(/[\\/]/)
  if (segs.length <= 2) return p
  return segs.slice(-2).join('/')
}

function oneLine(s: string, max = 80): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

function resultText(result?: ToolResultBlock): string {
  if (!result) return ''
  const c = result.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return c
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'text' in item) {
          return String((item as { text: unknown }).text ?? '')
        }
        return JSON.stringify(item)
      })
      .join('\n')
  }
  if (c == null) return ''
  try {
    return JSON.stringify(c, null, 2)
  } catch {
    return String(c)
  }
}

function countLines(s: string): number {
  if (!s) return 0
  let n = 1
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++
  return n
}

interface RowProps {
  toolClass: string
  name: string
  args?: string
  argsTitle?: string
  summary?: string
  isError?: boolean
  body?: React.ReactNode
  defaultOpen?: boolean
}

function ToolRow({
  toolClass,
  name,
  args,
  argsTitle,
  summary,
  isError,
  body,
  defaultOpen
}: RowProps): React.JSX.Element {
  const ctxDefaultOpen = useContext(ToolDefaultOpenContext)
  const open = defaultOpen ?? ctxDefaultOpen.has(name)
  const hasBody = body != null
  const cls = `tool-block ${toolClass}${isError ? ' error' : ''}`
  if (hasBody) {
    return (
      <details className={cls} open={open}>
        <summary className="tool-row">
          <span className="tool-row-bullet">●</span>
          <span className="tool-row-name">{name}</span>
          {args ? (
            <span className="tool-row-args" title={argsTitle ?? args}>
              ({args})
            </span>
          ) : null}
          {summary ? <span className="tool-row-summary">⎿ {summary}</span> : null}
        </summary>
        <div className="tool-row-body">{body}</div>
      </details>
    )
  }
  return (
    <div className={cls}>
      <div className="tool-row no-toggle">
        <span className="tool-row-bullet">●</span>
        <span className="tool-row-name">{name}</span>
        {args ? (
          <span className="tool-row-args" title={argsTitle ?? args}>
            ({args})
          </span>
        ) : null}
        {summary ? <span className="tool-row-summary">⎿ {summary}</span> : null}
      </div>
    </div>
  )
}

function BashCard({ input, result }: { input: BashInput; result?: ToolResultBlock }): React.JSX.Element {
  const text = resultText(result)
  const lines = text ? countLines(text) : 0
  const cmd = input.command ?? ''
  const args = oneLine(cmd, 100) || (input.description ?? '')
  const summary = result?.isError
    ? '오류'
    : result
      ? lines === 0
        ? '출력 없음'
        : `출력 ${lines} 줄`
      : undefined
  const body = (
    <>
      {cmd && <HighlightedCode code={cmd} language="bash" className="tool-cmd" />}
      {result && text && <pre className="tool-out-text">{text}</pre>}
    </>
  )
  return (
    <ToolRow
      toolClass="bash"
      name="Bash"
      args={args}
      argsTitle={cmd}
      summary={summary}
      isError={result?.isError}
      body={body}
    />
  )
}

interface NumberedLine {
  num: string
  code: string
}

function parseCatN(text: string): NumberedLine[] {
  const raw = text.split('\n')
  // Drop a single trailing empty line caused by a terminating newline.
  if (raw.length > 0 && raw[raw.length - 1] === '') raw.pop()
  return raw.map((line) => {
    const m = /^(\s*\d+)\t(.*)$/.exec(line)
    if (m) return { num: m[1].trim(), code: m[2] }
    return { num: '', code: line }
  })
}

function ReadCard({ input, result }: { input: ReadInput; result?: ToolResultBlock }): React.JSX.Element {
  const text = resultText(result)
  const lineCount = text ? countLines(text) : 0
  const filePath = input.file_path ?? ''
  const range = input.offset
    ? `:${input.offset}–${input.offset + (input.limit ?? lineCount) - 1}`
    : input.limit
      ? `:≤${input.limit}`
      : ''
  const args = `${shortenPath(filePath)}${range}`
  const summary = result?.isError
    ? '오류'
    : result?.isError === false || result
      ? `${lineCount} 줄 읽음`
      : undefined
  const isError = result?.isError
  const body =
    text && text.length > 0
      ? isError
        ? <pre className="tool-out-text">{text}</pre>
        : <ReadBody filePath={filePath} text={text} />
      : null
  return (
    <ToolRow
      toolClass="read"
      name="Read"
      args={args}
      argsTitle={filePath}
      summary={summary}
      isError={isError}
      body={body}
    />
  )
}

function ReadBody({ filePath, text }: { filePath: string; text: string }): React.JSX.Element {
  const language = detectLanguage(filePath)
  const lines = useMemo(() => parseCatN(text), [text])
  const code = useMemo(() => lines.map((l) => l.code).join('\n'), [lines])
  const lang: Language = language ?? 'markup'
  return (
    <pre className="tool-out-text tool-out-code">
      <Highlight code={code} language={lang} theme={themes.vsDark}>
        {({ tokens, getLineProps, getTokenProps }) => (
          <>
            {tokens.map((line, i) => {
              const lineProps = getLineProps({ line })
              return (
                <div key={i} {...lineProps} className={`code-line ${lineProps.className ?? ''}`}>
                  <span className="code-gutter">{lines[i]?.num ?? ''}</span>
                  <span className="code-content">
                    {line.length === 0 ? (
                      <span> </span>
                    ) : (
                      line.map((token, j) => <span key={j} {...getTokenProps({ token })} />)
                    )}
                  </span>
                </div>
              )
            })}
          </>
        )}
      </Highlight>
    </pre>
  )
}

type Marker = '+' | '-' | ' '
interface DiffEntry {
  marker: Marker
  text: string
  changed: boolean
}
interface DiffLine {
  marker: Marker
  text: string
}
interface SideRow {
  left: { text: string; marker: Marker } | null
  right: { text: string; marker: Marker } | null
  isGap?: boolean
}

function flattenDiffEntries(oldText: string, newText: string): DiffEntry[] {
  const parts = diffLines(oldText, newText)
  const entries: DiffEntry[] = []
  for (const p of parts) {
    const marker: Marker = p.added ? '+' : p.removed ? '-' : ' '
    const lines = p.value.split('\n')
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    for (const line of lines) {
      entries.push({ marker, text: line, changed: !!(p.added || p.removed) })
    }
  }
  return entries
}

function selectKeptIndices(entries: DiffEntry[], contextLines = 2): Set<number> {
  const keep = new Set<number>()
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].changed) {
      for (
        let k = Math.max(0, i - contextLines);
        k <= Math.min(entries.length - 1, i + contextLines);
        k++
      ) {
        keep.add(k)
      }
    }
  }
  return keep
}

function buildUnifiedDiff(oldText: string, newText: string, contextLines = 2): DiffLine[] {
  const entries = flattenDiffEntries(oldText, newText)
  const keep = selectKeptIndices(entries, contextLines)
  const out: DiffLine[] = []
  let lastIdx = -2
  for (let i = 0; i < entries.length; i++) {
    if (!keep.has(i)) continue
    if (lastIdx >= 0 && i > lastIdx + 1) {
      out.push({ marker: ' ', text: '…' })
    }
    out.push({ marker: entries[i].marker, text: entries[i].text })
    lastIdx = i
  }
  return out
}

function buildSideBySideDiff(oldText: string, newText: string, contextLines = 2): SideRow[] {
  const entries = flattenDiffEntries(oldText, newText)
  const keep = selectKeptIndices(entries, contextLines)
  const rows: SideRow[] = []
  let i = 0
  let lastIdx = -2
  const flushGap = (cur: number): void => {
    if (lastIdx >= 0 && cur > lastIdx + 1) {
      rows.push({ left: null, right: null, isGap: true })
    }
  }
  while (i < entries.length) {
    if (!keep.has(i)) {
      i++
      continue
    }
    flushGap(i)
    const e = entries[i]
    if (e.marker === ' ') {
      rows.push({
        left: { text: e.text, marker: ' ' },
        right: { text: e.text, marker: ' ' }
      })
      lastIdx = i
      i++
      continue
    }
    // Collect contiguous removed and added entries (within kept set)
    const removed: string[] = []
    const added: string[] = []
    let j = i
    while (j < entries.length && keep.has(j) && entries[j].marker === '-') {
      removed.push(entries[j].text)
      j++
    }
    while (j < entries.length && keep.has(j) && entries[j].marker === '+') {
      added.push(entries[j].text)
      j++
    }
    const max = Math.max(removed.length, added.length)
    for (let k = 0; k < max; k++) {
      rows.push({
        left: k < removed.length ? { text: removed[k], marker: '-' } : null,
        right: k < added.length ? { text: added[k], marker: '+' } : null
      })
    }
    lastIdx = j - 1
    i = j
  }
  return rows
}

type DiffMode = 'unified' | 'side'
const DIFF_MODE_KEY = 'hongtail.diffMode'

function loadDiffMode(): DiffMode {
  return localStorage.getItem(DIFF_MODE_KEY) === 'side' ? 'side' : 'unified'
}

function saveDiffMode(m: DiffMode): void {
  localStorage.setItem(DIFF_MODE_KEY, m)
}

function DiffBody({
  oldText,
  newText,
  language,
  onExpand
}: {
  oldText: string
  newText: string
  language: Language | null
  onExpand?: () => void
}): React.JSX.Element {
  const [mode, setMode] = useState<DiffMode>(() => loadDiffMode())
  const updateMode = (m: DiffMode): void => {
    setMode(m)
    saveDiffMode(m)
  }
  const unified = buildUnifiedDiff(oldText, newText)
  return (
    <div className="diff-wrap">
      <div className="diff-toolbar" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={`diff-mode-btn${mode === 'unified' ? ' active' : ''}`}
          onClick={() => updateMode('unified')}
        >
          unified
        </button>
        <button
          type="button"
          className={`diff-mode-btn${mode === 'side' ? ' active' : ''}`}
          onClick={() => updateMode('side')}
        >
          side-by-side
        </button>
        {onExpand && (
          <button
            type="button"
            className="diff-expand-btn"
            title="모달로 보기"
            onClick={onExpand}
          >
            ⤢
          </button>
        )}
      </div>
      {mode === 'side' ? (
        <SideBySideDiff oldText={oldText} newText={newText} language={language} />
      ) : (
        <pre className="tool-diff">
          {unified.map((d, i) => (
            <div
              key={i}
              className={`diff-line ${d.marker === '+' ? 'add' : d.marker === '-' ? 'del' : 'ctx'}`}
            >
              <span className="diff-marker">{d.marker}</span>
              <span className="diff-text">
                {d.text ? <HighlightedLine code={d.text} language={language} /> : ' '}
              </span>
            </div>
          ))}
        </pre>
      )}
    </div>
  )
}

function DiffModal({
  oldText,
  newText,
  language,
  title,
  onClose
}: {
  oldText: string
  newText: string
  language: Language | null
  title: string
  onClose: () => void
}): React.JSX.Element {
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal modal-wide" role="dialog" aria-label="diff">
        <header className="modal-header">
          <h2 className="modal-title-path" title={title}>
            {title}
          </h2>
          <button type="button" className="modal-close" onClick={onClose} title="닫기">
            ×
          </button>
        </header>
        <div className="modal-body diff-modal-body">
          <DiffBody oldText={oldText} newText={newText} language={language} />
        </div>
      </div>
    </div>
  )
}

function SideBySideDiff({
  oldText,
  newText,
  language
}: {
  oldText: string
  newText: string
  language: Language | null
}): React.JSX.Element {
  const rows = buildSideBySideDiff(oldText, newText)
  return (
    <div className="tool-diff side">
      {rows.map((row, i) =>
        row.isGap ? (
          <div key={i} className="diff-row gap">
            <div className="diff-cell ctx">…</div>
            <div className="diff-cell ctx">…</div>
          </div>
        ) : (
          <div key={i} className="diff-row">
            <div
              className={`diff-cell ${row.left?.marker === '-' ? 'del' : row.left ? 'ctx' : 'empty'}`}
            >
              {row.left ? (
                <>
                  <span className="diff-marker">{row.left.marker}</span>
                  <span className="diff-text">
                    {row.left.text ? (
                      <HighlightedLine code={row.left.text} language={language} />
                    ) : (
                      ' '
                    )}
                  </span>
                </>
              ) : null}
            </div>
            <div
              className={`diff-cell ${row.right?.marker === '+' ? 'add' : row.right ? 'ctx' : 'empty'}`}
            >
              {row.right ? (
                <>
                  <span className="diff-marker">{row.right.marker}</span>
                  <span className="diff-text">
                    {row.right.text ? (
                      <HighlightedLine code={row.right.text} language={language} />
                    ) : (
                      ' '
                    )}
                  </span>
                </>
              ) : null}
            </div>
          </div>
        )
      )}
    </div>
  )
}

function EditCard({ input, result }: { input: EditInput; result?: ToolResultBlock }): React.JSX.Element {
  const filePath = input.file_path ?? ''
  const args = `${shortenPath(filePath)}${input.replace_all ? ' (all)' : ''}`
  const oldText = input.old_string ?? ''
  const newText = input.new_string ?? ''
  const language = detectLanguage(filePath)
  const unified = buildUnifiedDiff(oldText, newText)
  const added = unified.filter((d) => d.marker === '+').length
  const removed = unified.filter((d) => d.marker === '-').length
  const summary = result?.isError ? '오류' : `-${removed} +${added}`
  const [modalOpen, setModalOpen] = useState(false)
  const body = (
    <>
      <DiffBody
        oldText={oldText}
        newText={newText}
        language={language}
        onExpand={() => setModalOpen(true)}
      />
      {result?.isError && <pre className="tool-out-text">{resultText(result)}</pre>}
    </>
  )
  return (
    <>
      <ToolRow
        toolClass="edit"
        name="Edit"
        args={args}
        argsTitle={filePath}
        summary={summary}
        isError={result?.isError}
        body={body}
      />
      {modalOpen && (
        <DiffModal
          oldText={oldText}
          newText={newText}
          language={language}
          title={filePath}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  )
}

function WriteCard({ input, result }: { input: WriteInput; result?: ToolResultBlock }): React.JSX.Element {
  const content = input.content ?? ''
  const lines = countLines(content)
  const filePath = input.file_path ?? ''
  const args = shortenPath(filePath)
  const summary = result?.isError ? '오류' : `${lines} 줄 작성`
  const body = content ? (
    <>
      <HighlightedCode code={content} language={detectLanguage(filePath)} className="tool-cmd" />
      {result?.isError && <pre className="tool-out-text">{resultText(result)}</pre>}
    </>
  ) : result?.isError ? (
    <pre className="tool-out-text">{resultText(result)}</pre>
  ) : null
  return (
    <ToolRow
      toolClass="write"
      name="Write"
      args={args}
      argsTitle={filePath}
      summary={summary}
      isError={result?.isError}
      body={body}
    />
  )
}

function HighlightedCode({
  code,
  language,
  className
}: {
  code: string
  language: Language | null
  className: string
}): React.JSX.Element {
  const lang: Language = language ?? 'markup'
  return (
    <pre className={className}>
      <Highlight code={code} language={lang} theme={themes.vsDark}>
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
    </pre>
  )
}

function GrepCard({ input, result }: { input: GrepInput; result?: ToolResultBlock }): React.JSX.Element {
  const text = resultText(result)
  const lines = text ? countLines(text) : 0
  const args = `${input.pattern ?? ''}${input.glob ? ` · ${input.glob}` : ''}${input.path ? ` · ${shortenPath(input.path)}` : ''}`
  const summary = result?.isError ? '오류' : text ? `${lines} 결과` : '결과 없음'
  const body = text ? (
    <pre className="tool-out-text">
      <GrepHighlightedText text={text} pattern={input.pattern} caseInsensitive={input['-i']} />
    </pre>
  ) : null
  return (
    <ToolRow
      toolClass="grep"
      name="Grep"
      args={args}
      summary={summary}
      isError={result?.isError}
      body={body}
    />
  )
}

function compileGrepRegex(pattern: string | undefined, caseInsensitive?: boolean): RegExp | null {
  if (!pattern) return null
  try {
    return new RegExp(pattern, caseInsensitive ? 'gi' : 'g')
  } catch {
    return null
  }
}

function GrepHighlightedText({
  text,
  pattern,
  caseInsensitive
}: {
  text: string
  pattern?: string
  caseInsensitive?: boolean
}): React.JSX.Element {
  const re = useMemo(() => compileGrepRegex(pattern, caseInsensitive), [pattern, caseInsensitive])
  if (!re) return <>{text}</>
  const out: React.ReactNode[] = []
  let last = 0
  let key = 0
  // matchAll does not mutate the regex; safe to reuse the memoized RegExp.
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0
    if (idx > last) out.push(text.slice(last, idx))
    if (m[0].length > 0) {
      out.push(
        <mark key={key++} className="grep-match">
          {m[0]}
        </mark>
      )
    }
    last = idx + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return <>{out}</>
}

function GlobCard({ input, result }: { input: GlobInput; result?: ToolResultBlock }): React.JSX.Element {
  const text = resultText(result)
  const fileLines = text ? text.split('\n').filter((l) => l.trim()).length : 0
  const args = `${input.pattern ?? ''}${input.path ? ` · ${shortenPath(input.path)}` : ''}`
  const summary = result?.isError ? '오류' : text ? `${fileLines} 파일` : '결과 없음'
  const body = text ? <pre className="tool-out-text">{text}</pre> : null
  return (
    <ToolRow
      toolClass="glob"
      name="Glob"
      args={args}
      summary={summary}
      isError={result?.isError}
      body={body}
    />
  )
}

function todoStatusIcon(s?: string): string {
  if (s === 'completed') return '☑'
  if (s === 'in_progress') return '◐'
  return '☐'
}

function TodoWriteCard({ input }: { input: TodoWriteInput; result?: ToolResultBlock }): React.JSX.Element {
  const todos = input.todos ?? []
  const inProgress = todos.find((t) => t.status === 'in_progress')
  const args = inProgress?.activeForm ?? inProgress?.content ?? `${todos.length} 항목`
  const done = todos.filter((t) => t.status === 'completed').length
  const summary = `${done}/${todos.length} 완료`
  const body = (
    <ul className="todo-list">
      {todos.map((t, i) => (
        <li key={i} className={`todo-item ${t.status ?? 'pending'}`}>
          <span className="todo-mark">{todoStatusIcon(t.status)}</span>
          <span className="todo-text">
            {t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}
          </span>
        </li>
      ))}
    </ul>
  )
  return (
    <ToolRow
      toolClass="todo"
      name="TodoWrite"
      args={oneLine(args, 60)}
      summary={summary}
      body={body}
    />
  )
}

function FallbackCard({ use, result }: Props): React.JSX.Element {
  const text = resultText(result)
  let argPreview = ''
  if (use.input && typeof use.input === 'object') {
    const entries = Object.entries(use.input as Record<string, unknown>)
    if (entries.length > 0) {
      const [k, v] = entries[0]
      const vs = typeof v === 'string' ? v : JSON.stringify(v)
      argPreview = `${k}=${oneLine(vs, 60)}`
    }
  }
  const summary = result?.isError ? '오류' : result ? '결과 있음' : undefined
  const inputJson = (() => {
    try {
      return JSON.stringify(use.input, null, 2)
    } catch {
      return String(use.input)
    }
  })()
  const body = (
    <>
      <HighlightedCode code={inputJson} language="json" className="tool-cmd" />
      {result && text && <pre className="tool-out-text">{text}</pre>}
    </>
  )
  return (
    <ToolRow
      toolClass="generic"
      name={use.name}
      args={argPreview}
      summary={summary}
      isError={result?.isError}
      body={body}
    />
  )
}

function ToolBlock({ use, result }: Props): React.JSX.Element {
  const input = (use.input ?? {}) as Record<string, unknown>
  switch (use.name) {
    case 'Bash':
      return <BashCard input={input as BashInput} result={result} />
    case 'Read':
      return <ReadCard input={input as ReadInput} result={result} />
    case 'Edit':
      return <EditCard input={input as EditInput} result={result} />
    case 'Write':
      return <WriteCard input={input as WriteInput} result={result} />
    case 'Grep':
      return <GrepCard input={input as GrepInput} result={result} />
    case 'Glob':
      return <GlobCard input={input as GlobInput} result={result} />
    case 'TodoWrite':
      return <TodoWriteCard input={input as TodoWriteInput} result={result} />
    default:
      return <FallbackCard use={use} result={result} />
  }
}

export default ToolBlock
