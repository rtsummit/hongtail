# sendInput — claude CLI 에 사용자 메시지를 흘려보내는 경로

Last Updated: 2026-04-26

hongluade 가 spawn 한 claude CLI 자식 프로세스에 어떻게 사용자 메시지를 전달하는지, stream-json input format 의 구조와 한계를 정리한 노트. 코드는 시간이 지나며 drift 하므로 **함수명·심볼**을 1차 anchor 로 잡고, 라인 번호는 보조 참고용.

## 한 줄 요약

renderer 의 `handleSend` → IPC `claude:send-input` → main 이 `{type:"user", message:{role:"user", content:text}}` JSON 한 줄을 자식 프로세스 stdin 에 write. 자식은 `-p --input-format stream-json --output-format stream-json` 모드로 떠 있어서 매 라인이 user message event 로 처리되고 응답을 stream-json 으로 stdout 에 흘림.

## 시퀀스

```
[renderer ChatPane]
handleSend(input, quotes)
  composeMessage()  → 인용 prepend 된 text
  setInput(''); setQuotes([])
  forceScrollBottomRef = true
  onAppendBlocks(sessionId, [{kind:'user-text', text}])   // UI 에 즉시 echo
  onTurnStart(sessionId)
  ↓
window.api.claude.sendInput(sessionId, text)
  ↓
[preload]
ipcRenderer.invoke('claude:send-input', sessionId, text)
  ↓
[main session.ts]
ipcMain.handle('claude:send-input', ...)
  payload = JSON.stringify({type:'user', message:{role:'user', content:text}})
  session.child.stdin.write(payload + '\n')
  ↓
[claude CLI 자식 프로세스]
stream-json input 한 줄 = 한 turn 시작
  → 모델 호출 → tool 사용 → assistant 응답
  ↓
stdout 에 stream-json 이벤트 (system/init, assistant, tool_use, tool_result, result, rate_limit_event ...)
  ↓
[main session.ts]
readline 으로 한 줄씩 JSON.parse
emit(sender, sessionId, event)  // IPC 이벤트로 renderer 에 push
  ↓
[renderer App.handleClaudeEvent]
parseClaudeEvent → blocks
extractUsage / extractRateLimit / extractInit / extractContextTokens / extractContextWindowFromResult
setMessagesBySession / setStatusBySession
```

## 단계별 코드 위치

| 단계 | 파일 | 심볼 | 설명 |
|---|---|---|---|
| 1. UI 전송 | `src/renderer/src/components/ChatPane.tsx` | `handleSend()` | 인용 prepend → echo block append → IPC 호출. echo 가 직접 필요한 이유는 stream-json 이 user message 를 기본적으로 다시 흘려주지 않기 때문. |
| 2. preload bridge | `src/preload/index.ts` | `api.claude.sendInput` | `ipcRenderer.invoke('claude:send-input', ...)` 만 위임 |
| 3. main IPC | `src/main/session.ts` | `ipcMain.handle('claude:send-input', ...)` | JSON 한 줄을 자식 stdin 에 write. 끝에 `\n` 필수 |
| 4. claude spawn | `src/main/session.ts` | `spawnClaude()` | `-p --output-format stream-json --input-format stream-json --verbose --permission-mode bypassPermissions --session-id|--resume <id>` |
| 5. 응답 파싱 | `src/main/session.ts` | `child.stdout` 의 readline | 한 줄당 한 JSON 이벤트, parse → `emit(sender, sessionId, event)` |
| 6. renderer 분배 | `src/renderer/src/App.tsx` | `handleClaudeEvent()` | parseClaudeEvent + extract* 들로 messages/status 갱신 |

## stream-json input 스펙

자식이 `--input-format stream-json` 으로 떠 있을 때, stdin 의 **한 줄당 하나의 JSON 이벤트** 가 처리된다. user message event 는:

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": "<문자열 또는 content blocks 배열>"
  }
}
```

`content` 는 두 형태:

- **string** — 단순 텍스트. 현재 hongluade 가 이것만 사용
- **array** — Anthropic Messages API content blocks. multimodal:
  ```json
  [
    {"type":"text","text":"이 이미지 분석해 줘"},
    {"type":"image","source":{
      "type":"base64",
      "media_type":"image/png",
      "data":"iVBOR..."
    }}
  ]
  ```

`{type:"user", ...}` 외에 control event 도 있을 수 있지만 (예: interrupt) hongluade 는 현재 user message 만 보낸다.

## 응답 echo 와 `--replay-user-messages`

기본적으로 자식은 우리가 보낸 user message 를 stream-json 응답에 다시 포함시키지 않는다. 그래서 `handleSend()` 가 IPC 호출과 동시에 `onAppendBlocks(sessionId, [{kind:'user-text', text}])` 로 UI 에 직접 echo 를 넣는다.

`--replay-user-messages` 옵션을 켜면 자식이 user message 를 다시 emit 한다 (`stream-json` input/output 동시 사용 시에만). hongluade 는 이 플래그를 안 쓰고 있어 직접 echo 가 정답.

## 슬래시 커맨드 자동완성

`ChatPane` 에서 `/` 타이핑 시 dropdown 으로 매칭 명령을 보여준다. main 의 `slashCommands.ts:listSlashCommands(workspacePath)` 가 IPC `slash-commands:list` 로 노출되며, 다음 우선순위로 머지된다 (같은 이름은 상위가 하위를 가린다):

1. **project** — `<workspace>/.claude/commands/**/*.md`
2. **user** — `~/.claude/commands/**/*.md`
3. **plugin** — `~/.claude/plugins/<plugin>/commands/**/*.md`
4. **builtin** — `slashCommands.ts` 의 `BUILTIN` 하드코딩 목록

각 `.md` 의 frontmatter `description:` 을 읽어 dropdown 의 보조 텍스트로 쓴다. 디렉토리 nesting 은 `:` 로 펼쳐진다 (`commands/foo/bar.md` → `/foo:bar`).

### 인터랙티브 전용 빌트인 한계

`/help`, `/cost`, `/usage`, `/model`, `/permissions`, `/agents`, `/clear`, `/context`, `/init`, `/login` 같은 빌트인은 **claude CLI 인터랙티브 TUI 의 클라이언트 측 자체 처리** 다. stream-json input 에서는 단순 텍스트로 모델에 전달되어 "그게 뭔가요" 응답이 오거나 무시된다. 자동완성 dropdown 에는 노출되지만 실제로 stdin 으로 흘리면 동작 안 하는 것들이 섞여 있다.

예외 인것처럼 보이는 것:

- `/compact` — `App.tsx` 에서 `sendInput(sessionId, '/compact')` 를 보내는 hack 이 있다. stream-json input 에서 인식되는지는 검증되지 않았으며, 동작한다면 claude CLI 가 일부 명령은 자체 처리해 주는 것. 안 하면 모델이 평범한 텍스트로 받는다.

빌트인 list 는 init 이벤트의 `slash_commands` 필드에 정확히 들어있다 — 우리가 `BUILTIN` 으로 하드코딩한 것보다 그쪽이 정확하다. 향후 init 응답을 받아 동적으로 교체하는 게 맞다.

### 향후 고려

- main 의 `claude:send-input` 진입점에서 `text.startsWith('/')` 검사 → hongluade 가 자체 처리할 명령은 stdin 으로 보내지 않고 분기 (예: `/rename foo` → 세션/워크스페이스 alias 변경 IPC 로 라우팅)
- 자동완성에서 인터랙티브 전용 빌트인을 제외하거나 회색 처리
- `/permissions` 는 `control_request` 채널로 대체 (아래 참고)

## 이미지 첨부 — 현재 방식

현재는 paste 한 이미지를 main 이 `~/.claude/image-cache/<sessionId>/<timestamp>.png` 에 저장하고, textarea caret 위치에 `[Image #N: <절대경로>]\n` 텍스트를 삽입한다. claude 는 그 패턴을 인식해 자기 `Read` 툴로 파일을 다시 읽는다 — claude CLI 인터랙티브 paste 동작과 동일한 파일 + 경로 방식.

장점: payload 작음, 검증된 패턴.
단점: claude 가 Read 툴 한 번 호출하는 round-trip 발생.

base64 image content block 을 직접 stream-json 에 넣으면 round-trip 절약 가능하지만 payload 크기 ↑ 와 검증 필요.

## 자매 채널: `control_request`

권한 모드 변경 같은 제어용 메시지는 `claude:send-input` 이 아니라 **별도 IPC `claude:control-request`** 로 보낸다. main 은 이 요청을 다음 형식의 JSON 한 줄로 자식 stdin 에 write 한다:

```json
{
  "type": "control_request",
  "request_id": "<uuid>",
  "request": { "subtype": "set_permission_mode", "mode": "auto" }
}
```

자식이 처리한 뒤 stdout 으로 `control_response` 이벤트를 흘려준다. renderer 의 `App.handleClaudeEvent` 에서 `extractControlResponse` 로 파싱해 `pendingControlRef` 에 등록된 요청과 매칭, 실패 시 이전 상태로 롤백한다 (`handleSetPermissionMode`).

stdin 의 user message 와 control_request 는 같은 stream 을 공유하므로, 자식 입장에서 둘은 **interleave 가능한 라인** 이다. 순서 보장 같은 건 없으니 race 가 우려되면 ack 받고 다음 보낼 것.

## 핵심 인사이트

- hongluade 와 claude CLI 사이 채널은 **JSON Lines on stdin/stdout** 단 하나. user message, control_request 둘 다 같은 stdin 에 라인 단위로 흘린다. 응답도 stdout 한 stream 에 type 별로 섞여 들어온다.
- user message echo 는 자식이 안 해 주므로 우리가 직접 UI 에 넣는 패턴.
- 슬래시 커맨드는 거의 다 인터랙티브 전용이라 우리가 가로챌지 / 자동완성에서 뺄지 의식적 결정 필요.
- 자식 spawn 시 `--session-id` 는 새 세션, `--resume` 은 기존 세션 이어가기. session id 는 우리가 만들고 (`randomUUID`) 그것을 IPC 채널 키 + jsonl 파일 추적 키로 함께 사용.
