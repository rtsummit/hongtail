// Diff 보기 모드. 사용자 선호도는 localStorage 에 저장되지만 모바일 인라인
// 에선 side-by-side 가 좁은 폭에서 의미 없어 unified 강제. 모달 안에서는
// 가로 스크롤로 양쪽 비교 가능하니 양 모드 허용. 결정 로직은 pure 라 따로 빼서 테스트.
export type DiffMode = 'unified' | 'side'

export const DIFF_MODE_KEY = 'hongtail.diffMode'

export function loadDiffMode(): DiffMode {
  if (typeof localStorage === 'undefined') return 'unified'
  return localStorage.getItem(DIFF_MODE_KEY) === 'side' ? 'side' : 'unified'
}

export function saveDiffMode(m: DiffMode): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(DIFF_MODE_KEY, m)
}

// 사용자가 선택한 mode 와 컨텍스트 (inModal·isMobile) 로부터 실제 화면에
// 그릴 모드를 계산. side 가 허용되지 않을 땐 unified 로 fallback.
export function effectiveDiffMode(
  mode: DiffMode,
  inModal: boolean,
  isMobile: boolean
): DiffMode {
  const allowSide = inModal || !isMobile
  return mode === 'side' && !allowSide ? 'unified' : mode
}

export function isSideAllowed(inModal: boolean, isMobile: boolean): boolean {
  return inModal || !isMobile
}
