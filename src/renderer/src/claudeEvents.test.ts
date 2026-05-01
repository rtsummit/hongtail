import { describe, expect, it } from 'vitest'
import { parseClaudeEvent } from './claudeEvents'

describe('parseClaudeEvent — 잘못된 입력', () => {
  it('null/undefined/non-object 는 빈 배열', () => {
    expect(parseClaudeEvent(null)).toEqual([])
    expect(parseClaudeEvent(undefined)).toEqual([])
    expect(parseClaudeEvent('foo')).toEqual([])
    expect(parseClaudeEvent(42)).toEqual([])
  })
  it('알 수 없는 type 은 빈 배열', () => {
    expect(parseClaudeEvent({ type: 'unknown' })).toEqual([])
    expect(parseClaudeEvent({})).toEqual([])
  })
  it('system event 는 UI 에서 무시', () => {
    expect(parseClaudeEvent({ type: 'system', subtype: 'init' })).toEqual([])
  })
})

describe('parseClaudeEvent — assistant text', () => {
  it('text content block 을 assistant-text 로', () => {
    expect(
      parseClaudeEvent({
        type: 'assistant',
        message: { content: [{ type: 'text', text: '안녕' }] }
      })
    ).toEqual([{ kind: 'assistant-text', text: '안녕' }])
  })
  it('content 가 string 이면 그대로 assistant-text', () => {
    expect(
      parseClaudeEvent({
        type: 'assistant',
        message: { content: 'hi' }
      })
    ).toEqual([{ kind: 'assistant-text', text: 'hi' }])
  })
  it('sub-agent (parent_tool_use_id) 의 text 는 hide', () => {
    expect(
      parseClaudeEvent({
        type: 'assistant',
        parent_tool_use_id: 'tool_x',
        message: { content: [{ type: 'text', text: '내부 reasoning' }] }
      })
    ).toEqual([])
  })
  it('isSidechain=true 의 text 도 hide', () => {
    expect(
      parseClaudeEvent({
        type: 'assistant',
        isSidechain: true,
        message: { content: 'agent monologue' }
      })
    ).toEqual([])
  })
})

describe('parseClaudeEvent — tool_use / tool_result', () => {
  it('tool_use 추출', () => {
    expect(
      parseClaudeEvent({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file: 'x.ts' } }
          ]
        }
      })
    ).toEqual([
      { kind: 'tool-use', toolUseId: 'tu_1', name: 'Read', input: { file: 'x.ts' } }
    ])
  })
  it('sub-agent 의 tool_use 는 표시 (텍스트만 hide)', () => {
    const out = parseClaudeEvent({
      type: 'assistant',
      parent_tool_use_id: 'parent',
      message: {
        content: [{ type: 'tool_use', id: 'tu_2', name: 'Bash', input: {} }]
      }
    })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'tool-use', name: 'Bash' })
  })
  it('tool_result 추출', () => {
    expect(
      parseClaudeEvent({
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tu_1', content: 'result text', is_error: false }
          ]
        }
      })
    ).toEqual([
      { kind: 'tool-result', toolUseId: 'tu_1', content: 'result text', isError: false }
    ])
  })
  it('필드 누락 시 default 채움', () => {
    expect(
      parseClaudeEvent({
        type: 'assistant',
        message: { content: [{ type: 'tool_use' }] }
      })
    ).toEqual([{ kind: 'tool-use', toolUseId: '', name: 'unknown', input: undefined }])
  })
})

describe('parseClaudeEvent — user text', () => {
  it('일반 user 텍스트', () => {
    expect(
      parseClaudeEvent({
        type: 'user',
        message: { content: '질문' }
      })
    ).toEqual([{ kind: 'user-text', text: '질문' }])
  })
  it('isMeta 는 무시', () => {
    expect(
      parseClaudeEvent({
        type: 'user',
        isMeta: true,
        message: { content: '메타' }
      })
    ).toEqual([])
  })
  it('command-name 태그 → command-invoke block', () => {
    expect(
      parseClaudeEvent({
        type: 'user',
        message: {
          content:
            '<command-name>compact</command-name><command-args>foo</command-args><command-message>요약</command-message>'
        }
      })
    ).toEqual([
      { kind: 'command-invoke', name: 'compact', args: 'foo', message: '요약' }
    ])
  })
  it('command-name 만 있고 args/message 누락도 처리', () => {
    expect(
      parseClaudeEvent({
        type: 'user',
        message: { content: '<command-name>help</command-name>' }
      })
    ).toEqual([{ kind: 'command-invoke', name: 'help', args: undefined, message: undefined }])
  })
  it('local-command-stdout → command-output block', () => {
    expect(
      parseClaudeEvent({
        type: 'user',
        message: {
          content: '<local-command-stdout>hello world</local-command-stdout>'
        }
      })
    ).toEqual([{ kind: 'command-output', stream: 'stdout', text: 'hello world' }])
  })
  it('local-command-stderr 도 동일', () => {
    expect(
      parseClaudeEvent({
        type: 'user',
        message: {
          content: '<local-command-stderr>err</local-command-stderr>'
        }
      })
    ).toEqual([{ kind: 'command-output', stream: 'stderr', text: 'err' }])
  })
  it('빈 local-command-stdout 은 skip', () => {
    expect(
      parseClaudeEvent({
        type: 'user',
        message: { content: '<local-command-stdout>   </local-command-stdout>' }
      })
    ).toEqual([])
  })
  it('system-reminder 시작 텍스트는 hide', () => {
    expect(
      parseClaudeEvent({
        type: 'user',
        message: { content: '<system-reminder>noise</system-reminder>' }
      })
    ).toEqual([])
  })
  it('Request interrupted by user 는 system 으로 변환', () => {
    expect(
      parseClaudeEvent({
        type: 'user',
        message: { content: '[Request interrupted by user]' }
      })
    ).toEqual([{ kind: 'system', text: '— 중단됨 —' }])
  })
})

describe('parseClaudeEvent — 시스템 이벤트', () => {
  it('result 의 success subtype 은 hide', () => {
    expect(parseClaudeEvent({ type: 'result', subtype: 'success' })).toEqual([])
  })
  it('result 의 다른 subtype 은 system 노트로', () => {
    expect(parseClaudeEvent({ type: 'result', subtype: 'error_during_execution' })).toEqual([
      { kind: 'system', text: '결과: error_during_execution' }
    ])
  })
  it('stderr → system block', () => {
    expect(parseClaudeEvent({ type: 'stderr', data: 'oops' })).toEqual([
      { kind: 'system', text: '[stderr] oops' }
    ])
  })
  it('parse_error 는 raw 200 chars 까지', () => {
    const raw = 'a'.repeat(500)
    const out = parseClaudeEvent({ type: 'parse_error', raw })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'system' })
    expect((out[0] as { text: string }).text.length).toBeLessThan(220)
  })
  it('spawn_error → error block', () => {
    expect(parseClaudeEvent({ type: 'spawn_error', error: 'ENOENT' })).toEqual([
      { kind: 'error', text: '프로세스 시작 실패: ENOENT' }
    ])
  })
  it('closed 는 종료 코드 표시', () => {
    expect(parseClaudeEvent({ type: 'closed', code: 0 })).toEqual([
      { kind: 'system', text: '[프로세스 종료 code=0]' }
    ])
    expect(parseClaudeEvent({ type: 'closed', code: null })).toEqual([
      { kind: 'system', text: '[프로세스 종료 code=?]' }
    ])
  })
})

describe('parseClaudeEvent — 복합 콘텐츠', () => {
  it('text + tool_use 가 한 message 안에 있을 때 모두 추출', () => {
    const out = parseClaudeEvent({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: '먼저 보겠습니다' },
          { type: 'tool_use', id: 't1', name: 'Read', input: {} }
        ]
      }
    })
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ kind: 'assistant-text' })
    expect(out[1]).toMatchObject({ kind: 'tool-use' })
  })
  it('null/잘못된 content block 은 skip', () => {
    expect(
      parseClaudeEvent({
        type: 'assistant',
        message: { content: [null, undefined, { type: 'text', text: 'ok' }] }
      })
    ).toEqual([{ kind: 'assistant-text', text: 'ok' }])
  })
})
