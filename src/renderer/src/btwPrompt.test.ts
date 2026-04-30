import { describe, expect, it } from 'vitest'
import { buildBtwSystemPrompt } from './btwPrompt'
import type { Block } from './types'

const userBlock = (text: string): Block => ({ kind: 'user-text', text })
const asstBlock = (text: string): Block => ({ kind: 'assistant-text', text })

describe('buildBtwSystemPrompt', () => {
  it('main history 를 [user]/[assistant] 라인으로 직렬화', () => {
    const out = buildBtwSystemPrompt(
      [userBlock('Q1'), asstBlock('A1'), userBlock('Q2')],
      []
    )
    expect(out).toContain('[user]\nQ1')
    expect(out).toContain('[assistant]\nA1')
    expect(out).toContain('[user]\nQ2')
  })

  it('text 가 아닌 block (tool-use 등) 은 직렬화에서 제외', () => {
    // 고유 식별자 (tool-use 의 name·toolUseId·input value) 를 본문 텍스트로
    // 안 흘리는지 확인. system prompt header 의 "Read" 문구와 충돌 안 나게 unique 한 토큰 사용.
    const uniqueTool = 'ZZZ_UniqueToolName_QQQ'
    const uniqueId = 'tu_unique_42'
    const uniqueInput = { sentinel: 'XYZ_unique_input_value_LMN' }
    const out = buildBtwSystemPrompt(
      [
        userBlock('Q'),
        { kind: 'tool-use', toolUseId: uniqueId, name: uniqueTool, input: uniqueInput },
        asstBlock('A')
      ],
      []
    )
    expect(out).toContain('[user]\nQ')
    expect(out).toContain('[assistant]\nA')
    expect(out).not.toContain(uniqueTool)
    expect(out).not.toContain(uniqueId)
    expect(out).not.toContain('XYZ_unique_input_value_LMN')
  })

  it('main 비어있으면 (empty) placeholder', () => {
    const out = buildBtwSystemPrompt([], [])
    expect(out).toContain('=== MAIN CONVERSATION SNAPSHOT (read-only) ===')
    expect(out).toContain('(empty)')
  })

  it('btw history 가 비어있으면 PREVIOUS SIDE QUESTIONS 섹션 자체가 없음', () => {
    const out = buildBtwSystemPrompt([userBlock('Q')], [])
    expect(out).not.toContain('PREVIOUS SIDE QUESTIONS')
  })

  it('btw history 가 있으면 별도 섹션 추가', () => {
    const out = buildBtwSystemPrompt(
      [userBlock('main')],
      [userBlock('side1'), asstBlock('answer1')]
    )
    expect(out).toContain('=== PREVIOUS SIDE QUESTIONS ===')
    expect(out).toContain('[user]\nside1')
    expect(out).toContain('[assistant]\nanswer1')
  })

  it('80k 초과 시 head 부터 truncate', () => {
    const longText = 'x'.repeat(100_000)
    const out = buildBtwSystemPrompt([userBlock(longText)], [])
    expect(out.length).toBeLessThanOrEqual(80_000 + 60) // 약간의 marker 길이 허용
    expect(out).toContain('[... earlier context truncated ...]')
  })

  it('NO tools 안내가 늘 포함', () => {
    expect(buildBtwSystemPrompt([], [])).toContain('NO tools available')
  })
})
