import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { sanitizeName, saveFile } from './files'

describe('sanitizeName', () => {
  it('정상 이름은 그대로', () => {
    expect(sanitizeName('hello.txt')).toBe('hello.txt')
    expect(sanitizeName('한글이름.png')).toBe('한글이름.png')
    expect(sanitizeName('with space.pdf')).toBe('with space.pdf')
  })

  it('path traversal 방지 — / 와 \\ 는 _ 로', () => {
    expect(sanitizeName('../etc/passwd')).toBe('.._etc_passwd')
    expect(sanitizeName('a\\b\\c.txt')).toBe('a_b_c.txt')
    expect(sanitizeName('/abs/path')).toBe('_abs_path')
  })

  it('OS 예약 문자 (<>:"|?*) 와 control char 는 _ 로', () => {
    expect(sanitizeName('a<b>c.txt')).toBe('a_b_c.txt')
    expect(sanitizeName('q?.txt')).toBe('q_.txt')
    expect(sanitizeName('pi|pe.log')).toBe('pi_pe.log')
    expect(sanitizeName('a:b.txt')).toBe('a_b.txt')
    // \x00-\x1f 도 같이 처리
    expect(sanitizeName('a\x01b.txt')).toBe('a_b.txt')
  })

  it('빈 / 공백 만 → fallback "file"', () => {
    expect(sanitizeName('')).toBe('file')
    expect(sanitizeName('   ')).toBe('file')
  })

  it('control char 만 (tab/newline) → _ 로 치환되어 결과는 underscore 만의 문자열 (fallback 안 탐)', () => {
    // sanitize 단계에서 \t \n 이 _ 로 치환된 뒤 trim 해도 _ 가 남으니
    // 빈 이름 fallback 은 안 적용. 의미 있는 이름은 아니지만 path traversal /
    // 예약 문자 안전성만 보장하면 충분.
    expect(sanitizeName('\t\n')).toBe('__')
  })

  it('80자 초과 시 ext 보존하면서 base 잘라냄', () => {
    const longBase = 'a'.repeat(200)
    const out = sanitizeName(`${longBase}.txt`)
    expect(out.length).toBeLessThanOrEqual(80)
    expect(out.endsWith('.txt')).toBe(true)
    // 잘린 부분도 base 가 a 들로만 차야
    expect(out.slice(0, -4)).toMatch(/^a+$/)
  })

  it('80자 초과 + 확장자 없음 — 그래도 80자 안에 들어감', () => {
    const long = 'b'.repeat(200)
    const out = sanitizeName(long)
    expect(out.length).toBeLessThanOrEqual(80)
    expect(out).toMatch(/^b+$/)
  })

  it('앞뒤 공백 trim', () => {
    expect(sanitizeName('  spaced.txt  ')).toBe('spaced.txt')
  })
})

describe('saveFile', () => {
  let tmp: string
  let originalEnv: string | undefined

  beforeEach(async () => {
    // saveFile 은 homedir() 의 ~/.claude/file-cache 에 저장한다. 테스트가
    // 사용자 디렉토리를 오염시키지 않도록 HOME / USERPROFILE 을 임시로 바꿈.
    tmp = await fsp.mkdtemp(join(tmpdir(), 'hongtail-files-test-'))
    originalEnv = process.env.HOME
    process.env.HOME = tmp
    process.env.USERPROFILE = tmp
  })

  afterEach(async () => {
    if (originalEnv !== undefined) process.env.HOME = originalEnv
    else delete process.env.HOME
    delete process.env.USERPROFILE
    await fsp.rm(tmp, { recursive: true, force: true })
  })

  it('정상 sessionId 로 저장하면 timestamp prefix 의 path 반환', async () => {
    const sid = 'abc-123'
    const bytes = new Uint8Array([1, 2, 3, 4, 5])
    const path = await saveFile(sid, bytes, 'data.bin')
    // path 형식: <homedir>/.claude/file-cache/<sid>/<YYYYMMDD-HHMMSS-mmm>-<safe>
    expect(path).toContain('file-cache')
    expect(path).toContain(sid)
    expect(path).toMatch(/\d{8}-\d{6}-\d{3}-data\.bin$/)
    // 실제로 파일이 쓰였는지
    const written = await fsp.readFile(path)
    expect(Array.from(written)).toEqual([1, 2, 3, 4, 5])
  })

  it('파일 이름이 sanitize 되어 저장됨', async () => {
    const path = await saveFile('s1', new Uint8Array([0]), '../../etc/passwd')
    expect(path).not.toContain('../')
    expect(path).toMatch(/\.\._\.\._etc_passwd$/)
  })

  it('SAFE_SESSION_ID 위반 시 throw — path traversal 방지', async () => {
    await expect(saveFile('../evil', new Uint8Array(), 'x.txt')).rejects.toThrow(
      'invalid session id'
    )
    await expect(saveFile('a/b', new Uint8Array(), 'x.txt')).rejects.toThrow(
      'invalid session id'
    )
    await expect(saveFile('with space', new Uint8Array(), 'x.txt')).rejects.toThrow(
      'invalid session id'
    )
  })

  it('uuid 형식 sessionId 도 통과', async () => {
    const sid = '2e456845-3b39-4149-b7be-fb56611e3d9b'
    const path = await saveFile(sid, new Uint8Array([42]), 'a.txt')
    expect(path).toContain(sid)
  })
})
