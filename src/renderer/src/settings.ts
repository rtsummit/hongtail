export type LangSetting = 'auto' | 'ko' | 'en'

// claude CLI 의 --permission-mode 값. UsageBar 의 사이클·메뉴와 동일.
export type PermissionModeSetting =
  | 'default'
  | 'auto'
  | 'plan'
  | 'acceptEdits'
  | 'bypassPermissions'

export const PERMISSION_MODE_VALUES: PermissionModeSetting[] = [
  'default',
  'auto',
  'plan',
  'acceptEdits',
  'bypassPermissions'
]

export interface AppSettings {
  fonts: string[]
  fontSize: number
  readonlyChunkSize: number
  // Tool 이름 (Bash, Read, ...) 의 배열. 비면 모두 접힘.
  toolCardsDefaultOpen: string[]
  // 'auto' 면 navigator.language 로 ko/en 결정. 명시 ko/en 이면 그대로.
  language: LangSetting
  // 새 'app' 백엔드 세션을 spawn 할 때 적용할 --permission-mode. 도중 변경은
  // UsageBar 의 mode 메뉴 / Shift+Tab 사이클로 그대로.
  defaultPermissionMode: PermissionModeSetting
  // 워크스페이스 우클릭 → 폴더 열기 에서 실행할 명령 템플릿. 비면 OS default
  // (Windows 면 탐색기). %1 자리에 path 가 자동 quote 되어 치환. 예:
  //   'explorer %1'
  //   '"C:\\totalcmd\\TOTALCMD64.EXE" /O /T %1'
  folderOpenCommand: string
}

// SettingsModal 의 도구 카드 토글에 노출되는 이름들.
export const KNOWN_TOOL_NAMES = ['Bash', 'Read', 'Edit', 'Write', 'Grep', 'Glob', 'TodoWrite'] as const

export const DEFAULT_SETTINGS: AppSettings = {
  fonts: [],
  fontSize: 13,
  readonlyChunkSize: 100,
  toolCardsDefaultOpen: [],
  language: 'auto',
  defaultPermissionMode: 'bypassPermissions',
  folderOpenCommand: ''
}

const KEY = 'hongtail.settings'

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
}

function migrateToolCardsDefaultOpen(v: unknown): string[] {
  // 구버전: boolean. true → 알려진 도구 전부, false → 빈 배열.
  if (typeof v === 'boolean') return v ? [...KNOWN_TOOL_NAMES] : []
  if (Array.isArray(v)) return asStringArray(v)
  return [...DEFAULT_SETTINGS.toolCardsDefaultOpen]
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<AppSettings> & {
      uiFont?: string
      uiFonts?: string[]
      monoFont?: string
      monoFonts?: string[]
      uiFontSize?: number
      monoFontSize?: number
      chatFontSize?: number
    }
    const fonts = parsed.fonts
      ? asStringArray(parsed.fonts)
      : parsed.uiFonts
        ? asStringArray(parsed.uiFonts)
        : typeof parsed.uiFont === 'string' && parsed.uiFont.trim()
          ? parsed.uiFont.split(',').map((s) => s.trim()).filter(Boolean)
          : []
    const sizeRaw = parsed.fontSize ?? parsed.uiFontSize ?? parsed.chatFontSize
    const sizeNum = Number(sizeRaw)
    const chunkRaw =
      parsed.readonlyChunkSize ??
      (parsed as Record<string, unknown>).readonlyLoadChunk ??
      (parsed as Record<string, unknown>).readonlyTailLines
    const chunkNum = Number(chunkRaw)
    return {
      fonts,
      fontSize:
        Number.isFinite(sizeNum) && sizeNum >= 8 && sizeNum <= 32
          ? sizeNum
          : DEFAULT_SETTINGS.fontSize,
      readonlyChunkSize:
        Number.isFinite(chunkNum) && chunkNum >= 20 && chunkNum <= 2000
          ? Math.round(chunkNum)
          : DEFAULT_SETTINGS.readonlyChunkSize,
      toolCardsDefaultOpen: migrateToolCardsDefaultOpen(
        (parsed as Record<string, unknown>).toolCardsDefaultOpen
      ),
      language:
        parsed.language === 'ko' || parsed.language === 'en' || parsed.language === 'auto'
          ? parsed.language
          : DEFAULT_SETTINGS.language,
      defaultPermissionMode: PERMISSION_MODE_VALUES.includes(
        parsed.defaultPermissionMode as PermissionModeSetting
      )
        ? (parsed.defaultPermissionMode as PermissionModeSetting)
        : DEFAULT_SETTINGS.defaultPermissionMode,
      folderOpenCommand:
        typeof parsed.folderOpenCommand === 'string'
          ? parsed.folderOpenCommand
          : DEFAULT_SETTINGS.folderOpenCommand
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: AppSettings): void {
  localStorage.setItem(KEY, JSON.stringify(s))
}

function quoteIfNeeded(font: string): string {
  return /\s/.test(font) && !/^['"]/.test(font) ? `"${font}"` : font
}

export function fontStackToCss(fonts: string[]): string {
  return fonts.map(quoteIfNeeded).join(', ')
}
