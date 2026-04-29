export interface AppSettings {
  fonts: string[]
  fontSize: number
  readonlyChunkSize: number
  // Tool 이름 (Bash, Read, ...) 의 배열. 비면 모두 접힘.
  toolCardsDefaultOpen: string[]
}

// SettingsModal 의 도구 카드 토글에 노출되는 이름들.
export const KNOWN_TOOL_NAMES = ['Bash', 'Read', 'Edit', 'Write', 'Grep', 'Glob', 'TodoWrite'] as const

export const DEFAULT_SETTINGS: AppSettings = {
  fonts: [],
  fontSize: 13,
  readonlyChunkSize: 100,
  toolCardsDefaultOpen: []
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
      )
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
