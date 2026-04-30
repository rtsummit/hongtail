import { describe, expect, it } from 'vitest'
import {
  extractAssistantModel,
  extractContextTokens,
  extractContextWindowFromResult,
  extractControlResponse,
  extractInit,
  extractPermissionModeEvent,
  extractRateLimit,
  extractResultTotals,
  extractUsage,
  formatElapsed,
  formatModelDisplay,
  formatRateLimit,
  formatTokens,
  isAssistantTurnEnd,
  isResultEvent,
  parseContextWindowFromModel,
  patchSessionStatus,
  pctClass,
  pickVerb
} from './sessionStatus'
import type { SessionStatus } from './types'

describe('formatTokens', () => {
  it('1000 미만은 그대로', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(1)).toBe('1')
    expect(formatTokens(999)).toBe('999')
  })
  it('천 단위는 k', () => {
    expect(formatTokens(1000)).toBe('1.0k')
    expect(formatTokens(12_345)).toBe('12.3k')
    expect(formatTokens(999_999)).toBe('1000.0k')
  })
  it('백만 이상은 M', () => {
    expect(formatTokens(1_000_000)).toBe('1.0M')
    expect(formatTokens(2_500_000)).toBe('2.5M')
  })
})

describe('pctClass', () => {
  it('70 미만은 ok', () => {
    expect(pctClass(0)).toBe('ok')
    expect(pctClass(69.9)).toBe('ok')
  })
  it('70~89 는 warn', () => {
    expect(pctClass(70)).toBe('warn')
    expect(pctClass(89)).toBe('warn')
  })
  it('90 이상은 crit', () => {
    expect(pctClass(90)).toBe('crit')
    expect(pctClass(120)).toBe('crit')
  })
})

describe('formatElapsed', () => {
  it('초 단위 floor', () => {
    expect(formatElapsed(0, 0)).toBe('0s')
    expect(formatElapsed(0, 999)).toBe('0s')
    expect(formatElapsed(0, 1500)).toBe('1s')
    expect(formatElapsed(1000, 5000)).toBe('4s')
  })
  it('past 시점은 0 으로 clamp', () => {
    expect(formatElapsed(5000, 1000)).toBe('0s')
  })
})

describe('pickVerb', () => {
  it('항상 string 반환', () => {
    for (let i = 0; i < 20; i++) {
      const v = pickVerb()
      expect(typeof v).toBe('string')
      expect(v.length).toBeGreaterThan(0)
    }
  })
})

describe('extractUsage', () => {
  it('null/비-object 는 null', () => {
    expect(extractUsage(null)).toBeNull()
    expect(extractUsage(undefined)).toBeNull()
    expect(extractUsage('foo')).toBeNull()
    expect(extractUsage(42)).toBeNull()
  })
  it('event.usage 우선', () => {
    expect(
      extractUsage({
        usage: { input_tokens: 10, output_tokens: 5 }
      })
    ).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: undefined,
      cacheCreationTokens: undefined
    })
  })
  it('message.usage fallback', () => {
    expect(
      extractUsage({
        type: 'assistant',
        message: {
          usage: {
            input_tokens: 1,
            output_tokens: 2,
            cache_read_input_tokens: 3,
            cache_creation_input_tokens: 4
          }
        }
      })
    ).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheCreationTokens: 4
    })
  })
  it('sub-agent (parent_tool_use_id 있는 assistant) 는 무시', () => {
    expect(
      extractUsage({
        type: 'assistant',
        parent_tool_use_id: 'tool_xyz',
        message: { usage: { input_tokens: 99 } }
      })
    ).toBeNull()
  })
  it('result 이벤트의 sub-agent 가드는 적용 안 됨 (turn 전체 합계)', () => {
    expect(
      extractUsage({
        type: 'result',
        parent_tool_use_id: 'tool_xyz',
        usage: { output_tokens: 100 }
      })
    ).toEqual({
      inputTokens: undefined,
      outputTokens: 100,
      cacheReadTokens: undefined,
      cacheCreationTokens: undefined
    })
  })
})

describe('isResultEvent', () => {
  it('type==="result" 만 true', () => {
    expect(isResultEvent({ type: 'result' })).toBe(true)
    expect(isResultEvent({ type: 'assistant' })).toBe(false)
    expect(isResultEvent({})).toBe(false)
    expect(isResultEvent(null)).toBe(false)
  })
})

describe('isAssistantTurnEnd', () => {
  it('end_turn / stop_sequence 가 turn end', () => {
    expect(
      isAssistantTurnEnd({
        type: 'assistant',
        message: { stop_reason: 'end_turn' }
      })
    ).toBe(true)
    expect(
      isAssistantTurnEnd({
        type: 'assistant',
        message: { stop_reason: 'stop_sequence' }
      })
    ).toBe(true)
  })
  it('tool_use 는 turn 종료 아님 (다음 chunk 가 이어짐)', () => {
    expect(
      isAssistantTurnEnd({
        type: 'assistant',
        message: { stop_reason: 'tool_use' }
      })
    ).toBe(false)
  })
  it('sub-agent 는 무시', () => {
    expect(
      isAssistantTurnEnd({
        type: 'assistant',
        parent_tool_use_id: 'x',
        message: { stop_reason: 'end_turn' }
      })
    ).toBe(false)
    expect(
      isAssistantTurnEnd({
        type: 'assistant',
        isSidechain: true,
        message: { stop_reason: 'end_turn' }
      })
    ).toBe(false)
  })
  it('non-assistant 는 false', () => {
    expect(isAssistantTurnEnd({ type: 'user' })).toBe(false)
    expect(isAssistantTurnEnd({})).toBe(false)
    expect(isAssistantTurnEnd(null)).toBe(false)
  })
})

describe('extractInit', () => {
  it('system/init 만 매칭', () => {
    expect(
      extractInit({
        type: 'system',
        subtype: 'init',
        model: 'claude-opus-4-7[1m]',
        permissionMode: 'plan'
      })
    ).toEqual({
      model: 'claude-opus-4-7[1m]',
      permissionMode: 'plan',
      contextWindow: 1_000_000
    })
  })
  it('permissionMode 누락 시 default', () => {
    expect(
      extractInit({
        type: 'system',
        subtype: 'init',
        model: 'claude-sonnet-4-6'
      })?.permissionMode
    ).toBe('default')
  })
  it('model 이 string 아니면 null', () => {
    expect(
      extractInit({
        type: 'system',
        subtype: 'init',
        model: 123
      })
    ).toBeNull()
  })
  it('subtype 다르면 null', () => {
    expect(
      extractInit({
        type: 'system',
        subtype: 'other',
        model: 'x'
      })
    ).toBeNull()
  })
})

describe('extractAssistantModel', () => {
  it('assistant 의 message.model 추출', () => {
    expect(
      extractAssistantModel({
        type: 'assistant',
        message: { model: 'claude-haiku-4-5' }
      })
    ).toBe('claude-haiku-4-5')
  })
  it('non-assistant·model 없음 → null', () => {
    expect(extractAssistantModel({ type: 'user', message: { model: 'x' } })).toBeNull()
    expect(extractAssistantModel({ type: 'assistant' })).toBeNull()
    expect(extractAssistantModel({ type: 'assistant', message: {} })).toBeNull()
  })
})

describe('extractPermissionModeEvent', () => {
  it('permission-mode type 만 매칭', () => {
    expect(
      extractPermissionModeEvent({
        type: 'permission-mode',
        permissionMode: 'auto'
      })
    ).toBe('auto')
    expect(extractPermissionModeEvent({ type: 'system' })).toBeNull()
    expect(
      extractPermissionModeEvent({ type: 'permission-mode', permissionMode: 42 })
    ).toBeNull()
  })
})

describe('parseContextWindowFromModel', () => {
  it('[1m] suffix 는 1_000_000', () => {
    expect(parseContextWindowFromModel('claude-opus-4-7[1m]')).toBe(1_000_000)
    expect(parseContextWindowFromModel('foo[200k]')).toBe(200_000)
    expect(parseContextWindowFromModel('foo[2M]')).toBe(2_000_000)
  })
  it('suffix 없으면 undefined', () => {
    expect(parseContextWindowFromModel('claude-opus-4-7')).toBeUndefined()
    expect(parseContextWindowFromModel('plain')).toBeUndefined()
  })
})

describe('formatModelDisplay', () => {
  it('family 만 capitalize', () => {
    expect(formatModelDisplay('claude-opus-4-7[1m]')).toBe('Opus')
    expect(formatModelDisplay('claude-sonnet-4-6')).toBe('Sonnet')
    expect(formatModelDisplay('claude-haiku-4-5')).toBe('Haiku')
  })
  it('패턴 안 맞으면 원본 그대로', () => {
    expect(formatModelDisplay('gpt-4')).toBe('gpt-4')
    expect(formatModelDisplay('')).toBe('')
  })
})

describe('extractContextTokens', () => {
  it('input + cache_read + cache_creation 합계', () => {
    expect(
      extractContextTokens({
        type: 'assistant',
        message: {
          usage: {
            input_tokens: 10,
            cache_read_input_tokens: 20,
            cache_creation_input_tokens: 5
          }
        }
      })
    ).toBe(35)
  })
  it('sum 0 이면 null', () => {
    expect(
      extractContextTokens({
        type: 'assistant',
        message: { usage: {} }
      })
    ).toBeNull()
  })
  it('sub-agent 는 null', () => {
    expect(
      extractContextTokens({
        type: 'assistant',
        parent_tool_use_id: 'x',
        message: { usage: { input_tokens: 100 } }
      })
    ).toBeNull()
  })
  it('non-assistant 는 null', () => {
    expect(extractContextTokens({ type: 'result' })).toBeNull()
  })
})

describe('extractResultTotals', () => {
  it('result 이벤트의 모든 token + cost 추출', () => {
    expect(
      extractResultTotals({
        type: 'result',
        usage: {
          input_tokens: 1,
          cache_read_input_tokens: 2,
          cache_creation_input_tokens: 3,
          output_tokens: 4
        },
        total_cost_usd: 0.0123
      })
    ).toEqual({
      inputTokens: 1,
      cacheReadTokens: 2,
      cacheCreationTokens: 3,
      outputTokens: 4,
      costUsd: 0.0123
    })
  })
  it('필드 누락 시 0 으로', () => {
    expect(
      extractResultTotals({
        type: 'result',
        usage: { output_tokens: 10 }
      })
    ).toEqual({
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 10,
      costUsd: 0
    })
  })
  it('non-result 는 null', () => {
    expect(extractResultTotals({ type: 'assistant', usage: {} })).toBeNull()
  })
})

describe('extractContextWindowFromResult', () => {
  const event = {
    type: 'result',
    modelUsage: {
      'claude-opus-4-7[1m]': { contextWindow: 1_000_000 },
      'claude-haiku-4-5': { contextWindow: 200_000 }
    }
  }
  it('preferredModel 매칭 우선', () => {
    expect(extractContextWindowFromResult(event, 'claude-opus-4-7[1m]')).toBe(1_000_000)
  })
  it('preferredModel 없거나 매칭 안 되면 첫 번째 양수 사용', () => {
    expect(extractContextWindowFromResult(event)).toBe(1_000_000)
    expect(extractContextWindowFromResult(event, 'unknown')).toBe(1_000_000)
  })
  it('non-result 또는 modelUsage 없음 → null', () => {
    expect(extractContextWindowFromResult({ type: 'assistant' })).toBeNull()
    expect(extractContextWindowFromResult({ type: 'result' })).toBeNull()
  })
})

describe('extractControlResponse', () => {
  it('성공 응답', () => {
    expect(
      extractControlResponse({
        type: 'control_response',
        response: { request_id: 'req_1', subtype: 'success' }
      })
    ).toEqual({ requestId: 'req_1', success: true, error: undefined })
  })
  it('실패 응답', () => {
    expect(
      extractControlResponse({
        type: 'control_response',
        response: { request_id: 'req_2', subtype: 'error', error: 'bad' }
      })
    ).toEqual({ requestId: 'req_2', success: false, error: 'bad' })
  })
  it('request_id 없으면 null', () => {
    expect(
      extractControlResponse({
        type: 'control_response',
        response: { subtype: 'success' }
      })
    ).toBeNull()
  })
  it('non-control_response 는 null', () => {
    expect(extractControlResponse({ type: 'result' })).toBeNull()
  })
})

describe('extractRateLimit', () => {
  it('rate_limit_event 만 매칭', () => {
    expect(
      extractRateLimit({
        type: 'rate_limit_event',
        rate_limit_info: {
          status: 'warned',
          resetsAt: 1700000000,
          rateLimitType: 'five_hour'
        }
      })
    ).toEqual({
      status: 'warned',
      resetsAt: 1700000000,
      rateLimitType: 'five_hour',
      isUsingOverage: undefined,
      overageStatus: undefined
    })
  })
  it('non-rate-limit 는 null', () => {
    expect(extractRateLimit({ type: 'result' })).toBeNull()
  })
})

describe('formatRateLimit', () => {
  it('window label + 리셋 시간', () => {
    // 고정된 nowMs 와 그로부터 2h30m 후의 resetsAt 으로 테스트 — Math.floor
    // 의 분 단위 truncation 까지 결정적으로 검증.
    const nowMs = 1_700_000_000_000
    const resetsAt = Math.floor(nowMs / 1000) + 3600 * 2 + 60 * 30
    const out = formatRateLimit(
      { status: 'allowed', rateLimitType: 'five_hour', resetsAt },
      nowMs
    )
    expect(out).toContain('5h')
    expect(out).toContain('리셋 2h 30m')
  })
  it('reset 지나면 "리셋됨"', () => {
    const past = Math.floor(Date.now() / 1000) - 100
    expect(
      formatRateLimit({ status: 'allowed', resetsAt: past }, Date.now())
    ).toContain('리셋됨')
  })
  it('warned 상태는 한도 임박', () => {
    expect(formatRateLimit({ status: 'warned' })).toContain('⚠ 한도 임박')
  })
  it('rejected 상태는 차단', () => {
    expect(formatRateLimit({ status: 'rejected' })).toContain('🚫 차단')
  })
  it('overage 표시', () => {
    expect(formatRateLimit({ status: 'allowed', isUsingOverage: true })).toContain('overage')
  })
  it('알려지지 않은 window type 은 raw', () => {
    expect(formatRateLimit({ status: 'allowed', rateLimitType: 'custom_x' })).toContain('custom_x')
  })
})

describe('patchSessionStatus', () => {
  const baseStatus: SessionStatus = { thinking: true, model: 'claude-opus-4-7' }

  it('partial patch 는 기존 status 와 merge', () => {
    const prev = { sid1: baseStatus }
    const next = patchSessionStatus(prev, 'sid1', { permissionMode: 'plan' })
    expect(next.sid1).toEqual({
      thinking: true, // 보존
      model: 'claude-opus-4-7',
      permissionMode: 'plan'
    })
    expect(next).not.toBe(prev) // 새 객체
    expect(next.sid1).not.toBe(baseStatus) // 새 status
  })

  it('thinking 미명시 시 기존값 유지', () => {
    const next = patchSessionStatus({ sid: { thinking: true } }, 'sid', { model: 'x' })
    expect(next.sid.thinking).toBe(true)
  })

  it('thinking 미명시 + 기존 status 없음 → false 디폴트', () => {
    const next = patchSessionStatus({}, 'sid', { model: 'x' })
    expect(next.sid).toEqual({ thinking: false, model: 'x' })
  })

  it('patch 가 null 반환하는 함수면 prev 그대로', () => {
    const prev = { sid: baseStatus }
    const next = patchSessionStatus(prev, 'sid', () => null)
    expect(next).toBe(prev)
  })

  it('patch 함수에 cur 전달', () => {
    const prev = { sid: { thinking: false, model: 'a' } as SessionStatus }
    const next = patchSessionStatus(prev, 'sid', (cur) => ({
      model: `${cur?.model}-modified`
    }))
    expect(next.sid.model).toBe('a-modified')
  })

  it('새 sessionId 도 추가', () => {
    const prev = { existing: { thinking: false } }
    const next = patchSessionStatus(prev, 'newSid', { model: 'm' })
    expect(next.existing).toBe(prev.existing) // 다른 키는 ref 보존
    expect(next.newSid).toEqual({ thinking: false, model: 'm' })
  })

  it('patch 의 thinking 명시는 그대로 적용', () => {
    const next = patchSessionStatus({ sid: { thinking: false } }, 'sid', { thinking: true })
    expect(next.sid.thinking).toBe(true)
  })
})
