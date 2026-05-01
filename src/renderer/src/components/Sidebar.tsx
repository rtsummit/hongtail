import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import WorkspaceCard from './WorkspaceCard'
import logoUrl from '../assets/logo.svg'
import type {
  Backend,
  Block,
  LiveSessionInfo,
  SelectedSession,
  SessionStatus,
  WorkspaceEntry
} from '../types'
import type { SessionAlias } from '../../../preload/index.d'

interface ActiveLike {
  workspacePath: string
  mode: 'new' | 'resume-full' | 'resume-summary'
  backend: Backend
}

interface Props {
  workspaces: WorkspaceEntry[]
  selected: SelectedSession | null
  active: Record<string, ActiveLike>
  messagesBySession: Record<string, Block[]>
  aliasesBySession: Record<string, SessionAlias>
  statusBySession: Record<string, SessionStatus>
  // 다른 client 의 session 시작/종료 알림 — 변경 시 WorkspaceCard refresh.
  refreshTick: number
  onAddWorkspace: () => void | Promise<void>
  onRemoveWorkspace: (path: string) => void | Promise<void>
  onReorderWorkspaces: (fromPath: string, toPath: string, before: boolean) => void | Promise<void>
  onSetAlias: (path: string, alias: string) => void | Promise<void>
  onSetSessionAlias: (sessionId: string, alias: string) => void | Promise<void>
  onOpenSettings: () => void
  onSelect: (s: SelectedSession | null) => void
  onStartClaude: (cwd: string, backend: Backend) => void | Promise<void>
  onStopLive: (sessionId: string) => void | Promise<void>
}

function deriveLiveTitle(blocks: Block[] | undefined): string {
  if (blocks) {
    for (const b of blocks) {
      if (b.kind === 'user-text') {
        const first = b.text.trim().split(/\r?\n/)[0]
        return first.length > 50 ? first.slice(0, 50) + '…' : first
      }
    }
  }
  return '새로운 대화'
}

// 사이드바 필터 옵션:
// - 숫자 (1 / 3 / 7): 최근 N일 안에 활동 (jsonl mtime) 한 readonly 세션만 표시
// - 'active': readonly 다 숨김. live 세션만 보고 싶을 때
// - null: 모두 표시
// live / fresh 세션은 'active' 외 어떤 모드에서도 항상 표시 (지금 활동 중이라).
const FILTER_KEY = 'hongtail.dateFilter'
type DateFilter = 1 | 3 | 7 | 'active' | null

const ICON_ONLY_KEY = 'hongtail.sidebarIconOnly'

function Sidebar({
  workspaces,
  selected,
  active,
  messagesBySession,
  aliasesBySession,
  statusBySession,
  refreshTick,
  onAddWorkspace,
  onRemoveWorkspace,
  onReorderWorkspaces,
  onSetAlias,
  onSetSessionAlias,
  onOpenSettings,
  onSelect,
  onStartClaude,
  onStopLive
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [draggingPath, setDraggingPath] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<{ path: string; before: boolean } | null>(null)
  const [dateFilter, setDateFilter] = useState<DateFilter>(() => {
    const raw = localStorage.getItem(FILTER_KEY)
    if (raw === '1' || raw === '3' || raw === '7') return Number(raw) as 1 | 3 | 7
    if (raw === 'active') return 'active'
    return null
  })
  const updateDateFilter = (next: DateFilter): void => {
    setDateFilter(next)
    if (next == null) localStorage.removeItem(FILTER_KEY)
    else localStorage.setItem(FILTER_KEY, String(next))
  }
  const [iconOnly, setIconOnly] = useState<boolean>(
    () => localStorage.getItem(ICON_ONLY_KEY) === '1'
  )
  const toggleIconOnly = (next: boolean): void => {
    setIconOnly(next)
    if (next) localStorage.setItem(ICON_ONLY_KEY, '1')
    else localStorage.removeItem(ICON_ONLY_KEY)
  }
  // 모바일 (≤768px) 에선 사이드바가 햄버거로 toggle 되는 overlay 라 icon-only
  // 축소 모드 자체가 의미 없다. effective iconOnly 는 데스크톱에서만 활성화.
  // localStorage 값은 그대로 두니 모바일↔데스크톱 전환 후에도 데스크톱 선호도
  // 가 유지된다. matchMedia listener 로 viewport 변경 시 자동 반영.
  const [isMobile, setIsMobile] = useState<boolean>(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    const handler = (e: MediaQueryListEvent): void => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  const effectiveIconOnly = iconOnly && !isMobile
  const liveByWorkspace = new Map<string, LiveSessionInfo[]>()
  for (const [sessionId, a] of Object.entries(active)) {
    const list = liveByWorkspace.get(a.workspacePath) ?? []
    const blocks = messagesBySession[sessionId]
    // App mode: user-text block existence is graduation signal.
    // Terminal mode: claude creates JSONL on session start (~1s) and we don't
    //   track PTY content, so there's no meaningful "fresh" phase — treat as
    //   graduated immediately so it appears as a normal live entry.
    const hasUserMessage =
      a.backend === 'app' ? (blocks?.some((b) => b.kind === 'user-text') ?? false) : true
    list.push({
      sessionId,
      title: deriveLiveTitle(blocks),
      backend: a.backend,
      isNew: a.mode === 'new',
      hasUserMessage
    })
    liveByWorkspace.set(a.workspacePath, list)
  }

  return (
    <aside className={`sidebar${effectiveIconOnly ? ' icon-only' : ''}`}>
      <div className="sidebar-brand" title="hongtail">
        <img src={logoUrl} alt="hongtail" className="sidebar-brand-logo" />
        <span className="sidebar-brand-name">hongtail</span>
      </div>
      <div className="sidebar-toolbar">
        <button
          type="button"
          className="new-session-btn"
          onClick={() => void onAddWorkspace()}
          title={t('sidebar.addWorkspace')}
        >
          <span className="plus">+</span>
          <span className="sidebar-label">{t('sidebar.addWorkspace')}</span>
        </button>
        {!isMobile && (
          <button
            type="button"
            className="sidebar-minimize-btn"
            onClick={() => toggleIconOnly(!iconOnly)}
            title={iconOnly ? t('sidebar.expand') : t('sidebar.minimize')}
            aria-label={iconOnly ? t('sidebar.expand') : t('sidebar.minimize')}
          >
            {iconOnly ? '›' : '‹'}
          </button>
        )}
      </div>

      {!effectiveIconOnly && (
        <div className="date-filter" role="radiogroup" aria-label="활동 기간 필터">
          {([1, 3, 7, 'active', null] as const).map((v) => {
            const label =
              v == null
                ? t('sidebar.filter.all')
                : v === 'active'
                  ? t('sidebar.filter.active')
                  : t('sidebar.filter.days', { n: v })
            const active = dateFilter === v
            return (
              <button
                key={String(v)}
                type="button"
                role="radio"
                aria-checked={active}
                className={`date-filter-btn${active ? ' active' : ''}`}
                onClick={() => updateDateFilter(v)}
              >
                {label}
              </button>
            )
          })}
        </div>
      )}

      <div className="workspace-list">
        {workspaces.map(({ path, alias }) => (
          <WorkspaceCard
            key={path}
            path={path}
            alias={alias}
            liveSessions={liveByWorkspace.get(path) ?? []}
            aliasesBySession={aliasesBySession}
            statusBySession={statusBySession}
            selectedId={selected?.workspacePath === path ? selected.sessionId : null}
            dateFilterDays={dateFilter}
            refreshTick={refreshTick}
            iconOnly={effectiveIconOnly}
            onSelect={onSelect}
            onStartClaude={onStartClaude}
            onStopLive={onStopLive}
            onRemove={onRemoveWorkspace}
            onSetAlias={onSetAlias}
            onSetSessionAlias={onSetSessionAlias}
            isDragging={draggingPath === path}
            dragOverPosition={dragOver?.path === path ? (dragOver.before ? 'top' : 'bottom') : null}
            onDragStart={() => setDraggingPath(path)}
            onDragEnd={() => {
              setDraggingPath(null)
              setDragOver(null)
            }}
            onDragOverHeader={(before) => {
              if (!draggingPath || draggingPath === path) return
              setDragOver((prev) =>
                prev?.path === path && prev.before === before ? prev : { path, before }
              )
            }}
            onDragLeaveHeader={() => {
              setDragOver((prev) => (prev?.path === path ? null : prev))
            }}
            onDropHeader={(before) => {
              if (draggingPath && draggingPath !== path) {
                void onReorderWorkspaces(draggingPath, path, before)
              }
              setDraggingPath(null)
              setDragOver(null)
            }}
          />
        ))}
      </div>

      <div className="sidebar-footer">
        <button
          type="button"
          className="settings-btn"
          onClick={onOpenSettings}
          title={t('sidebar.settings')}
        >
          <span className="settings-icon">⚙</span>
          <span className="sidebar-label">{t('sidebar.settings')}</span>
        </button>
      </div>
    </aside>
  )
}

export default Sidebar
