import { describe, expect, it } from 'vitest'
import { effectiveDiffMode, isSideAllowed } from './diffMode'

describe('isSideAllowed', () => {
  it('데스크톱은 항상 side 허용', () => {
    expect(isSideAllowed(false, false)).toBe(true)
    expect(isSideAllowed(true, false)).toBe(true)
  })

  it('모바일 인라인은 side 안 허용', () => {
    expect(isSideAllowed(false, true)).toBe(false)
  })

  it('모바일 모달은 side 허용 (가로 스크롤 가능)', () => {
    expect(isSideAllowed(true, true)).toBe(true)
  })
})

describe('effectiveDiffMode', () => {
  it('데스크톱 인라인 — 사용자 선택 그대로', () => {
    expect(effectiveDiffMode('unified', false, false)).toBe('unified')
    expect(effectiveDiffMode('side', false, false)).toBe('side')
  })

  it('데스크톱 모달 — 사용자 선택 그대로', () => {
    expect(effectiveDiffMode('unified', true, false)).toBe('unified')
    expect(effectiveDiffMode('side', true, false)).toBe('side')
  })

  it('모바일 인라인 — side 선호여도 unified 강제', () => {
    expect(effectiveDiffMode('side', false, true)).toBe('unified')
    expect(effectiveDiffMode('unified', false, true)).toBe('unified')
  })

  it('모바일 모달 — side 그대로 (가로 스크롤로 비교 가능)', () => {
    expect(effectiveDiffMode('side', true, true)).toBe('side')
    expect(effectiveDiffMode('unified', true, true)).toBe('unified')
  })

  it('localStorage 의 사용자 선호도는 영향 없음 — pure 함수', () => {
    // mode 인자만 보고 결정. localStorage 키 자체엔 손대지 않는다는 점을
    // 호출 결과 일관성으로 확인.
    expect(effectiveDiffMode('side', false, true)).toBe('unified')
    expect(effectiveDiffMode('side', false, true)).toBe('unified')
  })
})
