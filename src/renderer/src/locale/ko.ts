// 한국어 dict. 키는 dotted path (e.g. 'settings.title'). 새 string 추가 시
// en.ts 에도 같은 키 추가해 동기 유지. 누락 시 useT 가 영어 fallback 후 key 노출.

export const ko: Record<string, string> = {
  // === Settings modal ===
  'settings.title': '설정',
  'settings.close': '닫기',
  'settings.font': '폰트',
  'settings.fontSize': '글자 크기',
  'settings.loadingFonts': '시스템 폰트 목록 가져오는 중…',
  'settings.fontHint': '폰트는 추가한 순서대로 fallback 됩니다 (왼쪽이 우선). ‹ › 로 우선순위 변경.',
  'settings.readonlyChunkSize': '읽기 전용 한 번에 불러올 줄 수',
  'settings.toolCardsDefaultOpen': '기본으로 펼쳐서 표시할 도구 카드',
  'settings.language': '언어',
  'settings.language.auto': '자동 (브라우저 설정)',
  'settings.language.ko': '한국어',
  'settings.language.en': 'English',
  'settings.web.title': '웹 모드',
  'settings.web.password': '비밀번호',
  'settings.web.passwordSet': '(설정됨)',
  'settings.web.passwordUnset': '— 미설정',
  'settings.web.passwordPlaceholder': '새 비밀번호 (8자 이상)',
  'settings.web.passwordConfirm': '비밀번호 확인',
  'settings.web.passwordSubmitSet': '설정',
  'settings.web.passwordSubmitChange': '변경',
  'settings.web.enabled': '웹 서버 활성화 (외부 브라우저 / 모바일에서 접속)',
  'settings.web.port': '포트',
  'settings.reset': '기본값으로',
  'settings.done': '완료',

  // === Chat composer ===
  'chat.placeholder.desktop':
    '메시지 입력 (Enter: 전송, Shift+Enter: 줄바꿈, /: 명령, 📎: 파일)',
  'chat.placeholder.mobile': '메시지 입력 (전송 버튼으로 보내기)',
  'chat.send': '전송',
  'chat.interrupt': '진행 중 turn 중단 (세션은 유지)',
  'chat.attach.title': '파일 첨부 (이미지 / 일반 파일)',
  'chat.attach.aria': '파일 첨부',

  // === Readonly activation ===
  'chat.readonly.label': '이전 대화 — 읽기 전용',
  'chat.activate.full': 'Full로 활성화',
  'chat.activate.full.short': 'Full',
  'chat.activate.summary': 'Summary로 활성화',
  'chat.activate.summary.short': 'Summary',
  'chat.activate.terminal': '터미널로 열기',
  'chat.activate.terminal.short': 'Terminal',

  // === Sidebar ===
  'sidebar.addWorkspace': 'Workspace 추가',
  'sidebar.minimize': '사이드바 접기',
  'sidebar.expand': '사이드바 펼치기',
  'sidebar.settings': '설정',
  'sidebar.filter.all': '모두',
  'sidebar.filter.active': '활성',
  'sidebar.filter.days': '{n}일',
  'sidebar.toggle.aria': '사이드바 열기/닫기',

  // === Side chat ===
  'sideChat.toggle.aria': 'BTW 사이드 챗 열기/닫기',
  'sideChat.subtitle': '메인 작업을 멈추지 않는 사이드 질문',
  'sideChat.clear': '지우기',
  'sideChat.collapseTitle': '패널 접기',
  'sideChat.expandTitle': 'BTW 사이드 챗 펼치기',
  'sideChat.placeholder.enabled': 'BTW 질문 (Enter 전송)',
  'sideChat.placeholder.disabled': '메인 세션을 먼저 선택하세요',
  'sideChat.send': '보내기',
  'sideChat.cancel': '중단',
  'sideChat.thinking': '생각 중…',
  'sideChat.empty.noSession': '메인 세션을 선택하면 그 컨텍스트로 BTW 질문을 할 수 있습니다.',
  'sideChat.empty.helper':
    '도구 없이, 메인 대화 컨텍스트만 보고 답하는 사이드 채팅입니다.\n메인 작업을 방해하지 않고 자유롭게 질문하세요.'
}
