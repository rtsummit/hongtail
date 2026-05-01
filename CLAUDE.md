# hongtail

Claude Code CLI 헤드리스를 데스크톱에서 챗 UI 로 감싼 Electron 앱 (React + TypeScript).
한 워크스페이스 안에 여러 Claude 세션·BTW 사이드 챗·터미널을 띄워 쓰는 게 목적.
v0.1.6+ 부터는 외부 브라우저/모바일에서도 같은 UI 로 접속 가능 (web 모드).

## 빠른 동작 모델

- 메인 IPC 채널: stdin/stdout JSONLines on `claude -p --input-format stream-json --output-format stream-json`.
- 자식 spawn 시 `--permission-mode bypassPermissions` + `--permission-prompt-tool stdio` 고정. 후자는 interactive deferred tool (AskUserQuestion / ExitPlanMode) 의 권한 요청을 자식 stdout 의 `can_use_tool` control_request 로 emit 시키는 핵심 플래그 (`docs/host-confirm-ui-plan.md` §11.1). 호스트는 카드 UI (`AskUserQuestionCard` / `ExitPlanModeCard`) 띄우고 사용자 응답을 stdin 으로 control_response 회신. 그 외 deferred tool 은 자동 allow fallback.
- jsonl 은 `~/.claude/projects/<encodeCwd(workspacePath)>/<sessionId>.jsonl` 에 작성 — readonly 와 라이브 watch 둘 다 이 파일을 읽음. watcher 는 `claudeWatch.ts` (디렉토리 watch + filename 필터, 150ms debounce → `claude:session-changed:<sid>` 로 broadcast). read 변형: `read-session` (전체) / `read-session-from` (offset 기반 incremental) / `read-session-tail` (마지막 N) / `read-session-range` (라인 범위) — 4종이 readonly 페이지·tail watch·terminal status watch 에서 각각 사용.
- i18n: react-i18next, `locale/{ko,en}.ts` flat dict, `{key}` placeholder (기본 `{{key}}` 대신 가독성·grep 용으로 single brace). `AppSettings.language` ('auto' | 'ko' | 'en') 변경 시 `App.tsx` effect 가 `i18n.changeLanguage` 호출. 'auto' 면 `navigator.language` → ko/en, 미지원은 ko fallback.

## 백엔드 2종 (`src/renderer/src/types.ts`)

| backend | 통신 | 렌더 | 모바일 remote | 비고 |
|---|---|---|---|---|
| `app` | stream-json IPC (`-p`) | ChatPane | ✗ (`entrypoint=sdk-cli`) | 기본값. `src/main/session.ts` |
| `terminal` | node-pty (인터랙티브) | xterm raw | ✓ | `src/main/pty.ts` |

사이드바의 "+ 새 대화" 버튼은 `app` 백엔드, 그 옆 "+ 새 터미널" 버튼은 `terminal` 백엔드로 새 세션을 시작.

## 디렉토리 지도

```
src/main/
  index.ts            앱 부팅 + 핸들러 등록 + Alt+F4 가로채기 + dev:available/restart RPC
  session.ts          'app' 백엔드 (claude -p stream-json) spawn / sendInput / control_request
  pty.ts              'terminal' 백엔드용 node-pty wrapper
  btw.ts              사이드 챗 — 매 질문마다 ephemeral `claude -p --tools '' --no-session-persistence`
  claude.ts           jsonl 목록·read 4종 (full/from-offset/tail/range). `encodeCwd`, `projectDir`
  claudeWatch.ts      sessionId 별 fs.watch (디렉토리 watch + filename 필터, 150ms debounce, broadcast)
  rpc.ts              dev 모드 HTTP RPC (127.0.0.1:9876, test: 9877, env override 가능). E2E·자동화용
  web.ts              web 모드 HTTP+RPC+SSE+정적 서빙. webAuth/webSse 를 re-export 하는 façade
  webAuth.ts          web 모드 비밀번호 단독 로그인 (cookie session, salt+sha256, 절대 24h + idle 30m)
  webSse.ts           web 모드 SSE 푸시 — 첫 subscriber 도착 전 emit 손실 방지용 ring buffer 1000
  webSettings.ts      web 모드 설정 (web-settings.json: enabled/port/TLS/host)
  ipc.ts              registerInvoke — ipcMain.handle 과 web RPC 동시 등록 helper
  dispatch.ts         broadcast — 모든 webContents + SSE 양쪽으로 같은 이벤트 forward
  jsonFile.ts         userData JSON 설정 파일 (workspaces/web-settings/aliases) read/write 보일러
  files.ts            일반 파일 첨부 (~/.claude/file-cache/<sessionId>/), files:read/save/open-external
  workspaces.ts       워크스페이스 CRUD (userData/workspaces.json)
  sessionAliases.ts   세션 별칭 — claude `/rename` 과 setAt 비교로 sync
  slashCommands.ts    /, builtin + project + user + plugin merge
  usageCache.ts       /cost·rate-limit 캐시
  fonts.ts, images.ts, logging.ts

src/preload/
  index.ts, index.d.ts  ipcRenderer.invoke 래퍼. window.api 로 노출

src/renderer/src/
  App.tsx             상태 hub — selected, messagesBySession, statusBySession, MRU, 글로벌 단축키
  components/         ChatPane, Sidebar, TerminalSession, FindBar, SideChatPanel, UsageBar,
                      AskUserQuestionCard, ExitPlanModeCard (host-confirm UI),
                      SettingsModal (font/tool defaults/language), TodoPanel, ThinkingIndicator,
                      WorkspaceCard, SessionRow, SessionTitleArea, SlashCompletion,
                      CodeBlock + PrismBoundary, QuoteAffordance, QuoteChips
  hooks/
    useTerminalStatusWatch.ts  'terminal' 라이브 세션의 jsonl tail → status 만 추출 (messages append 안 함)
  claudeEvents.ts     stream-json 이벤트 → Block[] 변환 (jsonl record 도 같은 파서)
  sessionStatus.ts    extractUsage / extractRateLimit / pickVerb 등 상태 추출 헬퍼
  todoState.ts        TaskCreate/Update tool-use → TodoPanel 상태 누적
  rpcBridge.ts        main 의 dev RPC 서버가 실행할 함수들을 window.__rpc 에 노출
  btwPrompt.ts        메인 + BTW history → BTW system prompt
  webShim.ts          브라우저용 window.api shim (fetch + EventSource). Electron 환경은 no-op
  settings.ts         AppSettings (fonts/fontSize/readonlyChunkSize/toolCardsDefaultOpen/language). localStorage
  toolContext.ts      ToolDefaultOpenContext — 설정에서 ToolBlock 까지 도구 펼침 set 전달
  locale/             ko.ts / en.ts (flat dict) + index.ts (react-i18next init, resolveLang)
  langDetect.ts       파일 확장자 / 파일명 → Prism Language 매핑
  prismSetup.ts, markdownComponents.tsx, fileOpenerLogic.ts, diffMode.ts
```

## 핵심 docs (depth 가 필요할 때 우선 참조)

| 주제 | 파일 |
|---|---|
| stream-json 채널·control_request·인터럽트·이미지 첨부 | `docs/sendinput-flow.md` |
| 모바일 remote 가 hongtail 세션을 못 보는 이유 | `docs/remote-control.md` |
| 외부 브라우저/모바일에서 hongtail UI 접속 | `docs/web-mode.md` |
| BTW 사이드 챗 아키텍처·세션 leak 방지·인코딩 hazard | `docs/btw-side-chat.md` |
| Ctrl+F (Custom Highlight API + xterm SearchAddon) | `docs/find.md` |
| `claude --resume` 호환성 | `docs/cli-resume.md` |
| 세션 별칭 sync 규칙 | `docs/session-aliases.md` |
| Plan mode·AskUserQuestion 의 호스트 confirm UI (핵심 — `--permission-prompt-tool stdio`) | `docs/host-confirm-ui-plan.md` |
| 위 문제의 원래 진단·임시 회피 (history) | `docs/plan-mode-askuserquestion.md` |
| 로고 자산 (master SVG, ICO/PNG 변환, 적용 위치) | `docs/logo.md` |

## 자주 쓰는 명령

```bash
npm run dev              # electron-vite dev (HMR)
npm run typecheck        # node + web 둘 다
npm run lint             # eslint
npm test                 # vitest run (단위 테스트)
npm run build            # typecheck + electron-vite build
npm run build:win:portable
```

## 글로벌 단축키 (App.tsx)

- **Ctrl+Tab / Ctrl+Shift+Tab** — VS Code 식 MRU 세션 사이클. Ctrl 떼는 순간 head 확정.
- **Ctrl+W** — 선택된 라이브 세션 종료 (confirm 후 stopSession / pty.kill).
- **Ctrl+F** — Find bar 토글. mode 는 `findMode` (app: Custom Highlight API / terminal: xterm SearchAddon, `docs/find.md`).
- **ESC** — 진행 중 turn 인터럽트 (selected 가 thinking 일 때만). modal/find-bar 등이 자체 ESC 를 처리하면 stopPropagation 으로 가드.
- **Shift+Tab** — 'app' 백엔드 세션의 permission mode 사이클 (default → acceptEdits → plan). bypassPermissions / auto 는 사이클 제외, 메뉴로만 진입.
- **Alt+F4** — `before-input-event` 에서 가로채 `mainWindow.close()` 강제. xterm textarea 가 ESC+F4 시퀀스로 PTY 에 전달해 OS 가 못 받는 케이스 회피.

## dev RPC (자동 검증 채널)

`is.dev` 일 때만 `127.0.0.1:9876` (test 인스턴스: `9877`) 에 HTTP 엔드포인트가 뜸.
`/state`, `/messages/:sid`, `/sessions/start|select|activate|send|control|wait-result`, `/workspaces/add`, `/screenshot`, `/quit`.
`HONGTAIL_RPC_EVAL=1` 이면 `/eval` 도 노출. 포트는 `HONGTAIL_RPC_PORT` 로 override 가능. 라우팅은 `src/main/rpc.ts`, 실제 동작은 `src/renderer/src/rpcBridge.ts` 의 `window.__rpc.*`.

## web 모드 (외부 브라우저/모바일)

설정 → 웹 모드 에서 활성화. main process 가 BrowserWindow 와 별개로 HTTP 서버
를 띄우고 (`src/main/web.ts` — 인증·SSE 는 `webAuth.ts` / `webSse.ts` 로 분리, web.ts 가
re-export 로 façade), 정적 자산 + RPC + SSE 양쪽 채널을 외부에 노출.
- 인증: 비밀번호 단독 로그인 (사용자명 없음). credentials 는 GUI 의 웹 모드 섹션
  에서 set. salt+sha256 으로 hash 저장 (`web-credentials.json`). 세션은 cookie
  (`hongtail_s`, HttpOnly + SameSite=Strict, HTTPS 면 Secure), 절대 24h + idle 30m,
  비밀번호 변경 시 모든 기존 세션 무효화.
- SSE: emit 측이 먼저 fire 하고 첫 EventSource 연결이 한두 RTT 늦으면 첫 신호 손실
  → spinner 가 안 풀리는 hang 발생. 해결책: subscriber=0 이면 `webSse.ts` 의
  ring buffer (limit 1000) 에 쌓아두고 첫 subscriber 가 붙는 순간 flush. 한 emitter
  가 throw 해도 (`ERR_STREAM_DESTROYED`) stale 한 거 하나만 set 에서 빼고 계속.
- 호스트는 `0.0.0.0` 고정, 포트는 GUI 에서 변경 가능. cert/key 두 PEM 파일 지정
  하면 자동 HTTPS.
- 다른 client 의 active session 동기화는 5초 주기 polling 으로 sidebar 의 jsonl
  목록 refresh. SSE 기반 실시간 동기화는 의도적으로 빼서 단순화.
- **dev 모드에서 web 은 Vite HMR 을 안 받음.** `serveStatic` 이 `out/renderer/`
  의 빌드 산출물을 그대로 서빙 (`src/main/web.ts` 의 `serveStatic`). `npm run dev`
  는 Electron 렌더러용 Vite dev 서버만 띄우고 `out/renderer/` 는 안 건드린다.
  → 렌더러 코드를 고치면 Electron 창은 HMR 로 즉시 반영되지만 **브라우저 web
  탭은 옛 번들** 그대로다. web 에서 검증·재현하려면 `npm run build` (또는 빠르게
  `electron-vite build --renderer`) 로 `out/renderer/` 를 갱신한 뒤 브라우저 탭
  새로고침. dev-restart 만 하고 build 안 하면 web 사용자는 영향 없음.
- 자세히는 `docs/web-mode.md`.

## 별도 인스턴스 (병행 dev)

`HONGTAIL_TEST=1 npm run dev` 로 띄우면 process.title=`hongtail_test`, jsonl 파일 leak 안 섞이고 RPC 포트 9877 사용. 자동 검증·실험용.

## 관습 / 주의

- 자식 stdin 에 보낼 라인은 끝에 `\n` 필수. Windows shell 우회: 한글·긴 문자열은 stdin/임시파일로 보냄 — positional argument 금지 (`docs/btw-side-chat.md` 의 인코딩 hazard 참조).
- user message echo 는 자식이 안 해 줌 → ChatPane 의 `handleSend` 가 IPC 호출과 동시에 직접 Block 을 push.
- 인터럽트는 ChatPane ◼ (`control_request interrupt` — 세션 살림) vs Sidebar ◼ (`stopSession` — child kill, 라이브 종료) 두 종류.
- session id 는 hongtail 가 `randomUUID()` 로 발급해 spawn args 의 `--session-id` / `--resume` 로 전달, IPC 채널 키와 jsonl 추적 키로 동시에 사용.
- `~/.claude/projects/...` 의 jsonl 인코딩 규칙은 `encodeCwd` (`[^a-zA-Z0-9.-]` → `-`). claude CLI 와 동일.
- IPC 핸들러 새로 추가할 때는 `registerInvoke` (event 미사용) 또는 `ipcMain.handle` 직접. event-aware 인 경우 web 측은 별도. broadcast 가 필요한 push 채널은 `dispatch.broadcast` 사용 — 모든 webContents + SSE 양쪽 forward.
- 새로고침 reconcile: mount 직후 `claude.listActive` + `pty.listActive` 로 살아있는 세션 복원. 'app' 백엔드는 stream-json IPC 가 끊긴 상태라 onEvent 재구독 + jsonl 리플레이로 messages/status 재구성. selected 는 sessionStorage 에 보존되며 reconcile 까지는 readonly 로 강제 — race 로 마지막 turn 일부가 잃을 수 있지만 PoC 단계에서는 무시.
- 사용자 facing 텍스트는 hardcode 하지 말고 `i18n.t(key)` 사용. 새 키는 `locale/ko.ts` + `locale/en.ts` 양쪽에 추가. 누락 시 기본 fallback (영문 키 그대로) 이라 빌드는 통과하지만 다른 언어에서 raw key 가 노출됨.
- 플랫폼: **Windows 만 테스트됨**. macOS / Linux 빌드 스크립트는 있지만 실제 동작 검증 안 됨.
