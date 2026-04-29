import { homedir } from 'os'
import { promises as fsp } from 'fs'
import { join, relative, sep } from 'path'
import { registerInvoke } from './ipc'

export type CommandSource = 'builtin' | 'user' | 'project' | 'plugin'

export interface SlashCommand {
  name: string // without leading slash
  description: string
  source: CommandSource
  kind: 'command' | 'skill'
  origin?: string // file path or plugin name (for tooltip)
}

// Conservative builtin list shipped with Claude Code 4.x. Hand-maintained.
const BUILTIN: SlashCommand[] = [
  { name: 'help', description: '명령어 / 사용법 안내', source: 'builtin', kind: 'command' },
  { name: 'clear', description: '대화 컨텍스트 비우기', source: 'builtin', kind: 'command' },
  { name: 'compact', description: '대화를 요약해 컨텍스트 압축', source: 'builtin', kind: 'command' },
  { name: 'model', description: '사용 모델 변경 (Opus/Sonnet/Haiku)', source: 'builtin', kind: 'command' },
  { name: 'permissions', description: '도구·경로 권한 관리', source: 'builtin', kind: 'command' },
  { name: 'agents', description: '서브에이전트 관리', source: 'builtin', kind: 'command' },
  { name: 'init', description: 'CLAUDE.md 초기화', source: 'builtin', kind: 'command' },
  { name: 'cost', description: '현재 세션 토큰/비용 보기', source: 'builtin', kind: 'command' },
  { name: 'usage', description: '플랜 사용량/한도 보기', source: 'builtin', kind: 'command' },
  { name: 'export', description: '대화 내보내기', source: 'builtin', kind: 'command' },
  { name: 'memory', description: '메모리 파일 편집/조회', source: 'builtin', kind: 'command' },
  { name: 'bug', description: '버그 제보', source: 'builtin', kind: 'command' },
  { name: 'login', description: '로그인', source: 'builtin', kind: 'command' },
  { name: 'logout', description: '로그아웃', source: 'builtin', kind: 'command' },
  { name: 'pr-comments', description: 'PR 코멘트 가져오기', source: 'builtin', kind: 'command' },
  { name: 'review', description: 'PR 리뷰', source: 'builtin', kind: 'command' },
  { name: 'plugins', description: '플러그인 관리', source: 'builtin', kind: 'command' },
  { name: 'upgrade', description: 'Claude Code 업그레이드', source: 'builtin', kind: 'command' },
  { name: 'status', description: '현재 상태 표시', source: 'builtin', kind: 'command' },
  { name: 'context', description: '컨텍스트 사용량 보기', source: 'builtin', kind: 'command' },
  { name: 'doctor', description: '환경 점검', source: 'builtin', kind: 'command' },
  { name: 'mcp', description: 'MCP 서버 관리', source: 'builtin', kind: 'command' },
  { name: 'release-notes', description: '릴리스 노트 보기', source: 'builtin', kind: 'command' },
  { name: 'todo', description: 'TodoWrite 보기', source: 'builtin', kind: 'command' }
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
    result.push({ name, description, source, kind: 'command', origin: f })
  }
  return result
}

// `<root>/<slug>/SKILL.md` 한 단계만 본다. claude-code 의 스킬 규약과 동일.
async function collectSkillsFromDir(
  root: string,
  source: CommandSource,
  prefix?: string
): Promise<SlashCommand[]> {
  let entries
  try {
    entries = await fsp.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const result: SlashCommand[] = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const skillFile = join(root, e.name, 'SKILL.md')
    try {
      const stat = await fsp.stat(skillFile)
      if (!stat.isFile()) continue
    } catch {
      continue
    }
    const description = await readDescription(skillFile)
    const name = prefix ? `${prefix}:${e.name}` : e.name
    result.push({ name, description, source, kind: 'skill', origin: skillFile })
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

// `~/.claude/plugins/<plugin>/skills/` 와 marketplace 레이아웃
// `~/.claude/plugins/marketplaces/<m>/plugins/<p>/skills/` 둘 다 본다.
async function collectPluginSkills(): Promise<SlashCommand[]> {
  const pluginsRoot = join(homedir(), '.claude', 'plugins')
  const out: SlashCommand[] = []

  async function visitPluginDir(pluginName: string, pluginDir: string): Promise<void> {
    const skillsDir = join(pluginDir, 'skills')
    try {
      const stat = await fsp.stat(skillsDir)
      if (!stat.isDirectory()) return
    } catch {
      return
    }
    const skills = await collectSkillsFromDir(skillsDir, 'plugin', pluginName)
    for (const s of skills) s.origin = `${pluginName} (${s.origin})`
    out.push(...skills)
  }

  let topEntries
  try {
    topEntries = await fsp.readdir(pluginsRoot, { withFileTypes: true })
  } catch {
    return []
  }
  for (const e of topEntries) {
    if (!e.isDirectory()) continue
    if (e.name === 'marketplaces') {
      const marketplacesDir = join(pluginsRoot, e.name)
      let mEntries
      try {
        mEntries = await fsp.readdir(marketplacesDir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const m of mEntries) {
        if (!m.isDirectory()) continue
        const pluginsSub = join(marketplacesDir, m.name, 'plugins')
        let pEntries
        try {
          pEntries = await fsp.readdir(pluginsSub, { withFileTypes: true })
        } catch {
          continue
        }
        for (const p of pEntries) {
          if (!p.isDirectory()) continue
          await visitPluginDir(p.name, join(pluginsSub, p.name))
        }
      }
      continue
    }
    await visitPluginDir(e.name, join(pluginsRoot, e.name))
  }
  return out
}

export async function listSlashCommands(workspacePath?: string): Promise<SlashCommand[]> {
  const userCmdDir = join(homedir(), '.claude', 'commands')
  const projectCmdDir = workspacePath ? join(workspacePath, '.claude', 'commands') : null
  const userSkillDir = join(homedir(), '.claude', 'skills')
  const projectSkillDir = workspacePath ? join(workspacePath, '.claude', 'skills') : null

  const [
    userCmds,
    projectCmds,
    pluginCmds,
    userSkills,
    projectSkills,
    pluginSkills
  ] = await Promise.all([
    collectFromDir(userCmdDir, 'user'),
    projectCmdDir ? collectFromDir(projectCmdDir, 'project') : Promise.resolve([]),
    collectPlugins(),
    collectSkillsFromDir(userSkillDir, 'user'),
    projectSkillDir ? collectSkillsFromDir(projectSkillDir, 'project') : Promise.resolve([]),
    collectPluginSkills()
  ])

  // 우선순위: project → user → plugin → builtin. command 와 skill 은 같은
  // 이름이라도 별도로 보존한다 (kind 가 달라서 사용자 의도가 다를 수 있음).
  const seen = new Set<string>()
  const merged: SlashCommand[] = []
  const lists: SlashCommand[][] = [
    projectCmds,
    projectSkills,
    userCmds,
    userSkills,
    pluginCmds,
    pluginSkills,
    BUILTIN
  ]
  for (const list of lists) {
    for (const c of list) {
      const key = `${c.kind}:${c.name}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(c)
    }
  }
  merged.sort((a, b) => a.name.localeCompare(b.name))
  return merged
}

export function registerSlashCommandHandlers(): void {
  registerInvoke('slash-commands:list', (workspacePath?: unknown) =>
    listSlashCommands(typeof workspacePath === 'string' ? workspacePath : undefined)
  )
}
