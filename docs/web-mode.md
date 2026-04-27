# Web 모드 — 외부 브라우저에서 hongluade UI 띄우기

Last Updated: 2026-04-27

`HONGLUADE_WEB=1` 환경변수로 활성화. main process 가 BrowserWindow 외에 별도
HTTP 서버 (`src/main/web.ts`) 를 띄워 외부 브라우저에서 같은 UI 를 로드 + 같은
세션을 조작할 수 있게 한다.

## 활성화

PowerShell:

```powershell
$env:HONGLUADE_WEB = "1"
.\dist\hongluade-0.1.5-portable.exe
```

또는 dev 모드:

```bash
HONGLUADE_WEB=1 npm run start
```

띄우면 콘솔에 `[web] http://127.0.0.1:9879` 가 뜬다. 브라우저로 같은 URL 접속.

`HONGLUADE_WEB_PORT` 로 포트 변경 가능.

## 구조

```
브라우저                main process
                        ┌─ Electron BrowserWindow ── ipcMain.handle(...)
                        │
                        ├─ web.ts HTTP server (HONGLUADE_WEB=1 시)
정적 GET / ────────────►│       └─ out/renderer 그대로 serve
POST /rpc {method,args} │       └─ registerRpc 로 등록된 핸들러
GET  /events?topic=... ◄┘       └─ registerEventSource / emitSse SSE fan-out
```

- `registerInvoke(channel, handler)` (`src/main/ipc.ts`) 가 `ipcMain.handle` 과
  `web.registerRpc` 양쪽에 같은 핸들러 등록.
- `broadcast(channel, event)` (`src/main/dispatch.ts`) 가 모든 BrowserWindow
  의 webContents + SSE fan-out 양쪽으로 같은 이벤트 forward. 기존 `webContents.
  send(...)` 호출처를 이걸로 대체했다.
- 브라우저 측 `window.api` 는 `src/renderer/src/webShim.ts` 가 채운다.
  Electron preload 가 이미 채워뒀으면 no-op.

## 작동 / 미작동 (PoC 단계)

| 영역 | 상태 |
|---|---|
| 워크스페이스 목록 / 별칭 | ✓ |
| readonly 세션 보기 / jsonl tail | ✓ |
| 라이브 세션 (app / interactive / terminal) | ✓ (사용자 메시지 / control 모두) |
| PTY (xterm) | ✓ (web 의 xterm 도 같은 SSE 채널로 데이터 받음) |
| BTW (side question) | ✓ |
| 이미지 첨부 | ✓ (base64 로 인코드 후 RPC 전송) |
| Usage / SlashCommand / SessionAlias | ✓ |
| 워크스페이스 추가 다이얼로그 | ✗ (OS dialog — 텍스트 입력 fallback 작업 별도) |
| 폰트 목록 | △ (호스트 폰트 그대로 — 클라이언트엔 그 폰트 없을 수 있음) |
| 클립보드 paste (Ctrl+V) | △ (브라우저 권한 prompt 의존) |

## 한계 / 보안

- **PoC 단계는 127.0.0.1 only**. LAN 노출은 인증 (별도 commit) 후.
- 인증 0 — 같은 머신의 다른 프로세스는 무인증 접근 가능. 외부 노출 절대 금지.
- CSP `default-src 'self'` — 같은 origin 이라 fetch / EventSource 가 통과. 다른
  origin 에서 reverse proxy 거치는 경우 CSP / CORS 재검토 필요.
- 세션 격리 없음 — 모든 클라이언트가 같은 view 를 본다. 이는 multi-device
  (나의 PC + 나의 폰) 가 같은 hongluade 인스턴스에 동시 붙는 의도된 동작.

## 관련

- `src/main/web.ts` — HTTP 서버, RPC dispatch, SSE fan-out
- `src/main/ipc.ts` — registerInvoke helper
- `src/main/dispatch.ts` — broadcast helper
- `src/renderer/src/webShim.ts` — 브라우저용 window.api
