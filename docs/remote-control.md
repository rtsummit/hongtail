# Remote Control — 모바일/웹 Claude 앱에서 hongtail 세션이 안 보이는 이유

Last Updated: 2026-04-27

공식 Claude 앱(모바일/웹)은 로컬에 실행 중인 `claude` CLI 세션에 "Remote Control"로 붙어 대화를 이어갈 수 있다. 그런데 **hongtail 가 띄운 세션은 그 목록에 안 잡힌다**. 왜 그런지, 그리고 붙이려면 무엇이 필요한지를 검증한 노트.

## 한 줄 요약

모바일 앱이 붙는 식별자(`bridgeSessionId`)는 **인터랙티브 모드(`entrypoint=cli`)에서만** 발급된다. hongtail 는 `-p`(headless) + stream-json IPC 로 spawn 하므로 `entrypoint=sdk-cli` 가 되고, `--remote-control-session-name-prefix` 플래그를 추가해도 bridge 등록이 일어나지 않는다.

## 등록 메커니즘 — `~/.claude/sessions/{pid}.json`

claude CLI 는 시작 시 자기 자신을 `~/.claude/sessions/{pid}.json` 에 등록한다. 모바일 앱이 이 디렉토리를 읽어 붙을 세션 후보를 보여주는 구조.

**인터랙티브로 직접 띄운 세션** (붙을 수 있음):

```json
{
  "pid": 10120,
  "sessionId": "d9addd70-...",
  "cwd": "C:\\Workspace\\hongtail",
  "version": "2.1.119",
  "peerProtocol": 1,
  "kind": "interactive",
  "entrypoint": "cli",
  "status": "idle",
  "updatedAt": 1777215959959,
  "bridgeSessionId": "session_016cvtYg7pvT5sMA3UMStu2J"
}
```

**hongtail 가 spawn 한 세션** (안 보임):

```json
{
  "pid": 20100,
  "sessionId": "37ed6d76-...",
  "cwd": "C:\\Workspace\\hongtail",
  "version": "2.1.119",
  "peerProtocol": 1,
  "kind": "interactive",
  "entrypoint": "sdk-cli"
}
```

차이는 `entrypoint` 와 `bridgeSessionId`·`status`·`updatedAt` 의 유무. `bridgeSessionId` 가 빠지면 모바일 앱이 식별·매핑할 수 없다.

## 검증 — 플래그 단독 추가는 효과 없음

CLI help 에 `--remote-control-session-name-prefix <prefix>` 가 있어 이걸 hongtail spawn args 에 추가하면 될 것처럼 보였다. 직접 띄워서 확인:

```bash
claude -p --output-format stream-json --input-format stream-json \
       --verbose --permission-mode bypassPermissions \
       --remote-control-session-name-prefix hongtail-test \
       --session-id <uuid>
```

결과: `~/.claude/sessions/{pid}.json` 은 여전히 `entrypoint:"sdk-cli"` 이고 `bridgeSessionId` 가 없다. 즉 `-p` 모드에서는 prefix 플래그가 bridge 등록 자체를 발생시키지 않는다.

## 그리고 양립 불가능 제약

`--input-format stream-json` 은 CLI help 상 **"only works with --print"** 다. 즉 hongtail 의 현재 통신 방식(stream-json IPC) 과 인터랙티브 모드는 동시에 켤 수 없다. 모바일 연동을 가능하게 하려면 통신 방식 자체를 바꿔야 한다.

## 핵심 파일

- `src/main/session.ts:23-48` — `spawnClaude` (현재 spawn args)
- `~/.claude/sessions/{pid}.json` — 외부 등록 파일 (코드 아님, OS 디스크)

## TODO — B안: 인터랙티브 + PTY 재설계

모바일 연동을 진짜로 켜려면 `-p` headless 를 버리고 인터랙티브 모드로 띄워야 한다. 작업 윤곽:

- `node-pty` 로 PTY 안에서 인터랙티브 `claude` 실행 (현재 `child_process.spawn` 대체)
- spawn args 에서 `-p`, `--input-format stream-json`, `--output-format stream-json` 제거
- 입출력은 ANSI 시퀀스가 섞인 TUI 스트림이 되므로 stream-json 파서 대신 다른 통신 채널 필요. 후보:
  - claude 가 인터랙티브에서 노출하는 control protocol (있으면 그걸 사용; peerProtocol 필드가 힌트)
  - PTY 출력 raw 파싱 — 가장 fragile, 비추
- `claude:send-input` / `claude:control-request` 핸들러 전부 새 채널에 맞춰 재작성
- `bridgeSessionId` 가 자동 발급되는지, 발급되면 모바일 앱에 `cwd: C:\\Workspace\\hongtail` 인 hongtail 세션이 보이는지 검증
- 세션 식별·재개 동작 확인 — 현재 `--session-id`/`--resume` 흐름이 인터랙티브에서도 동일하게 동작하는지

작업량이 크므로 모바일 연동의 우선순위가 충분히 올라갔을 때 착수.

## 대안 — 하이브리드 hack (비권장)

IPC용 `-p` 세션은 그대로 두고, 같은 `--session-id` 로 더미 인터랙티브 세션을 백그라운드에서 띄워 register 만 시키는 방안. 두 프로세스가 같은 `~/.claude/projects/.../{sessionId}.jsonl` 을 동시에 만지면서 충돌 가능성이 있고, 모바일 앱이 더미에 붙어도 실제 hongtail IPC 와 연결되지 않는다. 동작 보장이 없으므로 기록만 남김.
