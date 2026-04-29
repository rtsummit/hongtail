export type DefaultBackend = 'app' | 'terminal' | 'interactive'

export interface AppSettings {
  fonts: string[]
  fontSize: number
  readonlyChunkSize: number
  toolCardsDefaultOpen: boolean
  defaultBackend: DefaultBackend
}

export const DEFAULT_SETTINGS: AppSettings = {
  fonts: [],
  fontSize: 13,
  readonlyChunkSize: 100,
  toolCardsDefaultOpen: false,
  defaultBackend: 'app'
}

const KEY = 'hongtail.settings'

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
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
      toolCardsDefaultOpen:
        typeof parsed.toolCardsDefaultOpen === 'boolean'
          ? parsed.toolCardsDefaultOpen
          : DEFAULT_SETTINGS.toolCardsDefaultOpen,
      defaultBackend:
        parsed.defaultBackend === 'app' ||
        parsed.defaultBackend === 'terminal' ||
        parsed.defaultBackend === 'interactive'
          ? parsed.defaultBackend
          : DEFAULT_SETTINGS.defaultBackend
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
