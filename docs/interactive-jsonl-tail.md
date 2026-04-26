# 인터랙티브 백엔드 + jsonl tail — 실현 가능성 조사

Last Updated: 2026-04-27

`remote-control.md` B안의 통신 채널 후보 중 옵션 4 (jsonl tail watch) 의 실증. 결론: **실현 가능, 채택 권고**.

## 조사 질문

1. 인터랙티브 모드 jsonl 의 record 구조가 stream-json 과 호환되는가? (현 readonly 렌더 코드를 그대로 쓸 수 있는가)
2. flush 빈도는 chat UI 의 실시간성에 충분한가?
3. tail/watch 인프라가 hongluade 에 이미 있는가?

## 결과 요약

| 질문 | 결과 |
|---|---|
| record 구조 호환 | ✓ 같은 형식 — `parseClaudeEvent` 그대로 사용 가능 |
| flush 빈도 | ✓ content block 단위 (~0.1~0.5초 간격, append-only) |
| tail/watch 인프라 | ✓ `readSessionFromOffset` + `startWatch` 이미 구현됨 |

## 데이터 — 실제 인터랙티브 jsonl 실측

### 실시간성 (한 message_id 의 8개 record)

```
ts=2026-04-26T15:38:07.633Z  thinking(0ch)
ts=2026-04-26T15:38:08.008Z  text(34ch)
ts=2026-04-26T15:38:08.546Z  tool_use(Read)
ts=2026-04-26T15:38:08.784Z  tool_use(Read)
ts=2026-04-26T15:38:09.235Z  tool_use(Read)
ts=2026-04-26T15:38:09.834Z  tool_use(Read)
ts=2026-04-26T15:38:10.114Z  tool_use(Read)
ts=2026-04-26T15:38:10.672Z  tool_use(Read)
```

같은 모델 turn 의 content block 들이 **별도 라인으로 0.1~0.5초 간격** 에 jsonl 에 즉시 추가된다. 토큰 단위 partial 은 아니지만 — 토큰 stream 은 화면에만 그려지고 jsonl 에는 content block 완성 시 한 번에 들어감 — chat UI 의 "tool_use 박스가 하나씩 추가되는" 실시간성에 충분.

### record 분포 (272 라인 인터랙티브 세션 한 개)

```
type 분포:
  permission-mode:        15
  system (bridge_status): 12 (subtype 포함)
  file-history-snapshot:  20
  user:                   74
  attachment:             13
  assistant:             116
  last-prompt:            12
  queue-operation:        14
```

`assistant` record 의 message_id 별 카운트 분포:
- 1 record:   26개 (text-only 응답)
- 2 records:  27개 (text + 1 tool_use)
- 3-8 records: tool_use 가 많은 turn

같은 message_id 의 여러 record 는 **append-only**. 이전 record 가 update 되는 게 아니라 새 content block 이 추가될 때마다 새 라인.

### entrypoint 분포

같은 sessionId 의 jsonl 안에 `entrypoint: "cli"` 와 `"sdk-cli"` 가 **섞일 수 있음**. 의미: hongluade `-p` 모드와 인터랙티브 모드가 같은 세션을 번갈아 열어도 둘 다 같은 jsonl 에 record 를 추가한다 (충돌 없음, append-only).

### 새로 보이는 type 들 (인터랙티브 모드 전용)

| type | 의미 / 활용 |
|---|---|
| `permission-mode` | 권한 모드 변경 — UsageBar 표시와 동기화 가능 |
| `system` (`subtype: bridge_status`) | 모바일 remote 연결 상태 — UI 인디케이터 가치 |
| `attachment` | 사용자 첨부 파일/이미지 |
| `queue-operation` | queue 관리 (모바일에서 요청 queue?) |
| `file-history-snapshot` | edit 도구의 변경 추적 |
| `last-prompt` | 최근 prompt 캐시 |

`parseClaudeEvent` 의 default 분기로 빈 배열 반환되어 무시되므로 안전. 단계적으로 의미 있는 것 (permission-mode, bridge_status) 은 핸들링 추가.

## 인프라 (이미 있는 것)

`src/main/claude.ts`:
- `readSessionFromOffset(cwd, sessionId, fromOffset)` — 마지막 newline 까지만 consume, partial 라인 보존, 다음 호출이 이어 받음
- `readSessionTail(cwd, sessionId, tailLines)` — ring buffer 로 마지막 N 라인
- `startWatch(sender, cwd, sessionId)` — `fs.watch` + 150ms debounce → IPC `claude:session-changed:<sessionId>` emit
- `parseClaudeEvent` — stream-json 과 jsonl persistence record 둘 다 처리 (`isSidechain` vs `parent_tool_use_id` 동등 처리 등)

readonly 모드가 이미 이것들을 사용 중. live 모드에서도 그대로 활용 가능.

## 위험 / 한계

- **토큰 단위 streaming UX 손실**: 응답 한 문장이 다 작성되기 전까지 화면 비어있음. 보통은 tool_use 가 빠르게 끼어들어 실질적 갱신 빈도 충분, 그러나 긴 텍스트 응답만 있는 turn 은 사용자 대기 시간 동안 화면 변화 없음. 필요 시 ANSI 파싱 옵션을 hybrid 로 얹어 in-flight 미리보기 가능 (`interactive-ansi-parsing.md` 참고).
- **slash command 출력 파싱**: `/permissions`, `/model`, `/compact` 같은 인터랙티브 빌트인은 jsonl 에 어떻게 기록되는지 추가 검증 필요. `permission-mode` record 가 실제로 권한 변경 시점에 들어감을 확인.
- **fs.watch 신뢰성**: Windows 의 fs.watch 는 일부 case 에서 이벤트 누락 가능. 현재 readonly 모드가 안정 작동하므로 같은 메커니즘이면 OK 추정. 보강하려면 mtime polling fallback 추가.

## 구현 윤곽

신규 백엔드 `interactive` 추가 (현재의 `claude` / `terminal` 와 병렬):

1. `src/main/session.ts` 에 `spawnInteractive(cwd, sessionId, mode)` — node-pty 로 `claude --session-id <uuid>` (또는 `--resume`) 띄움. 출력은 ANSI 그대로 버림 (보지 않음). hongluade 는 jsonl 만 본다.
2. spawn 직후 `startWatch` 호출 → `claude:session-changed` 이벤트로 chat UI 에 변경 알림
3. 사용자 메시지 입력은 PTY stdin 에 텍스트 + `\r` 로 write (인터랙티브 TUI 가 수신)
4. 인터럽트, 슬래시 커맨드도 PTY 의 키 시퀀스로 전달
5. 권한 모드 / 모델 변경은 `/permissions`, `/model` 입력으로 (TUI 가 처리) — 별도 control_request 채널 불필요
6. 모바일 remote 는 자동 활성화 — 추가 작업 없음

## 결정

**채택 권고.** 다음 단계는 PoC 한 세션 띄워보기 — `pty.ts` 위에 얇은 wrapper 로 인터랙티브 claude 띄우고 jsonl 변경이 readonly 렌더와 같은 chat UI 로 흐르는지 확인.

## 관련

- `remote-control.md` — B안의 큰 그림
- `cli-resume.md` — 같은 근본 원인 + resume 호환성 부수효과
- `interactive-ansi-parsing.md` — 보류된 옵션 1 (hybrid 시 in-flight 미리보기로 활용 후보)
- `sendinput-flow.md` — 현재 stream-json 채널 (대체 대상)
