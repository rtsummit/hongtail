import { describe, expect, it } from 'vitest'
import { dedupeWorkspaces, normalizePath, normalizeWorkspaceEntry } from './workspaces'

describe('normalizePath', () => {
  it('빈 문자열 / whitespace 만 → 빈 문자열', () => {
    expect(normalizePath('')).toBe('')
    expect(normalizePath('   ')).toBe('')
  })
  it('backslash → forward slash', () => {
    expect(normalizePath('C:\\Workspace\\proj')).toBe('C:/Workspace/proj')
  })
  it('Windows drive letter 대문자화', () => {
    expect(normalizePath('c:\\users')).toBe('C:/users')
    expect(normalizePath('d:/foo')).toBe('D:/foo')
  })
  it('이미 대문자 drive letter 는 그대로', () => {
    expect(normalizePath('E:/x')).toBe('E:/x')
  })
  it('trailing slash 제거 (단, root 는 보존)', () => {
    expect(normalizePath('/home/user/')).toBe('/home/user')
    expect(normalizePath('C:/foo/')).toBe('C:/foo')
    expect(normalizePath('/')).toBe('/') // 루트는 그대로
    expect(normalizePath('C:/')).toBe('C:/') // 길이 3, 그대로
  })
  it('POSIX 경로 그대로', () => {
    expect(normalizePath('/home/user/proj')).toBe('/home/user/proj')
  })
  it('주변 whitespace trim', () => {
    expect(normalizePath('  /a/b/  ')).toBe('/a/b')
  })
  it('Windows / forward-slash 표기가 같은 결과', () => {
    expect(normalizePath('C:\\Workspace\\hongtail')).toBe(normalizePath('C:/Workspace/hongtail'))
  })
})

describe('normalizeWorkspaceEntry', () => {
  it('string 입력 → { path } 객체', () => {
    expect(normalizeWorkspaceEntry('C:\\proj')).toEqual({ path: 'C:/proj' })
  })
  it('빈 문자열 → null', () => {
    expect(normalizeWorkspaceEntry('')).toBeNull()
    expect(normalizeWorkspaceEntry('   ')).toBeNull()
  })
  it('object 의 path string 처리 + alias 보존', () => {
    expect(normalizeWorkspaceEntry({ path: 'c:\\x', alias: 'My Proj' })).toEqual({
      path: 'C:/x',
      alias: 'My Proj'
    })
  })
  it('빈 alias 는 drop', () => {
    expect(normalizeWorkspaceEntry({ path: '/p', alias: '' })).toEqual({ path: '/p' })
    expect(normalizeWorkspaceEntry({ path: '/p', alias: '   ' })).toEqual({ path: '/p' })
  })
  it('path string 아닌 object → null', () => {
    expect(normalizeWorkspaceEntry({ path: 123 })).toBeNull()
    expect(normalizeWorkspaceEntry({ alias: 'x' })).toBeNull()
  })
  it('잘못된 타입 → null', () => {
    expect(normalizeWorkspaceEntry(null)).toBeNull()
    expect(normalizeWorkspaceEntry(undefined)).toBeNull()
    expect(normalizeWorkspaceEntry(42)).toBeNull()
  })
})

describe('dedupeWorkspaces', () => {
  it('같은 path 중복 제거', () => {
    expect(
      dedupeWorkspaces([{ path: '/a' }, { path: '/a' }, { path: '/b' }])
    ).toEqual([{ path: '/a' }, { path: '/b' }])
  })
  it('alias 있는 쪽 우선 보존 — 첫 entry 가 alias 없을 때', () => {
    const out = dedupeWorkspaces([
      { path: '/a' },
      { path: '/a', alias: 'My' }
    ])
    expect(out).toEqual([{ path: '/a', alias: 'My' }])
  })
  it('첫 entry 가 alias 있으면 그쪽 유지', () => {
    const out = dedupeWorkspaces([
      { path: '/a', alias: 'First' },
      { path: '/a' }
    ])
    expect(out).toEqual([{ path: '/a', alias: 'First' }])
  })
  it('둘 다 alias 면 첫 번째 우선 (마지막 wins 아님)', () => {
    const out = dedupeWorkspaces([
      { path: '/a', alias: 'First' },
      { path: '/a', alias: 'Second' }
    ])
    expect(out).toEqual([{ path: '/a', alias: 'First' }])
  })
  it('빈 배열 → 빈 배열', () => {
    expect(dedupeWorkspaces([])).toEqual([])
  })
  it('순서 보존 (Map 의 insertion order)', () => {
    const out = dedupeWorkspaces([{ path: '/c' }, { path: '/a' }, { path: '/b' }])
    expect(out.map((e) => e.path)).toEqual(['/c', '/a', '/b'])
  })
})
