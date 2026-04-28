# (아이디어) 인터랙티브 백엔드 + ANSI 파싱으로 chat UI

Last Updated: 2026-04-27

> **미구현 아이디어 노트.** 채택 보류, 우선순위는 jsonl tail 방식 뒤. 여기는 그 길의 그림과 위험을 미리 박아두는 자리.

## 배경

`remote-control.md` 의 B안 (PTY + 인터랙티브 모드) 으로 가면 hongtail 가 지금 쓰는 stream-json 채널이 사라진다. 인터랙티브 모드의 통신 채널은 PTY 의 TTY 하나뿐 (`peerProtocol` 은 session 메타에 박히는 버전 상수일 뿐 별도 IPC 가 아님).

그 위에서 chat UI 를 그리려면 두 후보 — **(이 문서) 옵션 1: PTY 출력 raw ANSI 를 우리가 직접 파싱** vs **옵션 4: jsonl tail watch**.

## 그림

```
[node-pty 가상 TTY]
   ├─→ renderer xterm  (raw view 토글 — 디버깅 / fallback)
   └─→ main 의 ANSI 파서 (xterm-headless 등)
          │
          ├─ cell grid 상태 추적
          ├─ 메시지 경계 / role / streaming 추출
          └─ IPC ─→ renderer chat UI

[사용자 입력] ─→ keystroke 시퀀스로 변환 ─→ PTY stdin
```

xterm-headless 는 브라우저 의존성을 뺀 xterm.js 라 main 에서 그대로 쓸 수 있고, `term.buffer.active.getLine(y).translateToString()` 같은 API 로 cell 격자 상태를 읽는다.

## 매력

- **single source of truth** — 사용자가 보는 화면 == 우리가 파싱한 화면. 누락 없음.
- **jsonl 의존 0** — 포맷·flush 타이밍 변화에 면역.
- **슬래시 커맨드 그대로** — `/permissions`, `/model`, `/compact`, `/clear` 같은 인터랙티브 전용 빌트인이 TUI 에서 자체 처리되므로 stream-json 환경에서 못 했던 게 풀린다.
- **모바일 remote 자동 활성화** — `entrypoint=cli` 가 되면서 `bridgeSessionId` 가 발급된다 (`cli.js` 의 `_ = q || $ || K || !process.stdout.isTTY` 분기에서 PTY 안에 띄우면 `_` 가 false → entrypoint=cli).

## Challenge — 진짜 비용은 시맨틱 레이어

ANSI 파싱 자체는 공짜 (xterm-headless 가 cell 격자까지 만들어 줌). 비용은 그 위에 얹는 의미 추출이다.

| 항목 | 내용 |
|---|---|
| 메시지 경계 | claude TUI 의 색·박스·들여쓰기·빈 줄에 의존. UI 한 번 바뀌면 휴리스틱 깨짐. 사람 눈이 메시지를 구분하는 단서 그대로 쓰는 거라 사람이 읽을 수 있다면 파서도 따라갈 수는 있음 |
| streaming token | 같은 cell 이 prefix 부터 누적 갱신. 헤드리스 xterm 의 cell-level diff 를 보면 되지만, "현재 응답 메시지의 다음 부분" 으로 패치 적용하는 로직 필요 |
| TUI chrome 분리 | 입력 prompt 박스, 스피너, status bar 등은 메시지 아님. 보통 화면 하단 고정 영역으로 분리. alt screen 모드 사용 여부 (`\x1b[?1049h`) 도 확인 필요 — alt screen 이면 scrollback 추출 불가 |
| scrollback | 화면 위로 밀려난 메시지. xterm-headless 의 scrollback buffer 가 보존하지만 무한이 아니라 길어지면 잘림. 우리가 따로 "이미 본 라인" 누적 저장 필요 |
| 터미널 크기 | wrap 영향 최소화하려면 PTY 를 매우 넓게 (예: 200×500). 너무 좁으면 코드블록이 wrap 으로 깨져 파싱 어려움 |

## 검증 시 가장 먼저 봐야 할 것

claude TUI 가 **메시지 경계를 어떤 ANSI 패턴으로 표시하는가** — 이게 안정적이지 않으면 옵션 1 전체가 무너진다.

가장 짧은 검증 경로:

1. 인터랙티브 `claude` 띄움 (PTY 안이든 그냥 터미널이든)
2. 짧게 두세 turn 대화
3. PTY raw stdout 을 `fs.appendFileSync` 로 dump → escape 시퀀스 패턴 관찰: 메시지 시작/종료 마커, alt screen 사용 여부, streaming 의 갱신 패턴

`src/main/pty.ts` 의 `proc.onData` 에 한 줄 끼워넣으면 끝.

## 결정

**채택 안 함.** jsonl tail 방식이 fragile 하지 않고 (의미 단위가 이미 구조화), claude CLI 가 의도적으로 기록한 형식이라 변경 risk 도 낮다. 우선 그쪽 길로 간다.

이 옵션이 다시 후보로 올라오는 시나리오:
- 인터랙티브 모드 jsonl 이 streaming 도중에 안 flush 되어 chat UI 의 실시간성이 떨어짐
- 인터랙티브 모드 jsonl 의 record 구조가 `-p` 와 달라 readonly 렌더 코드를 그대로 못 씀
- jsonl 자체가 인터랙티브 + 옵션 조합에 따라 안 만들어지는 케이스가 발견됨

## 관련

- `remote-control.md` — B안의 큰 그림 + 모바일 연동 동기
- `cli-resume.md` — 같은 근본 원인 (`-p` headless 가 인터랙티브 단절)
- `sendinput-flow.md` — 현재 stream-json 채널 (이걸 대체하는 일)
