# Plan mode 의 AskUserQuestion — 호스트 UI 없음, 임시로 도구 비활성

Last Updated: 2026-04-27

honglaude 가 spawn 한 `claude` 세션에서 plan mode를 켜고 작업하면, Claude 가 옵션 카드를 띄우려고 `AskUserQuestion` 도구를 호출하는 순간 **0.003초 만에** 자동 deny 가 돌아오고 plan agent 가 "사용자가 답하지 않았다"로 오해석해 임의 디폴트로 진행하던 버그 노트.

## 한 줄 요약

`-p` (non-interactive print) 모드 + stream-json IPC 로 spawn 했기 때문에 SDK 가 `AskUserQuestion` 같은 인터랙티브 도구를 띄울 콘솔 UI 가 없어 즉시 deny 한다. honglaude 측에도 옵션 카드를 그려줄 호스트 UI 가 없다. 임시 회피로 spawn args 에 `--disallowed-tools AskUserQuestion` 을 넣어 도구 자체를 비활성화 — Claude 는 일반 텍스트 질문으로 폴백.

## 증상

`~/.claude/projects/.../{sessionId}.jsonl` 에서 패턴:

```jsonl
// assistant turn
{ "type":"assistant", "message":{"content":[{"type":"tool_use","name":"AskUserQuestion",
  "input":{"questions":[{"question":"...", "options":[{"label":"...","description":"..."}, ...]}]}}]} }
// 0.003 초 뒤
{ "type":"user", "message":{"content":[{"type":"tool_result", "is_error":true, "content":"Answer questions?"}]} }
// 그 다음 assistant turn
{ "type":"assistant", "message":{"content":[{"type":"text","text":"사용자가 질문에 답하지 않으셨어요. 합리적 디폴트로 ... Plan 에이전트에 ... 진행하겠습니다."}]} }
```

UI 상으로는 빨간 "Answer questions?" 카드 + assistant 가 자기 마음대로 디폴트 골라서 진행.

## 원인 (두 겹)

### 1. spawn 시 `-p` non-interactive

`src/main/session.ts:23-48` 의 `spawnClaude` 가 사용하는 args:

```ts
const baseArgs = [
  '-p',
  '--output-format', 'stream-json',
  '--input-format',  'stream-json',
  '--verbose',
  '--permission-mode', 'bypassPermissions',
  // ↑ -p 모드에서는 SDK 가 AskUserQuestion 옵션 UI 를 띄울 콘솔이 없음
]
```

`-p` 는 print mode (= headless). 사용자가 Shift+Tab 으로 plan mode 로 전환해도 spawn args 에 박힌 `-p` 는 유효하므로 SDK 는 인터랙티브 도구를 즉시 deny.

### 2. honglaude 호스트 UI 부재

`src/renderer/src/claudeEvents.ts:130` 의 `tool_use` 분기는 `AskUserQuestion` 을 일반 tool 카드로 똑같이 그릴 뿐 — 옵션 라디오·체크박스를 렌더하지 않고, 사용자 선택을 자식 stdin 으로 돌려보내는 경로도 없다. 즉 SDK 가 마음 바꿔서 호스트로 넘겨준다 해도 받을 손이 없다.

## 임시 회피 — `--disallowed-tools AskUserQuestion`

`src/main/session.ts` 의 `baseArgs` 에 한 줄 추가:

```ts
const baseArgs = [
  '-p',
  // ...
  '--permission-mode', 'bypassPermissions',
  '--disallowed-tools', 'AskUserQuestion'
]
```

`--disallowedTools / --disallowed-tools` 는 `claude --help` 에 명시된 정식 플래그 (쉼표/공백 구분 리스트).

### 효과

- Claude 의 도구 목록에서 `AskUserQuestion` 이 아예 빠진다 — `ToolSearch select:AskUserQuestion` 도 "No matching deferred tools found" 로 응답.
- Claude 는 옵션 카드 대신 **텍스트로 번호 매긴 질문**을 던지고, 사용자는 채팅 입력으로 답한다.
- 0.003초 자동 deny + `is_error:true` 가 더 이상 발생하지 않는다.

### 잃는 것

- plan mode 가 원래 의도한 **구조화된 라디오/체크박스 옵션 UI** — 그냥 텍스트 대화로 대체된다.
- 해상도가 떨어지는 건 사실이지만, 멈춤·디폴트 강제진행 버그를 막는 게 더 급하다.

### 검증 (재현 가능)

dev 테스트 인스턴스(`HONGTAIL_TEST=1 npm run dev` → port 9877) 에서:

```bash
# 새 세션 + plan-style 프롬프트
SID=$(curl -s -X POST http://127.0.0.1:9877/sessions/start \
  -H "Content-Type: application/json" \
  -d '{"workspacePath":"C:/Workspace/hongtail","backend":"app","mode":"new"}' \
  | jq -r .sessionId)

curl -s -X POST http://127.0.0.1:9877/sessions/send \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SID\",\"text\":\"AskUserQuestion 도구로 좋아하는 색깔(빨강/파랑/초록)을 물어봐주세요.\"}"

curl -s -X POST http://127.0.0.1:9877/sessions/wait-result \
  -H "Content-Type: application/json" -d "{\"sessionId\":\"$SID\",\"timeoutMs\":80000}"

curl -s http://127.0.0.1:9877/messages/$SID
```

기대값:
- `tool-use name=AskUserQuestion` 블록 **0건**
- `tool-result is_error:true content="Answer questions?"` **0건**
- assistant-text 안에 텍스트 형태의 번호 매긴 질문 등장

검증 일시: 2026-04-27 (commit `a60e389`).

## 핵심 파일

- `src/main/session.ts:23-48` — `spawnClaude`, baseArgs 에 disallow 플래그 추가
- `src/renderer/src/claudeEvents.ts:130` — `tool_use` 분기. 향후 호스트 UI 구현 시 `AskUserQuestion` 특수 케이스 추가 지점
- `docs/sendinput-flow.md:160-200` — control_request 표. `can_use_tool` 채널 정의 (proper fix 후보)

## TODO — Phase 2: 호스트 옵션 카드 UI 복구

옵션 카드 UX 를 원래 모양으로 살리려면 단계적으로:

### A0. 프로토콜 probe (1–2 시간, read-only 관찰)

가장 큰 미지수: SDK 가 `-p stream-json` 모드에서 AskUserQuestion 답변을 받는 wire format. 후보:

| 가설 | 구현 방향 |
|---|---|
| SDK 가 `control_request {subtype:"can_use_tool"}` 를 호스트로 먼저 보낸다 | 기존 `claude:control-request` IPC 의 역방향 흐름. 자식이 보낸 request_id 를 매칭해 `control_response` 로 사용자 선택 회신. 가장 깨끗 |
| 자동 deny 후 늦게 inject 한 `tool_result` 가 수용된다 | user 메시지로 `[{type:"tool_result", tool_use_id, content}]` 주입 |
| 늦은 `tool_result` 가 무시된다 | 구현 불가. 영구히 disallow 유지 + SDK upstream 이슈 등록 |

probe 절차:
1. session.ts 에서 disallow 임시 해제, readline 핸들러에 stderr 캡처 로깅 추가.
2. plan mode 트리거.
3. 캡처 스트림에서 `tool_use.input` 형태, 자동 deny `tool_result` 형태, `control_request can_use_tool` 발생 여부 확인.

### A1. UI 구현 (probe 결과가 viable 일 때)

- `src/renderer/src/types.ts` — 새 Block variant `ask-user-question` (`toolUseId`, `question`, `options`, `multiSelect`, `resolved`)
- `src/renderer/src/claudeEvents.ts:130` — `tool_use` 분기에서 `block.name === 'AskUserQuestion'` 특수 케이스. 페어된 deny `tool_result` 는 resolved 후 숨김.
- `src/renderer/src/components/AskUserQuestionCard.tsx` (신규) — 질문+옵션 카드, 라디오/체크박스+제출
- `src/renderer/src/components/MessageList.tsx` — 새 case 렌더링
- `src/main/session.ts` — case 1 이면 기존 IPC + `pendingHostControlRef` 추가 (자식이 보낸 request_id 추적). case 2 면 `claude:answer-tool` IPC 신규
- `src/preload/index.ts` — IPC 노출
- `src/renderer/src/App.tsx` — `handleClaudeEvent` 에서 새 블록 처리, 응답 핸들러 연결

A1 한 번 구현하면 같은 자동 deny 패턴인 다른 deferred 인터랙티브 도구 (`CronCreate`, `EnterWorktree`, `PushNotification`, `RemoteTrigger` 등) 도 동일 구조로 살아난다.

## 알아두기

- BTW (`src/main/btw.ts`) spawn 은 이미 `--tools ''` 로 모든 도구를 차단하므로 본 이슈와 무관.
- 같은 자동 deny 패턴의 다른 deferred 도구가 노출되면 일단 disallow 리스트에 추가 — 한 줄 변경. Phase 2 전까지 임시 안전망.
- `--input-format stream-json` 은 CLI help 상 "only works with --print" — `-p` 모드를 벗어날 수도 없다 (참고: `docs/remote-control.md`). 호스트 UI 구현이 사실상 유일한 proper fix 경로.
