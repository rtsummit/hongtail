# BTW — 메인 작업을 멈추지 않는 사이드 챗

Last Updated: 2026-04-26

`/btw` (by the way) 의 GUI 재해석. 메인 Claude 세션이 thinking 중일 때도 우측 패널에서 별도 질문을 던질 수 있게 한 기능. 코드는 시간이 지나며 drift 하므로 **함수명·심볼**을 1차 anchor 로 잡고, 라인 번호는 보조 참고용.

## 한 줄 요약

사용자가 우측 BTW 패널에 질문 → main 프로세스가 매번 `claude -p` 서브프로세스를 spawn → 메인 대화 스냅샷을 system prompt 로 주입 → stream-json 응답을 IPC 로 받아 별도 message store (`btwMessagesBySession`) 에 누적. 도구 사용 없이 read-only 추론만.

## 아키텍처

```
[renderer SideChatPanel]
사용자 입력
  ↓
[App.tsx handleBtwAsk]
buildBtwSystemPrompt(mainHistory, btwHistory)   // ./btwPrompt.ts
window.api.btw.ask({ ownerId, workspacePath, systemPrompt, question })
  ↓
[preload]
ipcRenderer.invoke('btw:ask', args)
  ↓
[main btw.ts spawnBtw]
writePromptFile(systemPrompt)   // 임시 파일 (tmpdir)
spawn('claude', [
  '-p',
  '--tools', '',                         // 모든 도구 차단
  '--no-session-persistence',            // 세션 파일 안 만듦
  '--output-format', 'stream-json',
  '--include-partial-messages',
  '--disable-slash-commands',
  '--verbose',
  '--append-system-prompt-file', tmpFile
])
child.stdin.write(question, 'utf8'); child.stdin.end()
  ↓
stdout (stream-json) → readline → IPC 'btw:event:<ownerId>'
  ↓
[App.tsx handleBtwEvent]
parseClaudeEvent → setBtwMessagesBySession  (메인 messagesBySession 과 격리)
```

## 핵심 정책

| 항목 | 동작 | 이유 |
|------|------|------|
| 도구 | `--tools ''` 로 전부 차단 | CLI `/btw` 본래 컨셉 — read-only ephemeral agent |
| 세션 격리 | `--no-session-persistence` + close 시 jsonl unlink | 아래 "세션 파일 leak" 참조 |
| 컨텍스트 | 매 호출마다 메인 + BTW 자체 history 를 system prompt 로 주입 | "메인 따라가기" 가 BTW 핵심 가치라 매번 fresh snapshot 필요 |
| 격리 | BTW 응답이 메인 `messagesBySession` 에 절대 안 들어감 | IPC 채널 분리 (`btw:event:<ownerId>` vs `claude:event:<sessionId>`) |
| 영구성 | BTW history 는 React state 만 — disk 영구화 없음 | 의도된 ephemeral. 앱 재시작 시 사라짐. CLI `/resume` 으로도 안 보임 |

## 인코딩 hazard (Windows)

> 한때 BTW 가 한글 질문을 "are" 같은 짧은 영어로 인식하는 버그가 있었음.

**원인:** Windows 에서 `spawn(..., { shell: true })` 하면 args 가 `cmd.exe /d /s /c "..."` 로 감싸져 실행되는데, cmd.exe 는

1. 한글 등 non-ASCII positional argument 를 codepage 변환하다가 mangle
2. argument 길이 8191 chars 초과 시 잘림 — system prompt 80k chars 면 즉시 깨짐

**해결:** `spawnBtw()` 가 두 경로 모두 cmd.exe 를 우회하도록 변경.

- `args.systemPrompt` → 임시 파일 (`tmpdir()/hongluade-btw-*.txt`) 에 utf8 로 write → `--append-system-prompt-file` 로 전달
- `args.question` → stdin 에 utf8 로 직접 write (positional argument 제거)
- close/error/cancel 시 `safeUnlink()` 로 임시 파일 정리

메인 session.ts 가 같은 이유로 stdin (stream-json) 을 쓴다 — 이쪽은 처음부터 그렇게 설계됨. BTW 만 처음 구현할 때 positional argument 로 만들었다가 한글 환경에서 터짐.

## 세션 파일 leak (sidebar 노출)

> CLI `--no-session-persistence` 의 의미는 "resume 불가" 일 뿐, jsonl 자체는 그대로 작성됨.

`-p --no-session-persistence` 로 띄워도 Claude CLI 는 `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` 파일을 만든다. 결과적으로 hongluade sidebar 의 readonly 세션 목록에 BTW 가 매번 새 항목으로 등장. 사용자 입장에서 "BTW 대화가 다 사이드바에 나오는" 현상.

**대책:** `spawnBtw()` 가 stream-json 이벤트의 `sessionId` 를 캡처해두고, child 의 `close` / `error` 핸들러에서 `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` 을 unlink. `cwd` 는 `args.workspacePath` 그대로이므로 메인 프로젝트 디렉토리에 만들어지고 거기서 즉시 삭제.

캐치할 점:

- `child.kill()` 직후 바로 unlink 하면 Windows 에서 파일 핸들 점유로 실패할 수 있음 → cancel 핸들러는 unlink 를 직접 안 하고 `close` 이벤트의 `cleanup()` 에 맡김
- session id 캡처 못 한 채 close 되면 (spawn 실패 등) 삭제할 대상이 없으므로 무시

`projectDir()` / `encodeCwd()` 는 `src/main/claude.ts` 에서 export.

## 영구 프로세스 안 쓰는 이유

`claude -p` 부팅 비용 (2~5초) 때문에 영구 BTW 프로세스를 두는 안이 매번 떠오르지만, **컨텍스트 정합성을 깬다.**

영구 프로세스는 spawn 시점의 system prompt 가 고정됨. 메인이 진행되어도 BTW 는 자기 시작 시점의 메인 스냅샷만 알고 있어서, 사용자가 한참 뒤에 "메인이 지금 뭐 하는 중이야?" 물으면 옛날 정보로 답하게 됨 — BTW 의 핵심 가치 (메인 따라가기) 를 정면으로 부숨.

우회책들도 다 별로:

- 매 질문마다 delta 를 user message 에 끼워 넣기 → BTW history 가 지저분해지고 토큰 누적
- 메인이 N턴 진행되면 자동 재시작 → 결국 지금 방식
- idle 타임아웃 (예: 30초) hybrid → 빠른 follow-up 만 재사용. 균형점이긴 한데 lifecycle 복잡도 증가

지금 방식의 cost 는 prompt caching (5분 TTL) 으로 상당 부분 커버되고, latency 는 받아들일 만하다는 판단. **변경 시에는 위 정합성 문제를 먼저 풀고 와야 함.**

## 의도된 동작 vs 버그 구분 가이드

| 관찰 | 정상? | 설명 |
|------|------|------|
| 앱 재시작 후 BTW 패널이 비어 있음 | ✓ | React state only |
| dev HMR 후 BTW 패널이 살아있음 | ✓ | renderer 만 리로드되면 React state 가 (HMR persist 시) 유지될 수 있음 |
| CLI `/resume` 에서 BTW 안 보임 | ✓ | BTW 는 앱 레이어 only. CLI 는 모름 |
| `~/.claude/projects/<proj>/` 에 BTW 세션 파일 생김 | ✗ | `--no-session-persistence` 인데 파일 생성됐다면 회귀 |
| BTW 응답이 메인 message list 에 섞임 | ✗ | IPC 채널 분리 회귀 |
| 한글 질문이 영어로 인식됨 | ✗ | 인코딩 fix 회귀 — 위 hazard 섹션 재확인 |

## native `/btw` 활용 검토 — 보류 (2026-04-27)

`feature/interactive-backend` 작업 중 "main 인터랙티브화하면 BTW 도 native `/btw` 로
가는 게 깔끔하지 않을까" 검토. binary 분석 + 실측 결과 채택 안 함.

### 발견

claude CLI 내부 BTW 의 wire (`subtype: "side_question"` control_request):

```json
{ "subtype": "side_question", "question": "<text>" }
```

`branchAndResume(question, _, { customTitle: "btw: <q>", extraMessages })` 가 본체.
fork 옵션은 `maxTurns: 1, skipCacheWrite: true, skipTranscript: true, tools deny`.

### 실측

`scripts/test-btw-jsonl.cjs` (검증 후 삭제) 로 PTY 안에 인터랙티브 claude 띄워
`/btw 안녕` 입력 → 응답 받음 → 해당 세션 jsonl 검사:

- assistant record **0개** — 응답이 jsonl 에 안 적힘
- ANSI 출력에서 `↑/↓ scroll · f to fork · Esc to dismiss` 발견 — 사용자가 **`f` 키로
  fork** 해야 비로소 새 sessionId 의 jsonl 생성

즉 `skipTranscript: true` 의 진짜 의미는 "main jsonl 에 안 적기" 가 아니라 **응답 자체가
in-memory only**. fork 까지 가야 disk 에 남음.

### 왜 hongluade 에 못 가져오나

| 시나리오 | 가능 여부 |
|---|---|
| 단순 `/btw <q>\r` + jsonl tail 로 응답 받기 | ✗ jsonl 에 응답 자체가 없음 |
| `/btw <q>\r` + `f\r` 자동 fork | △ main session 이 fork 로 swap 될 위험 — `branchAndResume` 의 이름 그대로 |
| ANSI 화면에서 BTW 응답만 정밀 파싱 | △ 한 popup 한정 fragile parsing — 옵션 1 의 단점 그대로 |
| PTY 단일 채널 — main 입력과 BTW 입력 충돌 | ✗ destructive UX (사용자가 작성 중이던 텍스트 위에 `/btw` 박힘) |

control_request `side_question` 을 우리가 직접 보내는 길도 있지만 — 인터랙티브 모드의
PTY stdin 은 raw TTY 라 JSON 라인을 못 보내고, bridge channel 이 cloud 기반이라 thin
client 구현 비용 크다 (`docs/interactive-jsonl-tail.md` 와 ANSI 옵션 문서의 같은 분석).

### 결론

native /btw 는 main TUI 안의 ephemeral popup 이 정신이고, hongluade 의 SideChatPanel
(main 과 BTW 가 분리된 별도 UI) 모델과 호환되지 않는다. 현재 BTW (자체 spawn + system
prompt 주입) 가 "main 과 격리된 read-only ephemeral side query" 라는 의도에는 더 잘
맞는다. main 백엔드 변경과 무관하게 그대로 둔다.

부수효과: BTW 자식 claude 는 `-p` headless 라 모바일 remote 에 안 보임 — 이는 BTW 의
ephemeral 정신상 오히려 의도된 동작.

## 관련 파일

- `src/main/btw.ts` — 서브프로세스 spawn / IPC 핸들러
- `src/renderer/src/btwPrompt.ts` — `buildBtwSystemPrompt` (메인 + BTW history → system prompt)
- `src/renderer/src/components/SideChatPanel.tsx` — 우측 패널 UI
- `src/renderer/src/App.tsx` — `btwMessagesBySession`, `handleBtwAsk`, `handleBtwEvent`
- `src/preload/index.ts` — `window.api.btw.{ ask, cancel, onEvent }`
