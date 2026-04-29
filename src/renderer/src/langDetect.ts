import type { Language } from 'prism-react-renderer'

const EXT_TO_LANG: Record<string, Language> = {
  ts: 'tsx',
  tsx: 'tsx',
  mts: 'tsx',
  cts: 'tsx',
  js: 'jsx',
  jsx: 'jsx',
  mjs: 'jsx',
  cjs: 'jsx',
  json: 'json',
  json5: 'json',
  py: 'python',
  pyi: 'python',
  rs: 'rust',
  go: 'go',
  rb: 'ruby',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cc: 'c',
  cpp: 'c',
  hpp: 'c',
  cs: 'c',
  css: 'css',
  scss: 'css',
  html: 'markup',
  htm: 'markup',
  xml: 'markup',
  svg: 'markup',
  md: 'markdown',
  mdx: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  cfg: 'ini',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  psm1: 'powershell',
  psd1: 'powershell',
  sql: 'sql',
  diff: 'diff',
  patch: 'diff',
  graphql: 'graphql'
}

const FILENAME_TO_LANG: Record<string, Language> = {
  dockerfile: 'bash',
  makefile: 'bash',
  '.bashrc': 'bash',
  '.zshrc': 'bash',
  '.gitignore': 'bash'
}

export function detectLanguage(path?: string): Language | null {
  if (!path) return null
  const segs = path.replace(/[\\/]+$/, '').split(/[\\/]/)
  const base = segs.pop() ?? ''
  const lower = base.toLowerCase()
  if (FILENAME_TO_LANG[lower]) return FILENAME_TO_LANG[lower]
  const m = /\.([a-zA-Z0-9]+)$/.exec(base)
  if (!m) return null
  return EXT_TO_LANG[m[1].toLowerCase()] ?? null
}
