import { ipcMain } from 'electron'
import { homedir } from 'os'
import { promises as fsp } from 'fs'
import { join, relative, sep } from 'path'

export type CommandSource = 'builtin' | 'user' | 'project' | 'plugin'

export interface SlashCommand {
  name: string // without leading slash
  description: string
  source: CommandSource
  origin?: string // file path or plugin name (for tooltip)
}

// Conservative builtin list shipped with Claude Code 4.x. Hand-maintained.
const BUILTIN: SlashCommand[] = [
  { name: 'help', description: '명령어 / 사용법 안내', source: 'builtin' },
  { name: 'clear', description: '대화 컨텍스트 비우기', source: 'builtin' },
  { name: 'compact', description: '대화를 요약해 컨텍스트 압축', source: 'builtin' },
  { name: 'model', description: '사용 모델 변경 (Opus/Sonnet/Haiku)', source: 'builtin' },
  { name: 'permissions', description: '도구·경로 권한 관리', source: 'builtin' },
  { name: 'agents', description: '서브에이전트 관리', source: 'builtin' },
  { name: 'init', description: 'CLAUDE.md 초기화', source: 'builtin' },
  { name: 'cost', description: '현재 세션 토큰/비용 보기', source: 'builtin' },
  { name: 'usage', description: '플랜 사용량/한도 보기', source: 'builtin' },
  { name: 'export', description: '대화 내보내기', source: 'builtin' },
  { name: 'memory', description: '메모리 파일 편집/조회', source: 'builtin' },
  { name: 'bug', description: '버그 제보', source: 'builtin' },
  { name: 'login', description: '로그인', source: 'builtin' },
  { name: 'logout', description: '로그아웃', source: 'builtin' },
  { name: 'pr-comments', description: 'PR 코멘트 가져오기', source: 'builtin' },
  { name: 'review', description: 'PR 리뷰', source: 'builtin' },
  { name: 'plugins', description: '플러그인 관리', source: 'builtin' },
  { name: 'upgrade', description: 'Claude Code 업그레이드', source: 'builtin' },
  { name: 'status', description: '현재 상태 표시', source: 'builtin' },
  { name: 'context', description: '컨텍스트 사용량 보기', source: 'builtin' },
  { name: 'doctor', description: '환경 점검', source: 'builtin' },
  { name: 'mcp', description: 'MCP 서버 관리', source: 'builtin' },
  { name: 'release-notes', description: '릴리스 노트 보기', source: 'builtin' },
  { name: 'todo', description: 'TodoWrite 보기', source: 'builtin' }
]

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/
const DESCRIPTION_RE = /^description:\s*(.+?)\s*$/m

function parseFrontmatterDescription(text: string): string | null {
  const m = FRONT_MATTER_RE.exec(text)
  if (!m) return null
  const desc = DESCRIPTION_RE.exec(m[1])
  if (!desc) return null
  return desc[1].replace(/^["']|["']$/g, '')
}

async function readDescription(filePath: string): Promise<string> {
  try {
    const buf = await fsp.readFile(filePath, 'utf8')
    return parseFrontmatterDescription(buf) ?? ''
  } catch {
    return ''
  }
}

async function walkMd(root: string): Promise<string[]> {
  const out: string[] = []
  async function visit(dir: string): Promise<void> {
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        await visit(p)
      } else if (e.isFile() && e.name.endsWith('.md')) {
        out.push(p)
      }
    }
  }
  await visit(root)
  return out
}

function fileToCommandName(root: string, file: string): string {
  const rel = relative(root, file).replace(/\.md$/i, '')
  return rel.split(sep).join(':')
}

async function collectFromDir(
  root: string,
  source: CommandSource,
  prefix?: string
): Promise<SlashCommand[]> {
  const files = await walkMd(root)
  const result: SlashCommand[] = []
  for (const f of files) {
    const base = fileToCommandName(root, f)
    const name = prefix ? `${prefix}:${base}` : base
    const description = await readDescription(f)
    result.push({ name, description, source, origin: f })
  }
  return result
}

async function collectPlugins(): Promise<SlashCommand[]> {
  const pluginsRoot = join(homedir(), '.claude', 'plugins')
  let entries
  try {
    entries = await fsp.readdir(pluginsRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const out: SlashCommand[] = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const cmdDir = join(pluginsRoot, e.name, 'commands')
    try {
      const stat = await fsp.stat(cmdDir)
      if (!stat.isDirectory()) continue
    } catch {
      continue
    }
    const commands = await collectFromDir(cmdDir, 'plugin', e.name)
    for (const c of commands) c.origin = `${e.name} (${c.origin})`
    out.push(...commands)
  }
  return out
}

export async function listSlashCommands(workspacePath?: string): Promise<SlashCommand[]> {
  const userDir = join(homedir(), '.claude', 'commands')
  const projectDir = workspacePath ? join(workspacePath, '.claude', 'commands') : null

  const [user, project, plugins] = await Promise.all([
    collectFromDir(userDir, 'user'),
    projectDir ? collectFromDir(projectDir, 'project') : Promise.resolve([]),
    collectPlugins()
  ])

  // Order: project → user → plugin → builtin. Same name within a higher
  // priority source hides lower ones.
  const seen = new Set<string>()
  const merged: SlashCommand[] = []
  for (const list of [project, user, plugins, BUILTIN]) {
    for (const c of list) {
      if (seen.has(c.name)) continue
      seen.add(c.name)
      merged.push(c)
    }
  }
  merged.sort((a, b) => a.name.localeCompare(b.name))
  return merged
}

export function registerSlashCommandHandlers(): void {
  ipcMain.handle('slash-commands:list', async (_e, workspacePath?: string) => {
    return listSlashCommands(workspacePath)
  })
}
