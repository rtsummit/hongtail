# Web 모드 — 외부 브라우저에서 hongluade UI 띄우기

Last Updated: 2026-04-27

`HONGLUADE_WEB=1` 환경변수로 활성화. main process 가 BrowserWindow 외에 별도
HTTP 서버 (`src/main/web.ts`) 를 띄워 외부 브라우저에서 같은 UI 를 로드 + 같은
세션을 조작할 수 있게 한다.

## 활성화

설정 (⚙) → "웹 모드" 섹션:
- [x] 웹 서버 활성화
- 포트: 9879 (기본)
- TLS 인증서 / 키: "선택…" 으로 두 PEM 파일 모두 채우면 자동 HTTPS

체크박스 변경 즉시 main 서버 재시작. 호스트는 항상 `0.0.0.0` (인증으로 보호).
설정은 `app.getPath('userData')/web-settings.json` 에 저장.

콘솔에 `[web] http(s)://0.0.0.0:9879/login` 뜨면 활성. 브라우저로 접속:
- 같은 PC: `http://127.0.0.1:9879/login`
- 같은 LAN: `http://<PC-LAN-IP>:9879/login`
- 외부: 포트포워딩 + 공인 IP 또는 tunnel (외부 노출 절 참고)

**첫 로그인**: 사용자명 `rtsummit`, 초기 비밀번호 `abutton`. 로그인 직후 비밀
번호 변경 페이지로 강제 redirect 된다. 8자 이상 + 초기값과 다른 새 비밀번호
설정 후 main UI 진입.

이후 로그인은 변경한 비밀번호 사용. credentials 는 `app.getPath('userData')/
web-credentials.json` (Windows: `%APPDATA%/hongluade/web-credentials.json`) 에
salt + sha256 hash 로 저장.

세션 cookie (`hongluade_s`):
- HttpOnly + SameSite=Strict, HTTPS 모드면 Secure
- 절대 만료 24h, idle 만료 30분
- `/logout` 으로 즉시 만료

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

- **인증은 단일 사용자 + 비밀번호 + cookie 세션**. 비밀번호는 sha256+salt
  로 저장 (PoC — bcrypt 미적용). 노출되면 모든 권한 노출.
- HTTPS 가 아니면 비밀번호 / 세션 cookie 가 평문 채널에 흐름. LAN 안에서도
  악의적 same-network 공격 가능. 진짜 외부 노출 시에는 **반드시 HTTPS**:
  - 자체 종단: `HONGLUADE_WEB_TLS_CERT` + `HONGLUADE_WEB_TLS_KEY` 에 PEM 경로
  - 외부 종단: cloudflare tunnel / nginx + Let's Encrypt (`## 외부 노출`)
- 인터넷 노출 옵션은 `## 외부 노출` 절 참고.
- CSP `default-src 'self'` — 같은 origin 이라 fetch / EventSource 가 통과. 다른
  origin 에서 reverse proxy 거치는 경우 CSP / CORS 재검토 필요.
- 세션 격리 없음 — 모든 클라이언트가 같은 view 를 본다. 이는 multi-device
  (나의 PC + 나의 폰) 가 같은 hongluade 인스턴스에 동시 붙는 의도된 동작.

## HTTPS — self-signed 인증서

LAN / 외부 노출 시 비밀번호와 세션 cookie 가 평문으로 흐르지 않도록 HTTPS
권장. 자체 종단을 위한 self-signed 인증서 생성:

```bash
# 한 번만. SAN 에 자기 PC 의 LAN IP 도 포함
mkdir -p certs
MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout certs/key.pem -out certs/cert.pem -days 1825 \
  -subj "/CN=hongluade" \
  -addext "subjectAltName=DNS:localhost,DNS:hongluade.local,IP:127.0.0.1,IP:::1,IP:192.168.0.14"
```

(`MSYS_NO_PATHCONV` 는 git bash 의 path 변환 회피용. PowerShell / wsl 에서는
불필요.) `certs/` 는 `.gitignore` 처리.

활성화: 설정 (⚙) → 웹 모드 → TLS 인증서 / 키에서 cert.pem / key.pem 두 파일
선택. 둘 다 채워지면 자동으로 HTTPS 로 재시작. cookie 의 `Secure` 플래그도
자동 켜짐.

**브라우저 신뢰**:
- PC: 첫 진입 시 "안전하지 않은 사이트" 경고 → "고급" → "계속" 클릭. 또는
  `cert.pem` 을 OS 의 신뢰할 수 있는 root CA 저장소에 추가하면 경고 사라짐
  (Windows: `certmgr` → 신뢰할 수 있는 루트 인증 기관 → 가져오기).
- 모바일: `cert.pem` 을 디바이스에 옮긴 후 OS 인증서 설정에서 "신뢰할 수
  있는 인증서" 로 추가. iOS 는 추가 후 "설정 → 일반 → 정보 → 인증서 신뢰
  설정" 에서 켜야 fully trusted.
- 안 따라하면 매 접속마다 경고 통과 필요.

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
