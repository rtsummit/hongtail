# hongluade

Claude Code CLI 헤드리스를 데스크톱에서 챗 UI 로 감싼 Electron 앱 (React + TypeScript).
한 워크스페이스 안에 여러 Claude 세션·BTW 사이드 챗·터미널을 띄워 쓰는 게 목적.

## 빠른 동작 모델

- 메인 IPC 채널: stdin/stdout JSONLines on `claude -p --input-format stream-json --output-format stream-json`.
- 자식 spawn 시 `--permission-mode bypassPermissions` 고정 + `--disallowed-tools AskUserQuestion` (호스트 옵션 카드 UI 가 아직 없어서 임시 비활성).
- jsonl 은 `~/.claude/projects/<encodeCwd(workspacePath)>/<sessionId>.jsonl` 에 작성 — readonly 모드와 라이브 watch 둘 다 이 파일을 읽음.

## 백엔드 3종 (`src/renderer/src/types.ts:1-7`)

| backend | 통신 | 렌더 | 모바일 remote | 비고 |
|---|---|---|---|---|
| `app` | stream-json IPC (`-p`) | ChatPane | ✗ (`entrypoint=sdk-cli`) | 기본값. `src/main/session.ts` |
| `terminal` | node-pty (인터랙티브) | xterm raw | ✓ | `src/main/pty.ts` |
| `interactive` | PTY (입력) + jsonl tail (출력) | ChatPane | ✓ | `feature/interactive-backend` 작업 중. `docs/interactive-jsonl-tail.md` |

기본 백엔드는 설정 (`AppSettings.defaultBackend`) — `SettingsModal` 에서 변경.

## 디렉토리 지도

```
src/main/
  index.ts            앱 부팅 + 핸들러 등록 + Alt+F4 가로채기
  session.ts          'app' 백엔드 (claude -p stream-json) spawn / sendInput / control_request
  pty.ts              'terminal'·'interactive' 백엔드용 node-pty wrapper
  btw.ts              사이드 챗 — 매 질문마다 ephemeral `claude -p --tools '' --no-session-persistence`
  claude.ts           jsonl 목록·tail·watch (`encodeCwd`, `projectDir`, `readSessionFromOffset`, fs.watch)
  rpc.ts              dev 모드 HTTP RPC (127.0.0.1:9876, test: 9877). E2E·자동화용
  workspaces.ts       워크스페이스 CRUD (userData/workspaces.json)
  sessionAliases.ts   세션 별칭 — claude `/rename` 과 setAt 비교로 sync
  slashCommands.ts    /, builtin + project + user + plugin merge
  usageCache.ts       /cost·rate-limit 캐시
  fonts.ts, images.ts, logging.ts

src/preload/
  index.ts, index.d.ts  ipcRenderer.invoke 래퍼. window.api 로 노출

src/renderer/src/
  App.tsx             상태 hub — selected, messagesBySession, statusBySession, MRU 등
  components/         ChatPane, Sidebar, TerminalSession, FindBar, SideChatPanel, UsageBar 등
  claudeEvents.ts     stream-json 이벤트 → Block[] 변환 (jsonl record 도 같은 파서)
  sessionStatus.ts    extractUsage / extractRateLimit / pickVerb 등 상태 추출 헬퍼
  rpcBridge.ts        main 의 dev RPC 서버가 실행할 함수들을 window.__rpc 에 노출
  btwPrompt.ts        메인 + BTW history → BTW system prompt
```

## 핵심 docs (depth 가 필요할 때 우선 참조)

| 주제 | 파일 |
|---|---|
| stream-json 채널·control_request·인터럽트·이미지 첨부 | `docs/sendinput-flow.md` |
| 인터랙티브 백엔드 jsonl tail 채택 근거 | `docs/interactive-jsonl-tail.md` |
| 모바일 remote 가 hongluade 세션을 못 보는 이유 | `docs/remote-control.md` |
| BTW 사이드 챗 아키텍처·세션 leak 방지·인코딩 hazard | `docs/btw-side-chat.md` |
| Ctrl+F (Custom Highlight API + xterm SearchAddon) | `docs/find.md` |
| `claude --resume` 호환성 | `docs/cli-resume.md` |
| 세션 별칭 sync 규칙 | `docs/session-aliases.md` |
| Plan mode + AskUserQuestion 임시 비활성 | `docs/plan-mode-askuserquestion.md` |
| ANSI 파싱 옵션 (보류) | `docs/interactive-ansi-parsing.md` |

## 자주 쓰는 명령

```bash
npm run dev              # electron-vite dev (HMR)
npm run typecheck        # node + web 둘 다
npm run lint             # eslint
npm run build            # typecheck + electron-vite build
npm run build:win:portable
```

## dev RPC (자동 검증 채널)

`is.dev` 일 때만 `127.0.0.1:9876` (test 인스턴스: `9877`) 에 HTTP 엔드포인트가 뜸.
`/state`, `/messages/:sid`, `/sessions/start|select|send|control|wait-result`, `/screenshot`, `/quit`.
`HONGLUADE_RPC_EVAL=1` 이면 `/eval` 도 노출. 라우팅은 `src/main/rpc.ts`, 실제 동작은 `src/renderer/src/rpcBridge.ts` 의 `window.__rpc.*`.

## 별도 인스턴스 (병행 dev)

`HONGLUADE_TEST=1 npm run dev` 로 띄우면 process.title=`hongluade_test`, jsonl 파일 leak 안 섞이고 RPC 포트 9877 사용. 자동 검증·실험용.

## 관습 / 주의

- 자식 stdin 에 보낼 라인은 끝에 `\n` 필수. Windows shell 우회: 한글·긴 문자열은 stdin/임시파일로 보냄 — positional argument 금지 (`docs/btw-side-chat.md` 의 인코딩 hazard 참조).
- user message echo 는 자식이 안 해 줌 → ChatPane 의 `handleSend` 가 IPC 호출과 동시에 직접 Block 을 push.
- 인터럽트는 ChatPane ◼ (`control_request interrupt` — 세션 살림) vs Sidebar ◼ (`stopSession` — child kill, 라이브 종료) 두 종류.
- session id 는 hongluade 가 `randomUUID()` 로 발급해 spawn args 의 `--session-id` / `--resume` 로 전달, IPC 채널 키와 jsonl 추적 키로 동시에 사용.
- `~/.claude/projects/...` 의 jsonl 인코딩 규칙은 `encodeCwd` (`[^a-zA-Z0-9.-]` → `-`). claude CLI 와 동일.
