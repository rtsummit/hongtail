# hongtail 세션을 `claude` CLI 에서 resume 못하는 이유

Last Updated: 2026-04-27

hongtail 앱에서 시작한 대화를, 같은 워크스페이스에서 `claude` CLI 의 `--resume` / `/resume` / `claude -r` picker 로 이어가려고 하면 잘 안 된다. 코드 레벨 원인 정리.

## 한 줄 요약

hongtail 는 `claude` 를 `-p` (print/headless) + stream-json 모드로 spawn 한다 (`spawnClaude` in `src/main/session.ts`). 이 모드로 만든 jsonl 은 ① 인터랙티브 REPL 의 resume picker 가 라벨로 쓰는 `summary` 메타가 없어 picker 에서 안 보이고, ② cwd 가 일치하지 않으면 picker 가 jsonl 디렉토리 자체를 못 찾는다. 파일은 표준 위치(`~/.claude/projects/<encoded-cwd>/<UUID>.jsonl`)에 있긴 하다.

## 호출 형태 (anchor: `spawnClaude` in `src/main/session.ts`)

```
claude -p
       --output-format stream-json
       --input-format stream-json
       --verbose
       --permission-mode bypassPermissions
       (--session-id <UUID>  | --resume <sessionId>)
```

- `cwd: workspacePath` 로 spawn → 자식이 jsonl 을 `~/.claude/projects/<encodeCwd(workspacePath)>/<UUID>.jsonl` 에 작성한다.
- 새 세션은 `--session-id <UUID>` (hongtail 가 `randomUUID()` 로 생성).
- 이어가기는 `--resume <sessionId>`.

## 인코딩 (anchor: `encodeCwd` in `src/main/claude.ts`)

```
[^a-zA-Z0-9.-]  →  '-'
```

예: `C:\Workspace\hongtail` → `C--Workspace-hongtail`. Claude CLI 자체의 인코딩 규칙과 일치하므로 같은 cwd 라면 동일 디렉토리를 본다.

## 왜 CLI 에서 resume 이 막히는가

세 가지 시나리오가 있다.

### (a) `claude` REPL 의 resume picker 에 hongtail 세션이 안 보임

- 인터랙티브 REPL 이 만드는 jsonl 은 첫 줄에 `{"type":"summary", "summary":"...", "leafUuid":...}` 메타가 붙는다. picker 는 그 summary 를 라벨로 쓴다.
- `-p` print 모드로 만든 jsonl 은 summary 가 없고 `user` 메시지로 바로 시작한다 → picker 가 라벨을 못 만들거나 항목을 숨긴다.

### (b) `claude --resume <UUID>` 로 ID 직접 지정해도 실패

- CLI 의 resume 은 호출 시점의 `process.cwd()` 를 인코딩해서 jsonl 을 찾는다.
- hongtail 가 세션을 만든 워크스페이스(`session.workspacePath`)와 다른 폴더에서 CLI 를 띄우면 다른 디렉토리를 뒤져서 못 찾는다.
- 같은 폴더에서 띄웠는데도 안 되면 (a) 의 형식 차이 가능성이 더 높다.

### (c) 다른 cwd 에서 시도

가장 흔한 사용자 실수. hongtail UI 는 `workspacePath` 를 명시적으로 표시하니, CLI 도 정확히 그 경로에서 띄워야 한다. Windows 의 대소문자 / 슬래시 변형은 인코딩 결과에 영향 없지만 (regex 가 케이스-센시티브), 부모 폴더에서 띄우면 당연히 다른 jsonl 디렉토리가 된다.

## 우회 (현재로서는)

1. `~/.claude/projects/<encoded-cwd>/` 디렉토리에서 hongtail 세션 jsonl 을 직접 열어 UUID 확인.
2. **같은 cwd** 에서 `claude --resume <UUID>` 로 ID 명시.
3. 그래도 안 되면 jsonl 첫 줄에 summary 항목이 없는 게 원인 — 현재로서는 hongtail 세션을 인터랙티브 REPL 로 옮겨가는 깔끔한 방법은 없다.

## 향후 개선 후보

- spawn 시 `-p` 를 떼고 인터랙티브 REPL 모드로 자식을 띄우면 picker 호환성이 좋아질 가능성. 단, stream-json IPC 와 호환성 재검증 필요.
- 또는 hongtail 가 세션 생성 시 jsonl 첫 줄에 summary 메타를 직접 inject 하는 후처리.
- 둘 다 검증된 바 없음 — TODO.
