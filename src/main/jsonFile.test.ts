import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { readJsonFile, writeJsonFile } from './jsonFile'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'hongtail-jsonFile-test-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
})

describe('readJsonFile', () => {
  it('정상 JSON 파싱', async () => {
    const path = join(dir, 'a.json')
    await fs.writeFile(path, JSON.stringify({ x: 1, arr: [1, 2] }))
    const v = await readJsonFile(path, null)
    expect(v).toEqual({ x: 1, arr: [1, 2] })
  })

  it('ENOENT 는 fallback', async () => {
    const v = await readJsonFile(join(dir, 'missing.json'), { defaulted: true })
    expect(v).toEqual({ defaulted: true })
  })

  it('빈 파일은 fallback', async () => {
    const path = join(dir, 'empty.json')
    await fs.writeFile(path, '')
    const v = await readJsonFile(path, [])
    expect(v).toEqual([])
  })

  it('whitespace 만 있는 파일도 fallback', async () => {
    const path = join(dir, 'ws.json')
    await fs.writeFile(path, '   \n  \t')
    const v = await readJsonFile(path, [])
    expect(v).toEqual([])
  })

  it('parse 실패는 기본적으로 throw', async () => {
    const path = join(dir, 'bad.json')
    await fs.writeFile(path, '{invalid json')
    await expect(readJsonFile(path, null)).rejects.toThrow()
  })

  it('fallthrough:true 면 parse 실패도 fallback', async () => {
    const path = join(dir, 'bad.json')
    await fs.writeFile(path, '{invalid json')
    const v = await readJsonFile(path, { ok: true }, { fallthrough: true })
    expect(v).toEqual({ ok: true })
  })

  it('fallthrough:true 는 ENOENT 도 흡수', async () => {
    const v = await readJsonFile(join(dir, 'nope.json'), 'fb', { fallthrough: true })
    expect(v).toBe('fb')
  })
})

describe('writeJsonFile', () => {
  it('writes pretty-printed JSON with 2-space indent', async () => {
    const path = join(dir, 'out.json')
    await writeJsonFile(path, { a: 1, b: [2, 3] })
    const raw = await fs.readFile(path, 'utf-8')
    expect(raw).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}')
  })

  it('round-trip with readJsonFile', async () => {
    const path = join(dir, 'rt.json')
    const data = { name: '한글', list: [1, 'two', { nested: true }] }
    await writeJsonFile(path, data)
    const back = await readJsonFile(path, null)
    expect(back).toEqual(data)
  })

  it('overwrites existing file', async () => {
    const path = join(dir, 'over.json')
    await writeJsonFile(path, { v: 1 })
    await writeJsonFile(path, { v: 2 })
    const back = await readJsonFile(path, null)
    expect(back).toEqual({ v: 2 })
  })
})
