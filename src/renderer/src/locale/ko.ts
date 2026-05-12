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
  'settings.defaultPermissionMode': '새 대화 시작 권한 모드',
  'settings.defaultPermissionModeHint':
    'claude --permission-mode 의 기본값. 도중 변경은 상단 mode 메뉴 / Shift+Tab.',
  'settings.folderOpenCommand': '폴더 열기 명령',
  'settings.folderOpenCommandPlaceholder': '비워두면 OS 기본 (탐색기)',
  'settings.folderOpenCommandHint':
    '워크스페이스 우클릭 → 폴더 열기 에서 실행. %1 자리에 폴더 경로가 자동으로 따옴표 처리되어 들어갑니다. 예: explorer %1 / "C:\\totalcmd\\TOTALCMD64.EXE" /O /T %1',
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
  'chat.readonly.label.withCtx': '이전 대화 (Context {pct}%) — 읽기 전용',
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

  // === System / event messages ===
  'system.interrupted': '— 중단됨 —',
  'system.result': '결과: {subtype}',
  'system.stderr': '[stderr] {data}',
  'system.spawnFailed': '프로세스 시작 실패: {error}',
  'system.processExit': '[프로세스 종료 code={code}]',
  'system.code.unknown': '?',

  // === Tool cards ===
  'tool.error': '오류',
  'tool.openInWindow': '별도 창으로 열기',
  'tool.modal.close': '닫기',
  'tool.modal.codeView': '코드 보기',
  'tool.modal.response': '응답',
  'tool.bash.noOutput': '출력 없음',
  'tool.bash.linesOutput': '출력 {n} 줄',
  'tool.read.linesRead': '{n} 줄 읽음',
  'tool.write.linesWritten': '{n} 줄 작성',
  'tool.search.results': '{n} 결과',
  'tool.search.noResults': '결과 없음',
  'tool.glob.files': '{n} 파일',
  'tool.todo.hasResult': '결과 있음',
  'tool.argsHint.openFile': '\n(Ctrl/⌘+클릭: 파일 열기)',

  // === Bubble (assistant message) actions ===
  'bubble.copy': '복사',
  'bubble.copied': '복사됨',
  'bubble.collapse': '접기',
  'bubble.expand': '펼치기',
  'bubble.collapsed': '··· (접힘 — 클릭해서 펼치기)',

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
    '도구 없이, 메인 대화 컨텍스트만 보고 답하는 사이드 채팅입니다.\n메인 작업을 방해하지 않고 자유롭게 질문하세요.',

  // === Confirm cards (AskUserQuestion / ExitPlanMode) ===
  'confirm.askUserQuestion.title': '사용자 입력 요청',
  'confirm.answered': '응답됨',
  'confirm.cancelled': '취소됨',
  'confirm.submit': '제출',
  'confirm.cancel': '취소',
  'confirm.exitPlan.title': 'Plan 승인 요청',
  'confirm.approved': '승인됨',
  'confirm.denied': '거절됨',
  'confirm.savedTo': '저장 위치',
  'confirm.approveAndProceed': '승인하고 진행',
  'confirm.denyWithFeedback': '거절하고 피드백',
  'confirm.feedbackPlaceholder': 'plan 의 어떤 부분을 고쳐야 하는지 적어주세요.',
  'confirm.sendDenial': '거절 보내기',

  // === Workspace card ===
  'workspace.dragHint': '드래그하여 순서 변경',
  'workspace.aliasPlaceholder': '별칭 (비우면 제거)',
  'workspace.removeTitle': '이 워크스페이스를 목록에서 제거',
  'workspace.newSessionPending': '대기 중인 새 대화 (선택)',
  'workspace.newSessionStart': '이 디렉터리에서 새 대화 시작 (앱 모드)',
  'workspace.newTerminalStart': '이 디렉터리에서 새 터미널 세션 시작',
  'workspace.stopSession': '이 라이브 대화 중지',
  'workspace.newConversation': '새 대화',
  'workspace.newTerminal': '새 터미널',
  'workspace.openFolder': '폴더 열기',

  // === Session row / title ===
  'session.deleteTitle': '대화 삭제',
  'session.titleNew': '새로운 대화',
  'session.aliasPlaceholder': '별칭 (비우면 제거)',
  'session.aliasHintEdit': '\n원본 제목: {base}\n\n더블클릭: 별칭 편집',
  'session.aliasHintAdd': '\n\n더블클릭: 별칭 추가',

  // === Sidebar ===
  'sidebar.dateFilterAria': '활동 기간 필터',
  'splitter.title': '드래그하여 사이드바 너비 조정',

  // === ChatPane empty / subtitle ===
  'chat.empty.startHint': '워크스페이스의 "+ 새 대화" 로 시작하세요',
  'chat.subtitle.readonly': '읽기 전용',

  // === FindBar ===
  'find.notFound': '없음',
  'find.placeholder.terminal': '터미널 검색…',
  'find.placeholder.app': '메시지 검색…',
  'find.prev': '이전 (Shift+Enter)',
  'find.next': '다음 (Enter)',
  'find.close': '닫기 (Esc)',

  // === Quote (selection-to-comment) ===
  'quote.affordance': '💬 인용',
  'quote.placeholder': '코멘트 (Ctrl/⌘+Enter 추가, Esc 취소)',
  'quote.add': '추가',
  'quote.remove': '인용 제거',

  // === Settings modal — font chips, password ===
  'settings.fontChip.up': '우선순위 올리기',
  'settings.fontChip.down': '우선순위 내리기',
  'settings.fontChip.remove': '제거',
  'settings.fontChip.add': '추가',
  'settings.fontChip.empty': '기본값 사용 (시스템 폰트)',
  'settings.fontChip.pick': '— 폰트 선택 —',
  'settings.password.tooShort': '비밀번호는 8자 이상이어야 합니다',
  'settings.password.mismatch': '두 비밀번호가 일치하지 않습니다',
  'settings.password.changed': '변경됨. 모든 기존 세션 무효화.',

  // === UsageBar ===
  'usage.weekly': '주간',
  'usage.reset': '{time}',
  'usage.resetDone': '리셋됨',
  'usage.warned': '⚠ 한도 임박',
  'usage.rejected': '🚫 차단',
  'usage.modelChange': '모델 변경',
  'usage.modeChange': '권한 모드 변경',
  'usage.sessionTotalTitle': '이 세션 누적 (sub-agent 포함)',
  'usage.sessionInputTitle':
    '↑ 입력 토큰 — 모델로 올려보낸 누적량 (이전 대화 history + system prompt + 이번 메시지 + cache 읽기/생성)',
  'usage.sessionOutputTitle':
    '↓ 출력 토큰 — 모델이 생성한 누적량 (답변 본문 + tool 호출 인자 + thinking)',
  'usage.model.default.hint': '기본 (대화 시작 시 모델)',
  'usage.model.opus.hint': '최고 성능 — 비싸고 느림',
  'usage.model.sonnet.hint': '균형 — 일상 작업',
  'usage.model.haiku.hint': '빠르고 저렴 — 단순 작업',
  'usage.mode.default.hint': '기본 — 매 도구 호출 확인',
  'usage.mode.auto.hint': '자동 분류 (안전한 건 통과)',
  'usage.mode.plan.hint': '도구 차단, 계획만 작성',
  'usage.mode.acceptEdits.hint': '파일 편집 자동 승인',
  'usage.mode.bypassPermissions.hint': '⚠ 모든 권한 무시',

  // === App ===
  'app.workspacePathPrompt': '워크스페이스 디렉토리 경로 (호스트 PC 기준 절대 경로)',
  'app.compactRequested': '▸ /compact 요청됨',
  'app.confirmStopSession': '이 라이브 대화를 중지할까요? (기록은 유지됩니다)',

  // === Confirm modal (in-app, native window.confirm 대체) ===
  'dialog.ok': '확인',
  'dialog.cancel': '취소'
}
