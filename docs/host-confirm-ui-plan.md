# 호스트 Confirm UI 구현 (완료)

Last Updated: 2026-04-30 (Phase 1 종료 — UI 카드 + 사용자 응답 흐름 동작)
Branch: `host-confirm-ui` (구현 완료, main 머지 대기)

> **현재 상태**: Phase 1 (1.1 + 1.2) 종료. AskUserQuestion / ExitPlanMode 의
> 자동 deny 가 사라졌고 hongtail 의 호스트 카드로 사용자 응답을 받는다. Phase 0
> probe 코드는 §11.5 에 따라 정리됐다. Phase 2 (23개 deferred tool 일반 confirm
> 카드) 는 §6 — 옵션, 시급하지 않음 (probe 결과 §11.2 의 *interactive* 둘만 deny
> 였고 *functional* 은 이미 정상 작동).
>
> **이 문서의 목적**: 다른 세션이 self-contained 로 읽고 즉시 구현 시작할 수 있게 모든 컨텍스트를
> 박아둔 plan. plan mode + AskUserQuestion 의 자동 deny 를 호스트 confirm UI
> 로 풀어낸 기록.

> **읽는 순서 권장**: §11 (Phase 0 결과) → §0 → §5 (Phase 1 구현). §1~§4 는 Phase 0 가설·분기·임시
> 회피 정리이므로 history 로 참고만. §11 이 §2.3 의 "확정 안 된 것" / §3.2 분기 / §4 임시 회피 / §10
> 결정사항을 다 superseded 함.

## 0. 한 줄 요약

`-p` stream-json 모드의 claude CLI 에 **`--permission-prompt-tool stdio` 플래그를 추가**하면 (§11.1
참조) `can_use_tool` control_request 가 stdout 으로 emit 되고 PermissionRequest hook 도 같이
race 하므로, hongtail 이 control_request 를 받아 호스트 UI 띄우고 stdin 으로 control_response
회신하는 양방향 채널을 구현한다. 한 번 만들면 23개 deferred tool 중 *interactive* 한 것
(AskUserQuestion, ExitPlanMode) 이 정상 작동. 나머지 *functional* 한 것 (EnterWorktree 등) 은
이미 자동 실행 중 (probe 결과).

## 1. 배경 — 왜 필요한가

> §11 superseded: §1.1 의 표 중 "23개 deferred tools 전체" 행은 사실과 다르다. probe 결과
> *interactive* 한 것 (AskUserQuestion, ExitPlanMode) 만 자동 deny, *functional* 한 것
> (EnterWorktree, Cron* 추정) 은 그냥 정상 실행됨. §1.2 의 "control_request 를 emit" 도 실제론
> `--permission-prompt-tool stdio` 가 있어야 emit (없으면 stdout 으로 안 나옴).

### 1.1 현재 증상

`app` 백엔드 (`-p --output-format stream-json --input-format stream-json --permission-mode
bypassPermissions`) 에서 다음 시나리오 모두 0.003초 자동 deny 로 작동 불능:

| 시나리오 | 트리거 | deny 결과 |
|---|---|---|
| `AskUserQuestion` 옵션 카드 | 모델이 사용자 선택 요청 | `tool_result is_error:true content:"Answer questions?"` |
| plan mode 의 `ExitPlanMode` | 사용자가 plan mode 진입 후 plan 작성 | 같은 패턴, plan 종료 불가 |
| 인터랙티브 빌트인 (`/help`, `/cost` 등) | 슬래시 입력 | synthetic `"isn't available in this environment"` (별 케이스) |
| ~~23개 deferred tools 전체~~ | ~~`EnterPlanMode`, `ExitPlanMode`, `AskUserQuestion`, `CronCreate`, `EnterWorktree`, `PushNotification`, `RemoteTrigger`, `ToolSearch` (등)~~ | ~~같은 자동 deny 패턴~~ — **§11.2 probe 로 무효화**: interactive 한 둘만 deny, 나머지는 정상 |

현재 임시 회피: `src/main/session.ts` 의 `--disallowed-tools AskUserQuestion` — 이 도구만 차단,
나머지는 그대로 deny 발생. plan mode 자체는 회피 안 됨. **§11 이후 이 회피는 불필요 — 영구
제거 예정.**

### 1.2 근본 원인

claude CLI 의 두 가지 권한 채널:

- **bypassPermissions / acceptEdits / plan / default**: 일반 도구 (Read, Bash, Edit 등) 의 자동/수동
  승인 정책. hongtail 의 `--permission-mode bypassPermissions` 로 통과
- **deferred tool (interactive 만 해당)**: bypassPermissions 와 *별개로*, **호스트 측 confirm UI 가
  반드시 필요**한 도구. claude CLI 가 `can_use_tool` control_request 를 stdout 으로 emit → SDK
  consumer (호스트) 가 응답 안 보내면 즉시 deny

  **§11.1 정정**: 이 emit 은 `--permission-prompt-tool stdio` 플래그가 spawn args 에 있을 때만
  발생. 없으면 `print.ts:4276` 분기에서 `hasPermissionsToUseTool` 결과를 그대로 반환하고
  control_request 자체가 stdout 으로 안 나간다.

~~hongtail 는 두 번째 채널의 incoming control_request 를 처리하지 않음.~~ — **§11.1 정정**:
처리 안 하는 것도 맞지만 더 근본적으로 `--permission-prompt-tool stdio` 가 빠져 있어 애초에
control_request 가 들어오지 않았음. 플래그 추가하면 들어오기 시작.

## 2. 코드로 확정된 사실 (claude-code-main 분석)

### 2.1 `can_use_tool` control_request 흐름

**파일**: `C:\Workspace\claude-code-main\src\cli\structuredIO.ts`

핵심 line:

```ts
// line 312-314
/**
 * Register a callback invoked whenever a can_use_tool control_request
 * is written to stdout. Used by the bridge to forward permission
 * requests to claude.ai.
 */

// line 323-325
/**
 * Register a callback invoked when a can_use_tool control_response arrives
 * from the SDK consumer (via stdin). Used by the bridge to cancel the
 * stale permission prompt on claude.ai when the SDK consumer wins the race.
 */

// line 177
if (request.request.subtype === 'can_use_tool') {
  this.resolvedToolUseIds.add(request.request.tool_use_id)
  // ...
}

// line 266
.filter(pr => pr.request.subtype === 'can_use_tool')
```

**확정**: `-p` stream-json 모드에서 claude CLI 가 `can_use_tool` subtype 의 control_request 를
**stdout JSON line 으로 emit** 한다. SDK consumer (= hongtail) 가 stdin 으로 control_response 회신
가능. wire format 가설 1 (`docs/plan-mode-askuserquestion.md` §A0 의 첫 행) 이 *코드로 확정*.

### 2.2 hongtail 의 기존 control 채널

**hongtail → claude 방향은 이미 구현됨** (`src/main/session.ts:131-135`):

```ts
const requestId = randomUUID()
const payload = JSON.stringify({
  type: 'control_request',
  request_id: requestId,
  request: {...}
})
child.stdin.write(payload + '\n')
```

`set_permission_mode`, `set_model` 등 호스트 → 자식 방향 control_request 송신. 자식의
`control_response` 처리는 `src/renderer/src/sessionStatus.ts:219` 의 `extractControlResponse` 가
담당.

**미구현은 자식 → 호스트 방향**: claude CLI 가 stdout 으로 보내는 incoming control_request 를
hongtail 가 받아 처리하고 stdin 으로 control_response 보내는 흐름.

### 2.3 wire format (Phase 0 probe 로 확정)

stdout 라인 (자식 → 호스트) — probe log 에서 캡처된 실제 형식:
```json
{
  "type": "control_request",
  "request_id": "63b67a17-ba73-45c4-97ed-d1f5d726f91a",
  "request": {
    "subtype": "can_use_tool",
    "tool_name": "AskUserQuestion",
    "display_name": "AskUserQuestion",
    "input": {
      "questions": [
        {
          "question": "어떤 작업에 대한 plan 을 작성할까요?",
          "header": "Plan 주제",
          "options": [
            { "label": "host-confirm-ui Phase 1+", "description": "..." },
            { "label": "Phase 0 probe 결과 분석·정리", "description": "..." }
          ]
        }
      ]
    }
  }
}
```

ExitPlanMode 의 경우 `input` 이 `{ "plan": "<markdown plan>", "planFilePath": "<path>" }` 형태
(probe 로그 + plannotator 의 hook event 양쪽 일치).

stdin 라인 (호스트 → 자식) — host-confirm-ui-plan.md 추정 형식, **§11 Phase 1 구현 시 검증 필요**:
```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "<uuid>",
    "response": {
      "behavior": "allow" | "deny",
      "updatedInput": { /* AskUserQuestion: { "answers": {...} } 추정 */ },
      "message": "<deny 시 모델한테 줄 피드백>"
    }
  }
}
```

같은 도구의 PermissionRequest hook 의 stdin/stdout 형식 (plannotator 코드에서 확정):
- hook stdin: `{ session_id, transcript_path, cwd, permission_mode, hook_event_name: "PermissionRequest", tool_name, tool_input, tool_use_id }`
- hook stdout: `{ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior, message?, updatedPermissions? } } }`

**확정** (Phase 0 결과):
- ✅ `request.request.subtype = 'can_use_tool'` — probe 캡처 확인
- ✅ `request.tool_name`: "AskUserQuestion" / "ExitPlanMode" string
- ✅ `request.input` 형태:
  - AskUserQuestion: `{ questions: [{question, header, multiSelect?, options: [{label, description}]}] }`
  - ExitPlanMode: `{ plan, planFilePath }`
- ✅ timeout: hook timeout 345600s (4일) 명시적, control_request 도 짧지 않음 — 결과 회신 전까지 자식이 대기. plan 문서 §3.2 의 "0.003초 즉시 deny" 가설은 **틀림** (그건 control_request 가 아예 안 와서 fallback 으로 즉시 deny 된 것뿐).

**미확정 — Phase 1 구현 중 검증**:
- `response.response.updatedInput` 의 정확한 형태 (특히 AskUserQuestion answers map 구조)
- response 의 `behavior: "deny"` 시 추가 필드 (`message` vs `reason`)
- 동시에 발화하는 PermissionRequest hook 과의 race 정확한 동작 (둘 중 빠른 쪽 winner)

## 3. Phase 0 — wire format probe (✅ 종료, 2026-04-30)

> **결과 요약**: §11 의 시나리오 1 ("control_request 가 stdout 으로 정상 도착 + 충분한 timeout")
> 이 확정. 단, §3.1 절차로는 Phase 0 가 미완 — probe A/B 까지는 빈손이었고 probe C 에서
> `--permission-prompt-tool stdio` 플래그를 추가한 후에야 control_request 가 stdout 에 들어옴.
> 이하 §3.1·§3.2 는 history.

### 3.1 절차 (history)

1. hongtail 의 `src/main/session.ts` 에서 `--disallowed-tools AskUserQuestion` 임시 제거.
2. `child.stdout` 의 readline 핸들러에 raw line 덤프 로깅 추가:
   ```ts
   rl.on('line', (line) => {
     if (line.includes('control_request')) {
       require('fs').appendFileSync('C:\\tmp\\probe.log', line + '\n')
     }
     // ...기존 로직
   })
   ```
3. dev 환경에서 `app` 백엔드 새 세션 → 다음 prompt 차례로:
   - `AskUserQuestion 도구로 빨강/파랑/초록 중 좋아하는 색을 물어봐` → AskUserQuestion 발생
   - `--permission-mode plan` 진입 후 짧은 plan 작성 prompt → ExitPlanMode 발생
   - `ToolSearch 로 EnterWorktree 를 검색하고 호출 시도` → 다른 deferred tool

4. `C:\tmp\probe.log` 의 control_request 라인을 파싱해 다음 확인:
   - `request.request.subtype` == 'can_use_tool' 확정
   - `request.tool_name` 의 정확한 string
   - `request.input` 의 도구별 형태 (특히 AskUserQuestion 의 questions/options 구조, ExitPlanMode 의 plan 텍스트)
   - timeout 측정 (control_request 발생 시각 vs auto-deny tool_result 발생 시각 차이)

5. probe 결과를 `docs/host-confirm-ui-plan.md` §2.3 의 "확정 안 된 것" 에 채워넣기.

**실제 진행** (probe A → B → C):
- A. `--disallowed-tools` 제거 + 위 로깅: control_request **0건**. AskUserQuestion / ExitPlanMode 모두 자동 deny — synthetic `tool_result is_error:true` 로만 받음 (control_request 채널 거치지 않음).
- B. `--include-hook-events` + `--settings <hook stub>` + `--debug hooks` 추가: 여전히 hook 발화 안 됨, control_request 도 없음. PreToolUse 매처 `*` 로는 발화하는데 PermissionRequest 는 안 됨.
- C. `--permission-prompt-tool stdio` 추가: **양쪽 다 발화**. control_request 가 stdout 으로 들어오기 시작 + PermissionRequest hook 도 race 로 발화.

### 3.2 분기 (history — 결과는 시나리오 1 확정)

| probe 결과 | 다음 단계 |
|---|---|
| **✅ control_request 정상 도착 + 충분한 timeout** | Phase 1 진행 (단, §11.1 활성화 플래그 필수) |
| ~~control_request 자체가 안 도착~~ | ~~Phase 1 불가~~ — 활성화 플래그 빠뜨려서 잘못 진단했던 시나리오 |
| ~~timeout 너무 짧음~~ | ~~pre-confirm 패턴~~ — 실제론 timeout 짧지 않음 (4일 단위) |

실제 결정: **시나리오 1**. control_request 가 stdout 으로 들어오고 hongtail 이 stdin 으로
control_response 회신할 때까지 자식이 대기. timeout 은 4일 (hook 기준) — 사실상 무제한.
사용자 응답 대기 가능. Phase 1 디자인은 단순한 직접 응답 패턴.

## 4. 임시 회피 vs 정통 길

> §11 superseded: timeout 짧음 가설이 무효라 §4.1·§4.2 의 "두 단계 분리" 패턴 불필요. 단순히
> control_request → UI → 응답 직선 흐름.

### 4.1 ~~자동 confirm hack (작은 작업, 일시적)~~ — 무효

~~probe 결과에 따라 timeout 짧으면, 호스트가 control_request 받자마자 자동 `behavior: "allow"` 응답.~~

§11.1 결과: **timeout 은 짧지 않음** (4일). 호스트가 사용자 응답 대기 가능. 자동 hack 불필요.

### 4.2 정통 — 호스트 UI (Phase 1) — 직접 응답으로 단순화

control_request 받으면 host UI 띄움 → 사용자 응답 → control_response 송신. ~~timeout 회피 패턴~~
필요 없음 — 자식이 무한 대기.

만약 사용자가 cancel/dismiss 로 카드 닫으면 hongtail 이 `behavior: "deny"` + `message: "사용자가
취소함"` 으로 회신해서 자식이 deny tool_result 받게 함.

## 5. Phase 1 — minimum viable 구현 (1일)

### 5.1 범위

다음 두 도구만 우선 호스트 UI 추가 (가장 가치 큰 시나리오):

- `AskUserQuestion` — 옵션 카드 (라디오 / 체크박스)
- `ExitPlanMode` — plan 승인/거부

나머지 21개 deferred tool 은 Phase 2 또는 §7 fallback (자동 allow).

### 5.2 hongtail 변경 파일 명세

#### 5.2.1 `src/main/session.ts`

기존 `child.stdout` readline 핸들러를 확장:

```ts
rl.on('line', (line) => {
  if (!line.trim()) return
  try {
    const event = JSON.parse(line)
    const t = (event as { type?: string }).type
    if (t === 'control_request') {
      // 자식 → 호스트 control_request. broadcast 별 채널로 분리.
      broadcast(controlRequestChannel(sessionId), event)
      return
    }
    broadcast(channel, event)
    // ...기존 로직
  } catch {
    broadcast(channel, { type: 'parse_error', raw: line })
  }
})
```

새 helper:
```ts
function controlRequestChannel(sessionId: string): string {
  return `claude:control-request:${sessionId}`
}
```

새 IPC handler — control_response 송신:
```ts
registerInvoke('claude:respond-control', (sessionId: unknown, payload: unknown) => {
  const session = sessions.get(String(sessionId))
  if (!session?.child.stdin) return
  const line = JSON.stringify(payload) + '\n'
  session.child.stdin.write(line)
})
```

`--disallowed-tools AskUserQuestion` 임시 회피 *제거* (Phase 1 호스트 UI 가 작동하면 더 이상 필요 없음).

#### 5.2.2 `src/preload/index.ts`

`window.api.claude` 에 `respondControl(sessionId, payload)` + `onControlRequest(sessionId, callback)`
노출.

#### 5.2.3 `src/renderer/src/types.ts`

`Block` union 에 새 variants:

```ts
| { kind: 'ask-user-question'; toolUseId: string; requestId: string;
    questions: Array<{question: string; header: string; options: Array<{label: string; description: string}>; multiSelect: boolean}>;
    resolved?: Record<string, string> }
| { kind: 'exit-plan-mode'; toolUseId: string; requestId: string;
    plan: string; resolved?: 'approve' | 'deny' }
```

#### 5.2.4 `src/renderer/src/claudeEvents.ts`

`tool_use` 분기에서 `block.name === 'AskUserQuestion'` / `'ExitPlanMode'` 특수 케이스 — 일반 tool-use
대신 새 Block kind 반환. control_request 가 도착하기 *전* 시점에 미리 표시는 어려우니, control_request
도착 시 직접 push 하는 패턴이 더 깔끔. 즉 claudeEvents.ts 는 변경 안 하고, App.tsx 의 control_request
구독 핸들러에서 직접 Block push.

페어된 `tool_result is_error:true` 는 resolved 후 숨김:
```ts
case 'tool_result':
  // resolvedToolUseIds 에 있는 거면 skip — 호스트가 이미 처리한 deferred tool
```

#### 5.2.5 `src/renderer/src/components/AskUserQuestionCard.tsx` (신규)

```tsx
interface Props {
  block: AskUserQuestionBlock
  onSubmit: (answers: Record<string, string>) => void
  onCancel: () => void
}
```

questions[] 를 카드 형태로 렌더 — 각 question 마다 라디오 (multiSelect=false) 또는 체크박스
(multiSelect=true). 옵션 4개 이하. 제출 버튼.

#### 5.2.6 `src/renderer/src/components/ExitPlanModeCard.tsx` (신규)

```tsx
interface Props {
  block: ExitPlanModeBlock
  onApprove: () => void
  onDeny: () => void
}
```

plan 텍스트를 markdown 으로 렌더, 승인/거부 버튼 두 개.

#### 5.2.7 `src/renderer/src/App.tsx`

`useEffect` 에서 control_request 구독:

```ts
useEffect(() => {
  if (!selected || selected.backend !== 'app') return
  const unsubscribe = window.api.claude.onControlRequest(selected.sessionId, (event) => {
    const req = event.request
    if (req?.subtype !== 'can_use_tool') return
    if (req.tool_name === 'AskUserQuestion') {
      appendBlocks(selected.sessionId, [{
        kind: 'ask-user-question',
        toolUseId: req.tool_use_id,
        requestId: event.request_id,
        questions: req.input.questions,
      }])
    } else if (req.tool_name === 'ExitPlanMode') {
      appendBlocks(selected.sessionId, [{
        kind: 'exit-plan-mode',
        toolUseId: req.tool_use_id,
        requestId: event.request_id,
        plan: req.input.plan,
      }])
    } else {
      // Phase 2: 다른 deferred tool — 자동 allow (§7 fallback)
      void window.api.claude.respondControl(selected.sessionId, {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: event.request_id,
          response: { behavior: 'allow' }
        }
      })
    }
  })
  return unsubscribe
}, [selected])
```

새 `handleAskUserQuestionSubmit` / `handleExitPlanModeApprove` 핸들러 — 사용자 응답을 control_response
로 변환해 송신. Block 의 `resolved` 필드 update 로 카드 disable.

### 5.3 검증 절차

1. `npm run typecheck && npm run lint`
2. dev 띄워:
   - `AskUserQuestion 도구로 좋아하는 색을 물어봐` → 옵션 카드가 떠서 사용자 선택 가능. 응답 후 모델이 그 답을 받아 진행
   - plan mode 진입 + plan 작성 prompt → ExitPlanMode 카드 → 승인 시 일반 모드 전환 + 실행
3. 23개 deferred tool 의 다른 것 (예: `EnterWorktree`) → 자동 allow 로 통과

### 5.4 검증 시 잠재 issue

- ~~**timeout 너무 짧음**~~ — §11.1 결과로 무효 (timeout 4일).
- **PermissionRequest hook 와의 race**: §11.1 에서 hook stub 이 살아 있으면 race winner 가
  됨. Phase 1 에선 hook stub (`scripts/hook-probe-stub.cjs`) 과 `--settings` 인자 둘 다 제거해야
  control_request 가 race 없이 hongtail 로 직행. 안 그러면 사용자가 카드에 응답하기 전에 hook 이
  먼저 allow 응답해서 카드가 무용지물.
- **--disallowed-tools 제거 시 retro**: 기존 사용자가 AskUserQuestion 시나리오에서 텍스트 폴백에
  익숙해진 경우, UX 가 갑자기 옵션 카드로 변함. 옵션 추가: settings 에 "deferred tool 호스트 UI"
  toggle.
- **`--permission-prompt-tool stdio` 의 다른 부수효과**: 일반 도구 (Read/Bash/Edit 등) 의 권한 요청
  도 control_request 로 흘러올 수 있음. bypassPermissions 모드에선 일반 도구는 'allow' 로 미리
  결정돼 control_request 까지 안 올라가는 게 정상이지만, content-specific ask 룰이나 safety check
  (예: `.git/`, `.claude/` 경로) 가 'ask' 를 반환하면 control_request 로 올라옴. Phase 1 에서
  AskUserQuestion / ExitPlanMode 외 tool_name 은 §7 fallback (자동 allow) 으로 처리.

## 6. Phase 2 — 23개 deferred tool 전체 (선택)

각 도구별 카드 컴포넌트가 필요한 게 아니라 **일반 confirm 카드 + 도구 input preview** 로 통일:

```tsx
interface DeferredToolCardProps {
  toolName: string  // 'CronCreate', 'EnterWorktree', ...
  input: unknown    // tool input (JSON)
  onAllow: () => void
  onDeny: () => void
}
```

input 을 syntax-highlighted JSON 으로 표시 + 사용자 allow/deny 결정. 23개 모두 같은 UI 로 처리.

특수 도구 (AskUserQuestion, ExitPlanMode) 만 전용 카드 유지.

## 7. Fallback — 자동 allow 정책

Phase 1 의 wire format 이 어려우면 (§3.2 시나리오 2 이상) hongtail 가 control_request 도착 시 *모두
자동 allow* 회신. 사용자 confirm 단계 생략, plan mode 와 AskUserQuestion 의 UX 가치는 사라지지만
*기능 자체는 작동* (plan 작성 → 즉시 실행 모드, AskUserQuestion → 첫 옵션 또는 빈 답으로 진행).

이건 임시 회피 — 정통 (Phase 1) 으로 가면 deny 가능 + 사용자 UX 회복.

## 8. 코드 위치 reference

### 8.1 hongtail 변경 지점

| 파일 | 변경 |
|---|---|
| `src/main/session.ts:53-67` | stdout readline → control_request 분기 + 새 channel broadcast |
| `src/main/session.ts:130-` | 새 IPC handler `claude:respond-control` |
| `src/preload/index.ts` | `window.api.claude.respondControl` / `onControlRequest` |
| `src/preload/index.d.ts` | 타입 export |
| `src/renderer/src/types.ts:60-68` | Block union 확장 |
| `src/renderer/src/components/AskUserQuestionCard.tsx` | 신규 |
| `src/renderer/src/components/ExitPlanModeCard.tsx` | 신규 |
| `src/renderer/src/components/MessageList.tsx` (또는 ChatPane block 렌더 부분) | 새 Block kind 렌더 |
| `src/renderer/src/App.tsx` | control_request 구독 useEffect + 응답 핸들러 |
| `src/renderer/src/claudeEvents.ts:131-145` | tool_result 의 resolved tool_use_id 매칭 시 skip |
| `src/main/session.ts:38-39` | `--disallowed-tools AskUserQuestion` 제거 |

### 8.2 claude-code-main reference

| 파일 | 의미 |
|---|---|
| `src/cli/structuredIO.ts:177` | `can_use_tool` subtype 정의, resolvedToolUseIds 추적 |
| `src/cli/structuredIO.ts:266` | pending control_request 의 can_use_tool 필터 |
| `src/cli/structuredIO.ts:312-325` | stdout/stdin callback 등록 (bridge 용) — 호스트가 hook 할 자리 |
| `src/cli/structuredIO.ts:400-403` | SDK consumer 의 control_response 처리 |
| `src/bridge/bridgeMessaging.ts:148-152` | bridge 의 control_request 처리 (`initialize`, `set_model`, `can_use_tool`) — hongtail 이 모방할 패턴 |

### 8.3 관련 hongtail docs

- `docs/plan-mode-askuserquestion.md` — 이전 분석. 이 문서가 그 §A0/A1 의 detailed 버전
- `docs/sendinput-flow.md` — control_request 채널 일반 (호스트 → 자식 방향)

### 8.4 plannotator (참고 — 같은 문제의 다른 해결)

`C:\Workspace\plannotator\` — Claude Code 플러그인. PermissionRequest hook 으로 ExitPlanMode 를
가로채 브라우저에 plan 표시 + 승인/거부 버튼. host-confirm-ui 가 같은 문제를 풀지만 다른 채널
(control_request) 사용. 핵심 reference:

| 파일 | 의미 |
|---|---|
| `apps/hook/hooks/hooks.json` | PermissionRequest matcher / PreToolUse matcher 설정 예 |
| `apps/hook/server/index.ts:1077-1210` | PermissionRequest 핸들링 — stdin event JSON 받고 hookSpecificOutput 으로 결정 회신 |

## 9. 작업 순서 권장

1. **Phase 0** (✅ 종료): probe → wire format §2.3 + 활성화 플래그 §11.1 확정
2. **Phase 1.1** (반나절): `src/main/session.ts` + preload + types.ts 변경 — control_request 흐름
   확보 (UI 없이 자동 allow 로 응답 — fallback 형태). plan mode 가 *작동만* 하는지 검증
3. **Phase 1.2** (반나절~1일): AskUserQuestionCard + ExitPlanModeCard 컴포넌트 + App.tsx 핸들러.
   사용자 선택이 모델에 도달하는지 검증
4. **(선택) Phase 2**: 일반 DeferredToolCard 로 23개 전체 confirm UI

Phase 1.1 만 완성해도 plan mode 가 풀린다. UI 는 점진 개선.

## 10. 결정해야 할 것 (작업 시작 전)

- [x] **timeout 정책** — §11.1 로 결정: timeout 짧지 않음 (4일). 직접 대기. 즉시 allow + 사후
      결과 패턴 불필요.
- [ ] **AskUserQuestion 의 multiSelect / preview / "Other" 옵션** — UI 에서 다 지원할지 minimum 만
      할지. (기본 minimum: 단일 선택, multi 는 후속)
- [ ] **settings 에 "deferred tool UI" toggle 추가 여부** — 기존 텍스트 폴백 UX 유지 옵션 제공할지.
      현재 `--disallowed-tools` 회피가 사라지면 옵션 카드로 강제됨.
- [x] **PermissionRequest hook 과의 race** — §11.1 에서 race 가 hook winner 일 때 카드 무용지물.
      Phase 1 에선 hook 등록 안 함 (`--settings` 인자 + stub script 모두 제거). control_request
      단독 채널.
- [x] **활성화 플래그** — `--permission-prompt-tool stdio` 를 hongtail 의 `app` 백엔드 spawn args
      에 영구 추가. `--include-hook-events` 는 probe 끝나면 제거 (Phase 1 에선 hook 안 쓰니 불필요).

## 11. Phase 0 결과 (2026-04-30 종료)

§3 의 probe 가 §3.2 시나리오 1 ("control_request 정상 도착 + 충분한 timeout") 으로 결정. 단,
도달 과정에서 §1·§2 의 분석에 빠진 활성화 플래그를 발견.

### 11.1 결정적 발견 — `--permission-prompt-tool stdio` 활성화 플래그

`C:\Workspace\claude-code-main\src\cli\print.ts:4267-4292` 의 `getCanUseToolFn`:

```ts
export function getCanUseToolFn(
  permissionPromptToolName: string | undefined,
  structuredIO: StructuredIO,
  ...
): CanUseToolFn {
  if (permissionPromptToolName === 'stdio') {
    return structuredIO.createCanUseTool(onPermissionPrompt)  // ← can_use_tool flow 활성화
  }
  if (!permissionPromptToolName) {
    return async (...) => forceDecision ?? hasPermissionsToUseTool(...)  // ← 단순 fallback
  }
  // ... mcp permission tool
}
```

`--permission-prompt-tool` 인자가 빠지면 `permissionPromptToolName` 이 undefined → 단순 fallback
경로. `hasPermissionsToUseTool` 가 'ask' 반환해도 control_request 로 변환되지 않고 그대로 'ask'
로 끝남 → claude CLI 가 자체적으로 deny 처리 → synthetic `tool_result is_error:true content:"Answer
questions?"` 합성. 이게 hongtail 이 본 자동 deny 의 진짜 원인.

`--permission-prompt-tool stdio` 가 들어가면:
- `structuredIO.createCanUseTool` 활성 → can_use_tool control_request 가 stdout 으로 emit
- 동시에 PermissionRequest hook 도 race 로 같이 발화 (`structuredIO.ts:540-658`)
- 둘 중 빨리 응답 winner — hongtail 이 inline (control_response) 으로 응답 vs hook 이 외부 명령으로
  응답
- timeout 매우 길음 (PermissionRequest hook 의 명시 timeout 345600s = 4일, control_request 도 동일 추정)

### 11.2 deferred tool 분류 (probe 로 판명)

| 분류 | 도구 | 동작 (`--permission-prompt-tool stdio` 없을 때) |
|---|---|---|
| **interactive** (사용자 답이 필요) | AskUserQuestion, ExitPlanMode | 자동 deny, synthetic tool_result is_error:true |
| **functional** (자동 실행) | EnterWorktree, Cron* (추정), RemoteTrigger (추정) | 정상 실행, deny 없음 |
| **참조용** (다른 도구 메타데이터) | ToolSearch | 정상 실행 |

플래그 추가 후엔 interactive 도 control_request 로 호스트에 위임됨. functional 은 변화 없음.

### 11.3 wire format 확정 (probe log)

§2.3 의 추정 형식이 거의 그대로 맞음. 실제 캡처:

**control_request (자식 → 호스트)**:
```json
{
  "type": "control_request",
  "request_id": "63b67a17-ba73-45c4-97ed-d1f5d726f91a",
  "request": {
    "subtype": "can_use_tool",
    "tool_name": "AskUserQuestion",
    "display_name": "AskUserQuestion",
    "input": {
      "questions": [{
        "question": "어떤 작업에 대한 plan 을 작성할까요?",
        "header": "Plan 주제",
        "options": [
          { "label": "host-confirm-ui Phase 1+", "description": "..." },
          { "label": "Phase 0 probe 결과 분석·정리", "description": "..." }
        ]
      }]
    }
  }
}
```

ExitPlanMode 의 input 은 `{ "plan": "<markdown>", "planFilePath": "<path>" }`.

**control_response (호스트 → 자식)** — Phase 1.1 에서 확정 (양방향 흐름 동작):
```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "63b67a17-...",
    "response": {
      "behavior": "allow",
      "updatedInput": {}
    }
  }
}
```

`response.response` 의 schema = claude-code-main 의 `PermissionPromptToolResultSchema.ts`:

- **allow**: `{ behavior:'allow', updatedInput: Record<string,unknown> (필수, 빈 {} 면 원본 input
  사용), updatedPermissions?: PermissionUpdate[], toolUseID?: string, decisionClassification?:
  'user_temporary'|'user_permanent'|'user_reject' }`
- **deny**: `{ behavior:'deny', message: string (필수, 모델한테 줄 피드백), interrupt?: boolean,
  toolUseID?: string, decisionClassification?: ... }`

`updatedInput: {}` 의 의미: schema 의 line 110 — "Mobile clients responding from a push notification
don't have the original tool input, so they send `{}` to satisfy the schema. Treat an empty object
as 'use original' so the tool doesn't run with no args." 즉 빈 객체면 자식이 원래 input 그대로
사용. AskUserQuestion 의 answers 같은 사용자 응답을 inject 하려면 여기 입력값 형태로 넣음.

### 11.4 Phase 1 진입 시 적용 사항

`src/main/session.ts` baseArgs:

```ts
const baseArgs = [
  '-p',
  '--output-format', 'stream-json',
  '--input-format',  'stream-json',
  '--verbose',
  '--permission-mode', 'bypassPermissions',
  '--permission-prompt-tool', 'stdio'   // ← 신규 (필수)
  // (제거) '--disallowed-tools', 'AskUserQuestion'
  // (제거) '--include-hook-events'   ← probe 전용
  // (제거) '--settings', '<hook-probe-settings.json>'   ← probe 전용
]
```

전제: hongtail 이 control_request 를 받아 control_response 로 응답하는 흐름 (§5.2 그대로) 을 먼저
구현해야 함. 안 하면 자식이 응답 대기로 영원히 stuck.

### 11.5 정리 항목 (✅ 종료)

- ✅ `scripts/hook-probe-stub.cjs` 삭제
- ✅ `scripts/hook-probe-settings.json` 삭제
- ✅ `src/main/session.ts` 의 `probeLog` / `PROBE_LOG` / `tmpdir` / `appendFileSync` 제거
- ✅ baseArgs 의 probe 전용 항목 (`--include-hook-events`, `--settings`, `--debug`) 제거 — `--permission-prompt-tool stdio` 만 신규 항목으로 영구 추가
- ✅ `--disallowed-tools AskUserQuestion` 영구 제거
- ✅ `docs/plan-mode-askuserquestion.md` history 형태로 갱신
- ✅ `CLAUDE.md` 의 docs 표 + 빠른 동작 모델 갱신

## 12. 종료 (Phase 1 완료)

`host-confirm-ui` 브랜치의 Phase 1.1 + 1.2 commit:

| 커밋 | 내용 |
|---|---|
| `f608591` | Phase 0 probe — control_request 라인 raw 덤프 (이후 §11.5 로 정리됨) |
| `0d1124c` | Phase 0 probe C — `--permission-prompt-tool stdio` 가 결정적 |
| `ea04757` | docs: §11 신설, 활성화 플래그 확정 |
| `0aa6679` | feat: Phase 1.1 control_request 양방향 채널 + auto-allow |
| `7e756a9` | docs: §11.3 control_response 형식 확정 |
| `1aaa212` | feat: Phase 1.2 AskUserQuestion/ExitPlanMode 카드 + 사용자 응답 |

main 머지 후 작업: §6 Phase 2 (선택 — 다른 deferred tool 일반 confirm card) 는
보류. 현재 `--permission-prompt-tool stdio` 가 들어가서 일반 도구의 ask (예:
content-specific safety) 도 control_request 로 올라올 수 있는데, Phase 1 의
fallback 자동 allow (`App.tsx` 의 ensureClaudeSubscription) 가 처리. 별도 UI
필요해지면 그때 §6 디자인 적용.

이 결정들은 작업 시작 시 이 문서 끝에 [Decisions] 섹션 추가해서 기록.
