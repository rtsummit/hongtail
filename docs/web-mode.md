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

띄우면 콘솔에 `[web] http://127.0.0.1:9879/?t=<token>` 가 뜬다. 브라우저로
**그 URL 그대로** 접속 (`?t=<token>` 포함). 첫 진입 시 토큰을 cookie 에 저장
하므로 그 다음부턴 `?t=` 없는 URL 도 OK. 다른 디바이스로 이동하면 다시 `?t=`
URL 로 첫 진입.

환경변수:

| | 기본값 | 설명 |
|---|---|---|
| `HONGLUADE_WEB` | (off) | `1` 일 때만 web 서버 활성 |
| `HONGLUADE_WEB_PORT` | `9879` | listen 포트 |
| `HONGLUADE_WEB_HOST` | `127.0.0.1` | binding 주소. LAN 노출하려면 `0.0.0.0` |
| `HONGLUADE_WEB_TOKEN` | (random) | 인증 토큰. 비우면 시작 시 16bytes hex 자동 생성 |

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

- **인증은 단일 토큰**. 모든 정적 자산 / RPC / SSE 가 토큰 검증을 통과해야
  응답. 토큰 노출 = 모든 권한 노출. URL 공유 시 `?t=` 부분이 history / 서버
  로그에 남을 수 있음 — 신뢰 디바이스에서만 사용.
- LAN 노출 (`HOST=0.0.0.0`) 자체는 가능하지만 **HTTPS 가 아니므로 LAN 안에서도
  토큰이 평문**. 신뢰 가능한 LAN 에서만 쓰거나 reverse proxy 로 TLS 종단을
  앞에 두기.
- 인터넷 노출 옵션은 `## 외부 노출` 절 참고.
- CSP `default-src 'self'` — 같은 origin 이라 fetch / EventSource 가 통과. 다른
  origin 에서 reverse proxy 거치는 경우 CSP / CORS 재검토 필요.
- 세션 격리 없음 — 모든 클라이언트가 같은 view 를 본다. 이는 multi-device
  (나의 PC + 나의 폰) 가 같은 hongluade 인스턴스에 동시 붙는 의도된 동작.

## 외부 노출

집 밖 모바일에서도 접근하려면 LAN 만으로 부족. 옵션 (PoC 권장 순):

### 1. tailscale (권장)
zero-trust VPN. hongluade 호스트 PC + 모바일에 tailscale 설치 → 호스트에
`HONGLUADE_WEB_HOST=127.0.0.1` 그대로 두고 tailscale 의 100.x.x.x 주소로
모바일에서 접속. tailscale 자체가 인증 + 암호화 종단. 추가 설정 0, 외부에
포트 안 열려도 된다.

```powershell
# 호스트 (default 127.0.0.1 binding 그대로)
$env:HONGLUADE_WEB = "1"
.\dist\hongluade-0.1.5-portable.exe
# 모바일 → http://<tailscale-ip>:9879/?t=<token>
```

다만 default `127.0.0.1` binding 으로는 tailscale 인터페이스 IP 가 안 보임.
`HONGLUADE_WEB_HOST=0.0.0.0` 또는 tailscale IP 명시 필요.

### 2. cloudflare tunnel
`cloudflared` 설치 후 `cloudflared tunnel --url http://127.0.0.1:9879`. 임시
도메인 (또는 자기 도메인 연결) 생성 + 자동 TLS. hongluade 자체는 LAN 노출
안 해도 됨 — cloudflared 가 outbound 만 사용. 도메인이 인터넷에 노출되어도
인증 토큰이 있으면 안전 (그래도 토큰 노출 위험은 동일).

### 3. reverse proxy + DDNS
nginx + Let's Encrypt + 공유기 포트포워딩. 가장 손이 많이 가나 의존 외부
서비스 0.

PoC 단계 권장: **tailscale**. 외부 포트 노출 없이 내 디바이스만 접근 가능.

## 관련

- `src/main/web.ts` — HTTP 서버, RPC dispatch, SSE fan-out
- `src/main/ipc.ts` — registerInvoke helper
- `src/main/dispatch.ts` — broadcast helper
- `src/renderer/src/webShim.ts` — 브라우저용 window.api
