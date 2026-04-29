# Plan mode 의 AskUserQuestion / ExitPlanMode

Last Updated: 2026-04-30 (v0.1.14 — host confirm UI 로 해결, 본 문서는 history)

> **현재 상태**: 본 문서가 분석한 자동 deny 문제는 v0.1.14 의 **host confirm UI**
> (`docs/host-confirm-ui-plan.md`) 로 풀렸다. spawn args 의
> `--permission-prompt-tool stdio` 가 `can_use_tool` control_request 를 stdout 으로
> emit 시키고, hongtail 이 그걸 받아 카드 (`AskUserQuestionCard` /
> `ExitPlanModeCard`) 로 표시한 뒤 사용자 응답을 stdin 으로 control_response
> 회신한다. `--disallowed-tools AskUserQuestion` 임시 회피는 영구 제거.
>
> 본 문서는 이전 진단 + 임시 회피의 history 로 남겨둔다 — 같은 류의 자동 deny
> 패턴이 다른 도구에서 또 보이면 분석 절차의 reference.

## 한 줄 요약 (history)

`-p` (non-interactive print) 모드 + stream-json IPC 로 spawn 했기 때문에 SDK 가
`AskUserQuestion` / `ExitPlanMode` 같은 인터랙티브 도구를 띄울 콘솔 UI 가 없어
즉시 deny 했다. **사실** (probe 후 확정): 정확히는 spawn args 에
`--permission-prompt-tool stdio` 가 빠져 있어 `print.ts:4276` 의 분기가 fallback
경로로 빠졌고, `can_use_tool` control_request 가 stdout 으로 emit 되지 않아
SDK consumer (호스트) 가 응답할 기회 자체가 없었다.

## 증상 (history — 더 이상 발생 안 함)

`~/.claude/projects/.../{sessionId}.jsonl` 에서 다음 패턴:

```jsonl
// assistant turn — 도구 호출
{ "type":"assistant", "message":{"content":[{"type":"tool_use","name":"AskUserQuestion",
  "input":{"questions":[{"question":"...", "options":[{"label":"...","description":"..."}, ...]}]}}]} }
// 같은 turn 안 — 합성 deny tool_result (하나의 응답 내에서 둘 다 emit)
{ "type":"user", "message":{"content":[{"type":"tool_result", "is_error":true, "content":"Answer questions?"}]} }
// 다음 assistant turn — 모델이 "응답 없음" 으로 오해석
{ "type":"assistant", "message":{"content":[{"type":"text","text":"사용자가 질문에 답하지 않으셨어요. 합리적 디폴트로 ... Plan 에이전트에 ... 진행하겠습니다."}]} }
```

UI 상으로는 빨간 "Answer questions?" 카드 + assistant 가 자기 마음대로 디폴트
골라서 진행. `ExitPlanMode` 도 동일 — content 가 "Exit plan mode?" 만 다름.

## 원인 (history)

### 임시 회피 — `--disallowed-tools AskUserQuestion` (v0.1.14 에서 제거)

`src/main/session.ts` 의 baseArgs 에 `--disallowed-tools AskUserQuestion` 한 줄
추가해 도구 자체를 비활성화. Claude 는 옵션 카드 대신 텍스트로 번호 매긴 질문을
던지고, 사용자는 채팅 입력으로 답한다. 0.003초 자동 deny 가 사라지지만 옵션 UI
의 UX 는 잃는다. `ExitPlanMode` 는 회피 안 됨 — plan mode 자체 못 씀.

### 진단 (Phase 0 probe, host-confirm-ui-plan.md §11)

처음엔 control_request 자체가 stdout 으로 안 emit 되는 것으로 보였다 (probe A/B
에서 빈손). claude-code-main 의 `print.ts:4267-4292` `getCanUseToolFn` 을 확인해보니:

```ts
if (permissionPromptToolName === 'stdio') {
  return structuredIO.createCanUseTool(...)  // ← can_use_tool flow 활성화
}
if (!permissionPromptToolName) {
  return ... hasPermissionsToUseTool(...)  // ← 단순 fallback (control_request emit X)
}
```

`--permission-prompt-tool stdio` 인자가 없으면 fallback 경로로 빠져서 호스트가
응답할 채널 자체가 없다. probe C 에서 그 플래그를 추가하니 control_request 가
정상으로 stdout 에 emit 되고 PermissionRequest hook 도 race 로 같이 발화함.

## 정통 fix (v0.1.14)

`src/main/session.ts` 의 baseArgs 에:

```ts
const baseArgs = [
  '-p',
  '--output-format', 'stream-json',
  '--input-format',  'stream-json',
  '--verbose',
  '--permission-mode', 'bypassPermissions',
  '--permission-prompt-tool', 'stdio'   // ← 신규 (필수)
  // (제거) '--disallowed-tools', 'AskUserQuestion'
]
```

+ `src/main/session.ts` 의 stdout readline 에 control_request 분기 + 신규 IPC
`claude:respond-control` (자식 stdin 으로 control_response write) + 렌더러의
`AskUserQuestionCard` / `ExitPlanModeCard` 컴포넌트.

자세히는 `docs/host-confirm-ui-plan.md`.

## 핵심 파일 (현재)

- `src/main/session.ts` — `--permission-prompt-tool stdio`, control_request 분기, `claude:respond-control` IPC
- `src/preload/index.ts`·`index.d.ts` — `respondControl` / `onControlRequest` 노출
- `src/renderer/src/types.ts` — `Block` union 의 `ask-user-question` / `exit-plan-mode` variant
- `src/renderer/src/components/AskUserQuestionCard.tsx` / `ExitPlanModeCard.tsx`
- `src/renderer/src/App.tsx` — `ensureClaudeSubscription` 의 control_request 핸들러
  + `handleAskUserQuestion*` / `handleExitPlanMode*`
