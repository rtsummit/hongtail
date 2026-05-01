import { describe, expect, it, vi } from 'vitest'
import { openOrLoadFile, type FileApiLike } from './fileOpenerLogic'

function makeApi(overrides: Partial<FileApiLike>): FileApiLike {
  return {
    openExternal: vi.fn(() => Promise.resolve()),
    read: vi.fn(() => Promise.resolve('')),
    ...overrides
  }
}

describe('openOrLoadFile', () => {
  it('빈 path → empty', async () => {
    const api = makeApi({})
    const out = await openOrLoadFile('', api)
    expect(out).toEqual({ kind: 'empty' })
    expect(api.openExternal).not.toHaveBeenCalled()
    expect(api.read).not.toHaveBeenCalled()
  })

  it('Electron — openExternal 성공 → opened, read 안 호출', async () => {
    const api = makeApi({
      openExternal: vi.fn(() => Promise.resolve())
    })
    const out = await openOrLoadFile('/some/file.txt', api)
    expect(out).toEqual({ kind: 'opened' })
    expect(api.openExternal).toHaveBeenCalledWith('/some/file.txt')
    expect(api.read).not.toHaveBeenCalled()
  })

  it('Web (openExternal reject) — read 텍스트로 loaded', async () => {
    const api = makeApi({
      openExternal: vi.fn(() => Promise.reject(new Error('not supported in web'))),
      read: vi.fn(() => Promise.resolve('hello world'))
    })
    const out = await openOrLoadFile('/some/file.txt', api)
    expect(out).toEqual({ kind: 'loaded', text: 'hello world' })
    expect(api.read).toHaveBeenCalledWith('/some/file.txt')
  })

  it('openExternal + read 둘 다 실패 → failed', async () => {
    const readErr = new Error('ENOENT')
    const api = makeApi({
      openExternal: vi.fn(() => Promise.reject(new Error('reject'))),
      read: vi.fn(() => Promise.reject(readErr))
    })
    const out = await openOrLoadFile('/missing.txt', api)
    expect(out).toEqual({ kind: 'failed', error: readErr })
  })

  it('Electron 의 openExternal 자체는 실패할 수 있음 (shell.openPath 가 OS 에러 반환) — fallback 으로 read 시도', async () => {
    // 사용자 머신에서 default app 미설정 등으로 shell.openPath 가 error 메시지를
    // throw 한 경우. 그래도 read 가 가능하면 loaded 로 떨어진다.
    const api = makeApi({
      openExternal: vi.fn(() =>
        Promise.reject(new Error('No application available'))
      ),
      read: vi.fn(() => Promise.resolve('contents'))
    })
    const out = await openOrLoadFile('/x.txt', api)
    expect(out).toEqual({ kind: 'loaded', text: 'contents' })
  })

  it('순서 보장 — openExternal 이 먼저, 실패 시에만 read', async () => {
    const calls: string[] = []
    const api = makeApi({
      openExternal: vi.fn(async () => {
        calls.push('openExternal')
        throw new Error('reject')
      }),
      read: vi.fn(async () => {
        calls.push('read')
        return 't'
      })
    })
    await openOrLoadFile('/p', api)
    expect(calls).toEqual(['openExternal', 'read'])
  })
})
