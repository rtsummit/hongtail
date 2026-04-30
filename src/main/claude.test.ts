import { describe, expect, it } from 'vitest'
import { encodeCwd, projectDir } from './claude'

describe('encodeCwd', () => {
  it('영숫자·점·하이픈은 보존', () => {
    expect(encodeCwd('foo.bar-baz')).toBe('foo.bar-baz')
    expect(encodeCwd('Abc123.Z')).toBe('Abc123.Z')
  })
  it('Windows 경로 — backslash·colon → 하이픈', () => {
    expect(encodeCwd('C:\\Workspace\\hongtail')).toBe('C--Workspace-hongtail')
  })
  it('POSIX 경로 — slash → 하이픈', () => {
    expect(encodeCwd('/home/user/project')).toBe('-home-user-project')
  })
  it('underscore·space 도 → 하이픈', () => {
    expect(encodeCwd('my_proj name')).toBe('my-proj-name')
  })
  it('한글·non-ascii 도 → 하이픈 (각 바이트당 아니라 각 문자당)', () => {
    // /[^a-zA-Z0-9.-]/g 는 각 char 매칭이라 한글 char 1개 → '-' 1개
    expect(encodeCwd('한글')).toBe('--')
  })
  it('빈 문자열은 빈 문자열', () => {
    expect(encodeCwd('')).toBe('')
  })
  it('Windows vs forward-slash 표기가 같은 dir 로 매핑', () => {
    expect(encodeCwd('C:\\Workspace\\hongtail')).toBe(encodeCwd('C:/Workspace/hongtail'))
  })
})

describe('projectDir', () => {
  it('~/.claude/projects/<encoded> 형태', () => {
    const out = projectDir('C:\\Workspace\\hongtail')
    expect(out).toMatch(/[\\/]\.claude[\\/]projects[\\/]C--Workspace-hongtail$/)
  })
  it('encodeCwd 결과를 마지막 segment 로 사용', () => {
    const cwd = '/home/user/proj'
    const out = projectDir(cwd)
    expect(out.endsWith(encodeCwd(cwd))).toBe(true)
  })
})
