# 호스트 Confirm UI 구현 계획 — Phase 2

Last Updated: 2026-04-29
Branch: `interactive-mode` (별 세션에서 cherry-pick 또는 새 브랜치로 시작 권장)

> **이 문서의 목적**: 다른 세션이 self-contained 로 읽고 즉시 구현 시작할 수 있게 모든 컨텍스트를
> 박아둔 plan. plan mode + AskUserQuestion + 23개 deferred tool 의 자동 deny 를 호스트 confirm UI
> 로 풀어내는 작업.

## 0. 한 줄 요약

`-p` stream-json 모드의 claude CLI 가 `can_use_tool` control_request 를 stdout 으로 emit 하면
hongtail 가 호스트 UI (옵션 카드 / plan 승인 카드 등) 띄우고 사용자 응답을 stdin 으로 control_response
회신하는 양방향 채널을 구현한다. 한 번 만들면 23개 deferred tool 모두 회복됨.

## 1. 배경 — 왜 필요한가

### 1.1 현재 증상

`app` 백엔드 (`-p --output-format stream-json --input-format stream-json --permission-mode
bypassPermissions`) 에서 다음 시나리오 모두 0.003초 자동 deny 로 작동 불능:

| 시나리오 | 트리거 | deny 결과 |
|---|---|---|
| `AskUserQuestion` 옵션 카드 | 모델이 사용자 선택 요청 | `tool_result is_error:true content:"Answer questions?"` |
| plan mode 의 `ExitPlanMode` | 사용자가 plan mode 진입 후 plan 작성 | 같은 패턴, plan 종료 불가 |
| 인터랙티브 빌트인 (`/help`, `/cost` 등) | 슬래시 입력 | synthetic `"isn't available in this environment"` (별 케이스) |
| 23개 deferred tools 전체 | `EnterPlanMode`, `ExitPlanMode`, `AskUserQuestion`, `CronCreate`, `EnterWorktree`, `PushNotification`, `RemoteTrigger`, `ToolSearch` (등) | 같은 자동 deny 패턴 |

현재 임시 회피: `src/main/session.ts` 의 `--disallowed-tools AskUserQuestion` — 이 도구만 차단,
나머지는 그대로 deny 발생. plan mode 자체는 회피 안 됨.

### 1.2 근본 원인

claude CLI 의 두 가지 권한 채널:

- **bypassPermissions / acceptEdits / plan / default**: 일반 도구 (Read, Bash, Edit 등) 의 자동/수동
  승인 정책. hongtail 의 `--permission-mode bypassPermissions` 로 통과
- **deferred tool**: bypassPermissions 와 *별개로*, **호스트 측 confirm UI 가 반드시 필요**한 도구.
  claude CLI 가 `can_use_tool` control_request 를 stdout 으로 emit → SDK consumer (호스트) 가 응답
  안 보내면 즉시 deny (또는 짧은 timeout)

hongtail 는 **두 번째 채널의 incoming control_request 를 처리하지 않음**. parseClaudeEvent 의
`default: return []` 로 stdout 의 control_request 라인이 무시됨.

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

### 2.3 wire format (확정된 부분 + 추정)

stdout 라인 (자식 → 호스트):
```json
{
  "type": "control_request",
  "request_id": "<uuid>",
  "request": {
    "subtype": "can_use_tool",
    "tool_use_id": "<toolu_...>",
    "tool_name": "AskUserQuestion" | "ExitPlanMode" | ...,
    "input": { /* tool input — questions, plan 등 */ }
  }
}
```

stdin 라인 (호스트 → 자식):
```json
{
  "type": "control_response",
  "response": {
    "subtype": "success" | "error",
    "request_id": "<uuid>",
    "response": {
      "behavior": "allow" | "deny",
      "updatedInput": { /* AskUserQuestion 의 answers 같은 사용자 응답 */ }
    }
  }
}
```

**확정 안 된 것** (Phase 0 probe 에서 확인):
- `request.request` 안의 정확한 필드 구성 (특히 `input` 의 형태가 도구별로 다름)
- `response` 안의 `behavior` 외 다른 필드 (예: `updatedInput`, `interrupt`, `cancel`)
- `AskUserQuestion` 의 user answers 회신 구조 (`{[question]: answer}` map?)
- `ExitPlanMode` 의 plan 승인 회신 (단순 allow vs plan 텍스트 modify)
- timeout — 호스트가 응답 안 보내면 몇 초 후 deny? (현재 0.003초는 즉시 deny 의 인상)

## 3. Phase 0 — wire format probe (1~2시간)

목표: §2.3 의 미확정 필드를 결정. 가설 1 이 이미 코드로 확정이라 probe 는 *형식 확인* 만.

### 3.1 절차

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

### 3.2 분기

| probe 결과 | 다음 단계 |
|---|---|
| control_request can_use_tool 이 stdout 으로 정상 도착 + 0.003초보다 긴 timeout (예: 5초+) | Phase 1 진행 — 호스트 UI + control_response 송신 구현 |
| control_request 자체가 안 도착 (자식이 즉시 deny) | claude CLI 가 deferred tool 을 *호스트 통보 없이* 자동 deny. Phase 1 불가. fallback (§7) 만 가능 |
| control_request 도착하지만 timeout 이 너무 짧아 (0.003초) UI 띄울 시간 없음 | Phase 1 가능하지만 *pre-confirm* 패턴 필요 — 사전 정책 (예: 자동 allow 모든 deferred tool) 으로 즉시 응답. UI 는 사후 결과 표시용 |

probe 가 0.003초 자동 deny 의 원인을 결정함. 가장 가능성 높은 시나리오: **timeout 매우 짧음
(밀리초 단위) → 호스트가 응답 안 보내면 즉시 deny**. 이 경우 호스트는 control_request 가 들어오자
마자 *동기적으로* 응답해야 함 — 사용자 입력 대기는 불가. 대신 미리 정책 결정 (auto-allow / auto-deny)
또는 plan-mode 같은 hint 기반 동적 결정.

이는 §5.2 의 IPC 디자인을 결정.

## 4. 임시 회피 vs 정통 길

### 4.1 자동 confirm hack (작은 작업, 일시적)

probe 결과에 따라 timeout 짧으면, 호스트가 control_request 받자마자 자동 `behavior: "allow"` 응답.
사용자 confirm 단계 생략, 그러나 plan mode 의 read-only 보호와 AskUserQuestion 의 옵션 UX 는
사라짐. 하지만 *plan 작성 자체는 가능* (ExitPlanMode 가 allow 되면 plan 끝나고 일반 모드 전환).

### 4.2 정통 — 호스트 UI (Phase 1)

control_request 받으면 host UI 띄움 → 사용자 응답 → control_response 송신. 단 timeout 이 매우 짧으면
호스트 UI 가 띄워지기 전에 자식이 deny 처리할 수 있음. 이 경우 두 단계 분리:

- 자식의 control_request 도착 시 hongtail 가 *즉시* `behavior: "allow"` (또는 "pending") 회신
- 동시에 host UI 띄워 사용자 응답 받음
- 사용자가 거부하면 *그 다음 turn* 의 input 으로 "취소" 메시지 inject

이건 timeout 회피 패턴. 정확한 동작은 Phase 0 probe 결과에 따라 결정.

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

- **timeout 너무 짧음**: §3.2 의 시나리오 3 — 호스트 UI 띄우기 전에 자식이 deny. 해결: 즉시
  `pending` 응답 후 사용자 응답 도착 시 *다음 turn* 으로 결과 inject. 또는 §3.2 재 probe.
- **control_request 가 해당 backend 에만 도착**: interactive 백엔드는 PTY 기반이라 stdout 이 ANSI.
  control_request 흐름은 app 백엔드 전용. interactive 는 §7 의 행동 변경 (전환) 으로 대응.
- **--disallowed-tools 제거 시 retro**: 기존 사용자가 AskUserQuestion 시나리오에서 텍스트 폴백에
  익숙해진 경우, UX 가 갑자기 옵션 카드로 변함. 옵션 추가: settings 에 "deferred tool 호스트 UI"
  toggle.

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
- `docs/interactive-token-stream-paths.md` — interactive vs app 백엔드 한계 종합. §9 가 본 작업의 동기

## 9. 작업 순서 권장

1. **Phase 0** (1~2시간): probe → wire format §2.3 미확정 부분 채우기
2. **Phase 1.1** (반나절): `src/main/session.ts` + preload + types.ts 변경 — control_request 흐름
   확보 (UI 없이 자동 allow 로 응답 — fallback 형태). plan mode 가 *작동만* 하는지 검증
3. **Phase 1.2** (반나절~1일): AskUserQuestionCard + ExitPlanModeCard 컴포넌트 + App.tsx 핸들러.
   사용자 선택이 모델에 도달하는지 검증
4. **(선택) Phase 2**: 일반 DeferredToolCard 로 23개 전체 confirm UI

Phase 1.1 만 완성해도 plan mode 가 풀린다. UI 는 점진 개선.

## 10. 결정해야 할 것 (작업 시작 전)

- [ ] timeout 정책 — Phase 0 probe 결과에 따라 §4.2 의 두 단계 (즉시 allow + 사후 결과) vs 직접
      대기 결정
- [ ] AskUserQuestion 의 multiSelect / preview / "Other" 옵션 — UI 에서 다 지원할지 minimum 만 할지
- [ ] settings 에 "deferred tool UI" toggle 추가 여부 — 기존 텍스트 폴백 UX 유지 옵션 제공할지
- [ ] interactive 백엔드와의 호환 — app 만 적용 / interactive 는 PTY TUI 가 자체 처리

이 결정들은 작업 시작 시 이 문서 끝에 [Decisions] 섹션 추가해서 기록.
