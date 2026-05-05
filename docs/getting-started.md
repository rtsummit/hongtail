# hongtail 시작하기

hongtail 은 Claude Code CLI 를 데스크톱 챗 UI 로 감싼 Electron 앱입니다.
한 워크스페이스 안에 여러 Claude 세션·BTW 사이드 챗·터미널을 동시에 띄워
쓰는 게 목적이고, v0.1.6+ 부터는 외부 브라우저·모바일에서도 같은 UI 로
접속할 수 있습니다.

이 가이드는 처음 hongtail 을 켜는 사람을 위한 풀 가이드입니다.
설치 → 첫 대화 → 다중 세션 → 사이드 챗 → 권한 카드 → 검색·단축키 →
설정·웹 모드 순서로 안내합니다.

---

## 0. 설치 전에 확인

hongtail 자체는 챗 UI 일 뿐, 실제로 모델과 대화하는 건 **Claude Code CLI**
입니다. 따라서 다음 두 가지가 먼저 필요합니다.

1. **Node.js 18+ 가 깔려 있고**, 터미널에서 `claude --version` 이 동작.
   - 설치 안 되어 있으면 [Claude Code 공식 안내](https://docs.claude.com/en/docs/claude-code/overview)
     를 따라 `npm i -g @anthropic-ai/claude-code` 등으로 설치하세요.
   - 한 번이라도 `claude` 를 실행해 로그인이 끝나 있어야 합니다.
2. **Windows 10/11**. macOS·Linux 빌드 스크립트는 있지만 실제 동작 검증은
   Windows 에서만 이뤄졌습니다.

준비가 됐으면 hongtail 본체를 받습니다.

- 포터블 빌드: `npm run build:win:portable` 결과물의 단일 exe 를 실행하면
  설치 없이 동작합니다.
- 소스에서 직접 띄우려면: `npm install` → `npm run dev`.

---

## 1. 첫 실행 — 메인 화면 한눈에

처음 켜면 아래 같은 메인 화면이 나옵니다.

![hongtail 메인 화면](screenshots/main.png)

영역별로 어떤 일을 하는 곳인지부터 정리합니다.

| 위치 | 이름 | 역할 |
|---|---|---|
| 왼쪽 위 | **Workspace 추가** 버튼·드롭다운 | 작업할 폴더(=워크스페이스)를 추가·전환 |
| 왼쪽 상단 | **+ 새 대화 / + 새 터미널** | 현재 워크스페이스에 세션을 추가 |
| 왼쪽 본문 | **세션 목록** | 현재 워크스페이스에 속한 세션들 (라이브 + 과거 jsonl) |
| 가운데 위 | **세션 제목** | 클릭해서 별칭을 바꿀 수 있음 |
| 가운데 본문 | **메시지 영역** | 사용자·Claude 의 turn 이 시간순으로 쌓이는 곳 |
| 가운데 아래 | **입력 박스 + 보내기/인터럽트** | 메시지 입력, 전송, 진행 중이면 ◼ 인터럽트 |
| 맨 아래 | **상태 바 (UsageBar)** | 모델·컨텍스트 사용량·rate-limit 표시 |
| 오른쪽 (필요할 때) | **TodoPanel / 사이드 챗** | 할일 목록·BTW 사이드 챗 패널 |

---

## 2. 워크스페이스 추가

hongtail 은 폴더 단위로 작업 컨텍스트를 갈라 놓습니다. 이걸 **워크스페이스**
라고 부르고, 사이드바 맨 위 드롭다운에서 추가·전환합니다.

1. 왼쪽 위 드롭다운 옆 **+ Workspace 추가** 버튼을 누릅니다.
2. 폴더 선택 다이얼로그에서 작업할 디렉토리를 고릅니다.
   (예: `C:\Workspace\my-project`)
3. 추가하면 그 폴더가 사이드바 드롭다운에 등록되고, 이후 모든 새 세션은
   해당 폴더를 cwd 로 spawn 됩니다.

> **왜 폴더 단위인가요?** Claude Code CLI 는 cwd 의 코드만 안전하게
> 다룰 수 있게 동작하므로, hongtail 도 워크스페이스 = cwd 매핑을
> 유지합니다. 한 워크스페이스 = 한 git 리포 정도로 잡으면 편합니다.

---

## 3. 첫 대화 — `+ 새 대화`

워크스페이스를 골랐으면 사이드바의 **+ 새 대화** 버튼을 누릅니다.
새 세션이 추가되고 자동으로 선택됩니다.

1. 가운데 입력창에 질문을 적고 Enter (Shift+Enter 는 줄바꿈).
2. Claude 가 응답을 시작하면 **메시지 영역**에 turn 이 점차 쌓입니다.
3. 보내기 버튼은 진행 중이 되면 ◼ 인터럽트 버튼으로 바뀝니다. 누르면
   현재 turn 만 끊고 세션은 살려둡니다.

도중에 ESC 를 눌러도 같은 효과 (= 진행 중 turn 인터럽트) 입니다.

> 사이드바 쪽 ◼ 는 다릅니다. 그건 **세션 자체를 종료** (자식 프로세스 kill).
> ChatPane ◼ = turn 만 끊기, Sidebar ◼ = 세션 종료로 기억하세요.

---

## 4. 다중 세션 다루기

hongtail 의 가장 큰 차이는 **여러 세션을 동시에 띄우고 갈아탈 수 있다**는
점입니다.

### 4.1 세션 추가

- **+ 새 대화** — 일반 chat 세션 (`app` 백엔드, stream-json IPC).
- **+ 새 터미널** — 인터랙티브 터미널 세션 (`terminal` 백엔드, node-pty).
  Claude Code CLI 의 인터랙티브 모드를 그대로 쓰고 싶을 때.

두 백엔드의 차이는 다음과 같습니다.

| 백엔드 | 통신 | 렌더 | 모바일 remote | 비고 |
|---|---|---|---|---|
| `app` | stream-json IPC (`-p`) | 정돈된 ChatPane | ✗ | 기본값. 도구 카드·Todo 패널·BTW 등 hongtail 부가 기능 다 동작 |
| `terminal` | node-pty | xterm 그대로 | ✓ | Claude CLI 의 인터랙티브 UI 그대로. hongtail 부가 기능 일부 제한 |

### 4.2 세션 사이 빠른 전환 (MRU)

- **Ctrl+Tab / Ctrl+Shift+Tab** — VS Code 식 MRU 사이클.
  Ctrl 을 누른 채 Tab 을 여러 번 눌러 후보를 보고, Ctrl 을 떼는 순간 그
  세션이 확정됩니다.
- 사이드바에서 직접 클릭해도 됩니다.

### 4.3 세션 닫기

- **Ctrl+W** — 선택된 라이브 세션을 종료합니다 (확인 후 자식 kill).
- 사이드바의 ◼ 를 직접 눌러도 같은 효과.
- 종료된 세션은 라이브 목록에서 빠지고, **readonly 모드**로 사이드바에
  계속 남습니다. 클릭하면 jsonl 을 다시 열어 과거 대화를 볼 수 있습니다.

### 4.4 세션 별칭(이름) 바꾸기

세션 제목을 클릭하면 별칭을 바꿀 수 있습니다. Claude 안에서 `/rename`
슬래시 명령으로 바꾼 이름과도 자동으로 sync 됩니다 — 자세한 규칙은
[`session-aliases.md`](session-aliases.md).

---

## 5. BTW 사이드 챗 — 흐름 끊지 않고 빠른 질문

**BTW (Beside-the-Way)** 는 메인 세션 흐름은 그대로 두고 옆에서 잠깐
다른 질문을 던지고 싶을 때 쓰는 사이드 챗입니다.

- 메인 메시지 위에 마우스를 올리면 좌측에 **인용 affordance** (`"`) 가
  뜹니다. 클릭하면 그 메시지를 quote 한 채로 BTW 패널이 열립니다.
- BTW 는 매 질문마다 일회성 `claude -p --tools '' --no-session-persistence`
  로 동작합니다. 메인 세션의 jsonl 에 영향 없음, 도구 사용 없음, 가벼움.
- 메인 흐름과 별개로 BTW 자체의 짧은 history 도 유지됩니다.

자세한 아키텍처는 [`btw-side-chat.md`](btw-side-chat.md).

---

## 6. 권한 카드 — Plan mode / AskUserQuestion

Claude 가 작업 중간에 **사람의 확인**이 필요한 순간이 있습니다.

- **Plan mode 종료** (`ExitPlanMode`) — Plan 모드에서 실제 실행으로 넘어갈
  때 계획서가 카드로 뜹니다. **승인 / 거부 / 모드 변경** 중 하나를 고릅니다.
- **AskUserQuestion** — Claude 가 둘 이상 선택지를 두고 사용자에게
  질문할 때 카드가 뜹니다. 라디오 버튼으로 답을 고르거나 자유 입력으로
  답할 수 있습니다.

이 두 카드는 hongtail 이 자식 프로세스를 `--permission-prompt-tool stdio`
로 spawn 하기 때문에 작동합니다. 자세한 동작은
[`host-confirm-ui-plan.md`](host-confirm-ui-plan.md).

> 그 외의 도구 (Edit, Write, Bash 등) 는 자동으로 allow 됩니다 —
> hongtail 자체가 `--permission-mode bypassPermissions` 로 띄우기 때문.

---

## 7. 도구 카드 / Todo 패널

Claude 가 도구를 호출하면 **도구 카드**로 메시지 영역에 표시됩니다.
파일 read/edit, bash, web search, todo 등이 모두 카드 한 장으로
펼쳐집니다.

- 카드 헤더 클릭으로 펼침/접힘.
- 모든 카드를 처음부터 펼쳐 두고 싶으면 **설정 → 도구 카드 기본 펼침**
  on (`AppSettings.toolCardsDefaultOpen`).

**Todo 패널**은 Claude 가 `TaskCreate` / `TaskUpdate` 도구로 만든 할일을
오른쪽 사이드 패널에 누적해 보여줍니다. 진행률 한눈에 확인 용도.

---

## 8. 파일·이미지 첨부

- 입력창에 **파일 드래그**, 또는 **클립보드 이미지 붙여넣기 (Ctrl+V)**.
- 첨부된 파일은 `~/.claude/file-cache/<sessionId>/` 에 저장돼 Claude 에
  전달됩니다.
- 긴 텍스트도 그냥 붙여넣으면 hongtail 이 적절히 정리해 보냅니다.
  Windows shell 인자 인코딩 문제를 우회하기 위해, 한글·긴 문자열은 항상
  stdin 으로 보냅니다 (positional argument 안 씀).

---

## 9. 검색 (Ctrl+F)

- **Ctrl+F** — 현재 세션 안에서 검색 바를 토글합니다.
- `app` 세션은 Custom Highlight API 로 메시지 영역을 하이라이트하고,
  `terminal` 세션은 xterm SearchAddon 으로 터미널 버퍼를 검색합니다.
- 자세한 동작은 [`find.md`](find.md).

---

## 10. 슬래시 명령

입력창 맨 앞에 `/` 를 치면 **슬래시 명령 자동완성**이 뜹니다.

- builtin (`/cost`, `/rename`, `/clear`, ...)
- 프로젝트별 명령 (`<workspace>/.claude/commands/*.md`)
- 사용자 명령 (`~/.claude/commands/*.md`)
- 플러그인 명령

이 모두를 한 목록으로 합쳐 보여줍니다 (`src/main/slashCommands.ts`).

---

## 11. 자주 쓰는 단축키

| 키 | 동작 |
|---|---|
| **Ctrl+Tab / Ctrl+Shift+Tab** | 세션 사이 MRU 사이클 |
| **Ctrl+W** | 선택된 라이브 세션 종료 |
| **Ctrl+F** | 검색 바 토글 |
| **ESC** | 진행 중 turn 인터럽트 |
| **Shift+Tab** | `app` 세션의 권한 모드 사이클 (default → acceptEdits → plan) |
| **Alt+F4** | 창 닫기 (xterm 안에서도 동작) |
| **Enter / Shift+Enter** | 메시지 보내기 / 줄바꿈 |
| **Ctrl+V** | 클립보드 이미지·텍스트 붙여넣기 |

---

## 12. 설정 (Settings)

사이드바 아래쪽의 ⚙ (또는 메뉴) 에서 설정 창을 엽니다. 주요 항목:

- **언어** — 자동 / 한국어 / 영어. 자동은 `navigator.language` 기준.
- **폰트 / 폰트 크기** — UI 와 코드 블록 폰트.
- **도구 카드 기본 펼침** — 새 도구 카드를 처음부터 펼쳐 보일지.
- **읽기 청크 크기** — readonly 세션 jsonl 을 한 번에 몇 줄씩 로드할지.
- **웹 모드** — 외부 브라우저·모바일 접속 활성화 (다음 절).

설정은 즉시 저장되고 다음 실행에도 유지됩니다.

---

## 13. 웹 모드 — 다른 기기에서 hongtail 접속

같은 데스크톱이 아니라 **노트북·모바일 브라우저**에서 hongtail 을 그대로
쓰고 싶으면 웹 모드를 켭니다.

1. **설정 → 웹 모드** 섹션에서 **활성화** 체크.
2. 비밀번호를 한 번 설정합니다 (사용자명 없음, 비밀번호 단독 로그인).
3. 포트를 정합니다 (기본 4673 등).
4. 같은 네트워크의 다른 기기에서 `http://<데스크톱 IP>:<포트>` 로 접속.
5. 비밀번호로 로그인하면 동일한 UI 가 뜹니다.

세션 cookie 는 절대 24h + idle 30m 이고, 비밀번호를 바꾸면 모든 기존
세션이 무효화됩니다. cert/key PEM 파일을 지정하면 자동 HTTPS 로 뜹니다.

> **dev 모드 주의** — `npm run dev` 로 띄운 상태에서는 웹 탭에서 보이는
> 화면이 **`out/renderer/` 의 빌드 산출물**입니다. 렌더러 코드를 고치면
> Electron 창은 HMR 로 즉시 반영되지만 **브라우저 탭은 옛 번들 그대로**
> 입니다. 웹 모드에서 바뀐 UI 를 확인하려면 `npm run build` (또는
> `electron-vite build --renderer`) 로 `out/renderer/` 를 갱신하고 새로고침.

자세한 보안 모델·SSE 처리는 [`web-mode.md`](web-mode.md).

---

## 14. 자주 묻는 것 (FAQ)

**Q. 세션을 닫았는데 사이드바에 계속 남아 있어요.**
A. 라이브 세션은 종료됐지만 jsonl 파일은 그대로라서 readonly 로 다시 열
수 있습니다. 완전히 지우려면 OS 파일 탐색기에서
`~/.claude/projects/<encoded>/<sessionId>.jsonl` 파일을 삭제하세요.

**Q. `claude --resume` 으로 다른 도구에서 같은 세션을 이어 쓸 수 있나요?**
A. 가능하지만 호환성에 주의가 필요합니다. [`cli-resume.md`](cli-resume.md)
참조.

**Q. 모바일 (웹 모드) 에서 활성 세션이 안 보여요.**
A. `app` 백엔드 세션은 stream-json IPC 로 메인 프로세스 메모리에 묶여
있어 외부 클라이언트가 실시간 동기화되지 않습니다. 사이드바 jsonl
목록은 5 초마다 polling 으로 갱신됩니다. 자세한 사정은
[`remote-control.md`](remote-control.md).

**Q. 키보드 입력에서 한글이 깨져요.**
A. Claude Code CLI 에 positional argument 로 한글을 넘기면 Windows shell
인코딩 문제로 깨집니다. hongtail 은 stdin 으로만 보내도록 우회해 둬서
사용 중에는 문제 없어야 합니다. 만약 깨지면 이슈로 알려주세요.

**Q. Plan mode 카드 / AskUserQuestion 카드가 안 떠요.**
A. hongtail 이 자식을 `--permission-prompt-tool stdio` 로 띄울 때만 카드가
나옵니다. 외부에서 직접 `claude` 를 띄운 세션을 readonly 로 본 경우라면
카드가 안 뜨는 게 정상입니다.

---

## 15. 더 깊이 들어가려면

설계·내부 동작에 대한 자세한 문서들:

| 주제 | 파일 |
|---|---|
| stream-json 채널·control_request·인터럽트·이미지 첨부 | [`sendinput-flow.md`](sendinput-flow.md) |
| 모바일 remote 가 hongtail 세션을 못 보는 이유 | [`remote-control.md`](remote-control.md) |
| 외부 브라우저·모바일 접속 (웹 모드) | [`web-mode.md`](web-mode.md) |
| BTW 사이드 챗 아키텍처·인코딩 hazard | [`btw-side-chat.md`](btw-side-chat.md) |
| 검색 (Custom Highlight API + xterm SearchAddon) | [`find.md`](find.md) |
| Plan mode·AskUserQuestion 호스트 confirm UI | [`host-confirm-ui-plan.md`](host-confirm-ui-plan.md) |
| `claude --resume` 호환성 | [`cli-resume.md`](cli-resume.md) |
| 세션 별칭 sync 규칙 | [`session-aliases.md`](session-aliases.md) |
| 로고 자산 | [`logo.md`](logo.md) |

---

문제·제안은 GitHub 이슈로 남겨주세요.
