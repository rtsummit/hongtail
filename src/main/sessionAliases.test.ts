import { describe, expect, it } from 'vitest'
import { parseRenameRecord } from './sessionAliases'

describe('parseRenameRecord', () => {
  const validRecord = {
    type: 'system',
    subtype: 'local_command',
    content: '<local-command-stdout>Session renamed to: my-alias</local-command-stdout>',
    timestamp: '2026-04-30T10:00:00Z'
  }

  it('정상 rename record 에서 alias·timestamp 추출', () => {
    expect(parseRenameRecord(validRecord)).toEqual({
      alias: 'my-alias',
      setAt: '2026-04-30T10:00:00Z'
    })
  })

  it('한글 alias 도 처리', () => {
    expect(
      parseRenameRecord({
        ...validRecord,
        content:
          '<local-command-stdout>Session renamed to: 한글 별칭</local-command-stdout>'
      })?.alias
    ).toBe('한글 별칭')
  })

  it('content 의 trailing whitespace trim', () => {
    expect(
      parseRenameRecord({
        ...validRecord,
        content:
          '<local-command-stdout>Session renamed to:   spaced  </local-command-stdout>'
      })?.alias
    ).toBe('spaced')
  })

  it('closing tag 가 없어도 prefix 이후 내용을 alias 로', () => {
    expect(
      parseRenameRecord({
        ...validRecord,
        content: '<local-command-stdout>Session renamed to: open-tag-only'
      })?.alias
    ).toBe('open-tag-only')
  })

  it('non-string record → null', () => {
    expect(parseRenameRecord(null)).toBeNull()
    expect(parseRenameRecord(undefined)).toBeNull()
    expect(parseRenameRecord('foo')).toBeNull()
    expect(parseRenameRecord(42)).toBeNull()
  })

  it('type 이 system 아니면 null', () => {
    expect(parseRenameRecord({ ...validRecord, type: 'user' })).toBeNull()
  })

  it('subtype 이 local_command 아니면 null', () => {
    expect(parseRenameRecord({ ...validRecord, subtype: 'init' })).toBeNull()
  })

  it('content 가 RENAME_PREFIX 로 시작 안 하면 null', () => {
    expect(
      parseRenameRecord({
        ...validRecord,
        content: '<local-command-stdout>Other output</local-command-stdout>'
      })
    ).toBeNull()
  })

  it('content 누락이나 string 아니면 null', () => {
    expect(parseRenameRecord({ ...validRecord, content: undefined })).toBeNull()
    expect(parseRenameRecord({ ...validRecord, content: 42 })).toBeNull()
  })

  it('timestamp 누락이나 string 아니면 null', () => {
    expect(parseRenameRecord({ ...validRecord, timestamp: undefined })).toBeNull()
    expect(parseRenameRecord({ ...validRecord, timestamp: 12345 })).toBeNull()
  })

  it('alias 가 비어있으면 (prefix 만 있고 alias 없음) null', () => {
    expect(
      parseRenameRecord({
        ...validRecord,
        content: '<local-command-stdout>Session renamed to: </local-command-stdout>'
      })
    ).toBeNull()
  })
})
