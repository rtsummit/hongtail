import { ipcMain } from 'electron'
import { execFile } from 'child_process'

const FALLBACK_FONTS = [
  'Arial',
  'Cascadia Code',
  'Cascadia Mono',
  'Comic Sans MS',
  'Consolas',
  'Courier New',
  'Georgia',
  'Helvetica',
  'Impact',
  'Lucida Console',
  'Malgun Gothic',
  '맑은 고딕',
  'Microsoft Sans Serif',
  'Segoe UI',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana'
]

let cached: string[] | null = null

function listFontsViaPowerShell(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const script =
      "Add-Type -AssemblyName System.Drawing; " +
      "[System.Drawing.Text.InstalledFontCollection]::new().Families | " +
      "ForEach-Object { $_.Name } | Sort-Object -Unique"
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 8000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err)
        const lines = stdout
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.length > 0)
        resolve(lines)
      }
    )
  })
}

async function listFonts(): Promise<string[]> {
  if (cached) return cached
  if (process.platform === 'win32') {
    try {
      const fonts = await listFontsViaPowerShell()
      if (fonts.length > 0) {
        cached = fonts
        return fonts
      }
    } catch (err) {
      console.error('font enumerate failed, using fallback:', err)
    }
  }
  cached = FALLBACK_FONTS.slice()
  return cached
}

export function registerFontHandlers(): void {
  ipcMain.handle('fonts:list', async () => listFonts())
}
