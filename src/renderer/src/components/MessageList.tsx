import { memo, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import ToolBlock from './ToolBlock'
import AskUserQuestionCard from './AskUserQuestionCard'
import ExitPlanModeCard from './ExitPlanModeCard'
import { markdownComponents, markdownUrlTransform } from '../markdownComponents'
import type { Block } from '../types'

interface Props {
  blocks: Block[]
  // Phase 1.2 — 자식의 control_request 로 들어온 deferred tool 카드 응답.
  // 호출자 (App.tsx) 가 control_response 로 변환해 자식 stdin 에 회신 + Block
  // 의 resolved 갱신 책임. MessageList 가 ChatPane / SideChatPanel 둘 다에서
  // 쓰여서 핸들러를 optional 로 둠 — undefined 면 카드는 readonly 로 렌더.
  onAskUserQuestionAnswer?: (requestId: string, answers: Record<string, string>) => void
  onAskUserQuestionCancel?: (requestId: string) => void
  onExitPlanModeApprove?: (requestId: string) => void
  onExitPlanModeDeny?: (requestId: string, message: string) => void
}

type ToolUseBlock = Extract<Block, { kind: 'tool-use' }>
type ToolResultBlock = Extract<Block, { kind: 'tool-result' }>

interface ToolPairBlock {
  kind: 'tool-pair'
  use: ToolUseBlock
  result?: ToolResultBlock
}

type RenderItem = Exclude<Block, { kind: 'tool-use' } | { kind: 'tool-result' }> | ToolPairBlock

// Internal task-management tools that claude CLI also hides from the user view.
const HIDDEN_TOOLS = new Set([
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'TaskGet',
  'TaskOutput',
  'TaskStop'
])

function pairToolBlocks(blocks: Block[]): RenderItem[] {
  // First pass: index tool-results and collect hidden-tool ids
  const resultById = new Map<string, ToolResultBlock>()
  const hiddenIds = new Set<string>()
  for (const b of blocks) {
    if (b.kind === 'tool-result' && b.toolUseId) {
      resultById.set(b.toolUseId, b)
    }
    if (b.kind === 'tool-use' && b.toolUseId && HIDDEN_TOOLS.has(b.name)) {
      hiddenIds.add(b.toolUseId)
    }
  }
  const consumedResultIds = new Set<string>()
  const out: RenderItem[] = []
  for (const b of blocks) {
    if (b.kind === 'tool-use') {
      if (b.toolUseId && hiddenIds.has(b.toolUseId)) continue
      const result = b.toolUseId ? resultById.get(b.toolUseId) : undefined
      if (result?.toolUseId) consumedResultIds.add(result.toolUseId)
      out.push({ kind: 'tool-pair', use: b, result })
    } else if (b.kind === 'tool-result') {
      if (b.toolUseId && hiddenIds.has(b.toolUseId)) continue
      if (b.toolUseId && consumedResultIds.has(b.toolUseId)) continue
      out.push({ kind: 'tool-pair', use: { kind: 'tool-use', toolUseId: b.toolUseId, name: 'unknown', input: undefined }, result: b })
    } else {
      out.push(b)
    }
  }
  return out
}

const ICON_PROPS = {
  width: 14,
  height: 14,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true
}

function CopyIcon(): React.JSX.Element {
  return (
    <svg {...ICON_PROPS}>
      <rect x="5.5" y="5.5" width="9" height="9" rx="1.5" />
      <path d="M11 5.5V3.5A1.5 1.5 0 0 0 9.5 2H3.5A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5.5" />
    </svg>
  )
}

function CheckIcon(): React.JSX.Element {
  return (
    <svg {...ICON_PROPS}>
      <path d="M3 8.5l3 3L13 5" />
    </svg>
  )
}

function ChevronUpIcon(): React.JSX.Element {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 10l4-4 4 4" />
    </svg>
  )
}

function ChevronDownIcon(): React.JSX.Element {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 6l4 4 4-4" />
    </svg>
  )
}

function ExternalLinkIcon(): React.JSX.Element {
  return (
    <svg {...ICON_PROPS}>
      <path d="M9 3h4v4" />
      <path d="M13 3l-7 7" />
      <path d="M11 8.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4.5" />
    </svg>
  )
}

function CloseIcon(): React.JSX.Element {
  return (
    <svg {...ICON_PROPS}>
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
    </svg>
  )
}

const AssistantText = memo(function AssistantText({
  text
}: {
  text: string
}): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [opened, setOpened] = useState(false)
  const bubbleRef = useRef<HTMLDivElement>(null)
  // 접기 직전 폭을 기억해 collapsed 동안 width 고정. placeholder 가 짧아 bubble
  // 폭이 줄어드는 걸 방지.
  const [savedWidth, setSavedWidth] = useState<number | null>(null)

  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard 권한 없거나 비-secure 컨텍스트 — 무시 */
    }
  }

  const toggleCollapsed = (): void => {
    if (!collapsed) {
      // 접기로 전환 — 현재 폭 캡처
      if (bubbleRef.current) setSavedWidth(bubbleRef.current.offsetWidth)
    } else {
      // 펼치기로 전환 — 고정 해제, 자연 폭으로 복귀
      setSavedWidth(null)
    }
    setCollapsed((v) => !v)
  }

  const expandFromCollapsed = (): void => {
    setSavedWidth(null)
    setCollapsed(false)
  }

  const style =
    collapsed && savedWidth != null
      ? { width: `${savedWidth}px`, maxWidth: 'none' as const }
      : undefined

  return (
    <div ref={bubbleRef} className="bubble assistant" style={style}>
      <div className="bubble-actions">
        <button
          type="button"
          className="bubble-action"
          onClick={onCopy}
          title={copied ? '복사됨' : '복사'}
          aria-label={copied ? '복사됨' : '복사'}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
        <button
          type="button"
          className="bubble-action"
          onClick={toggleCollapsed}
          title={collapsed ? '펼치기' : '접기'}
          aria-label={collapsed ? '펼치기' : '접기'}
        >
          {collapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
        </button>
        <button
          type="button"
          className="bubble-action"
          onClick={() => setOpened(true)}
          title="별도 창으로 열기"
          aria-label="별도 창으로 열기"
        >
          <ExternalLinkIcon />
        </button>
      </div>
      {collapsed ? (
        <div className="bubble-collapsed" onClick={expandFromCollapsed}>
          ··· (접힘 — 클릭해서 펼치기)
        </div>
      ) : (
        <div className="bubble-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents} urlTransform={markdownUrlTransform}>
            {text}
          </ReactMarkdown>
        </div>
      )}
      {opened && <AssistantTextModal text={text} onClose={() => setOpened(false)} />}
    </div>
  )
})

function AssistantTextModal({
  text,
  onClose
}: {
  text: string
  onClose: () => void
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (e.isComposing || e.keyCode === 229) return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal modal-wide" role="dialog" aria-label="응답 보기">
        <header className="modal-header">
          <h2 className="modal-title-path">응답</h2>
          <div className="modal-header-actions">
            <button
              type="button"
              className="bubble-action"
              onClick={onCopy}
              title={copied ? '복사됨' : '복사'}
              aria-label={copied ? '복사됨' : '복사'}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
            <button
              type="button"
              className="bubble-action"
              onClick={onClose}
              title="닫기"
              aria-label="닫기"
            >
              <CloseIcon />
            </button>
          </div>
        </header>
        <div className="modal-body assistant-modal-body">
          <div className="bubble-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents} urlTransform={markdownUrlTransform}>
              {text}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  )
}

function MessageList({
  blocks,
  onAskUserQuestionAnswer,
  onAskUserQuestionCancel,
  onExitPlanModeApprove,
  onExitPlanModeDeny
}: Props): React.JSX.Element {
  const items = useMemo(() => pairToolBlocks(blocks), [blocks])
  return (
    <>
      {items.map((b, i) => (
        <ItemView
          key={i}
          item={b}
          onAskUserQuestionAnswer={onAskUserQuestionAnswer}
          onAskUserQuestionCancel={onAskUserQuestionCancel}
          onExitPlanModeApprove={onExitPlanModeApprove}
          onExitPlanModeDeny={onExitPlanModeDeny}
        />
      ))}
    </>
  )
}

interface ItemViewProps {
  item: RenderItem
  onAskUserQuestionAnswer?: (requestId: string, answers: Record<string, string>) => void
  onAskUserQuestionCancel?: (requestId: string) => void
  onExitPlanModeApprove?: (requestId: string) => void
  onExitPlanModeDeny?: (requestId: string, message: string) => void
}

const ItemView = memo(function ItemView({
  item,
  onAskUserQuestionAnswer,
  onAskUserQuestionCancel,
  onExitPlanModeApprove,
  onExitPlanModeDeny
}: ItemViewProps): React.JSX.Element | null {
  if (item.kind === 'tool-pair') {
    return <ToolBlock use={item.use} result={item.result} />
  }
  switch (item.kind) {
    case 'user-text':
      return (
        <div className="bubble user">
          <pre className="bubble-text">{item.text}</pre>
        </div>
      )
    case 'assistant-text':
      return <AssistantText text={item.text} />
    case 'command-invoke':
      return (
        <div className="command-card invoke">
          <div className="command-header">
            <span className="command-icon">▸</span>
            <span className="command-name">{item.name}</span>
            {item.args ? <span className="command-args">{item.args}</span> : null}
          </div>
          {item.message && item.message !== item.name ? (
            <div className="command-message">{item.message}</div>
          ) : null}
        </div>
      )
    case 'command-output':
      return (
        <div className={`command-card output ${item.stream}`}>
          <div className="command-header">
            <span className="command-stream">{item.stream}</span>
          </div>
          <pre className="command-output-text">{item.text}</pre>
        </div>
      )
    case 'system':
      return <div className="system-line">{item.text}</div>
    case 'error':
      return <div className="system-line error">{item.text}</div>
    case 'ask-user-question':
      return (
        <AskUserQuestionCard
          questions={item.questions}
          resolved={item.resolved}
          onSubmit={(answers) => onAskUserQuestionAnswer?.(item.requestId, answers)}
          onCancel={() => onAskUserQuestionCancel?.(item.requestId)}
        />
      )
    case 'exit-plan-mode':
      return (
        <ExitPlanModeCard
          plan={item.plan}
          planFilePath={item.planFilePath}
          resolved={item.resolved}
          onApprove={() => onExitPlanModeApprove?.(item.requestId)}
          onDeny={(message) => onExitPlanModeDeny?.(item.requestId, message)}
        />
      )
    default:
      return null
  }
})

export default memo(MessageList)
