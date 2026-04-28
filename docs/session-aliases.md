# 세션 별칭 (session alias)

Last Updated: 2026-04-26

각 대화 (Claude Code 세션) 에 hongtail 가 자체적으로 부여하는 별칭. 워크스페이스 alias 와 별개의 키-값 저장소이며, sessionId 단위로 관리된다.

## 한 줄 요약

세션마다 `{alias, setAt}` 를 `~/.../session-aliases.json` 에 저장. readonly 진입 시 jsonl 의 마지막 `/rename` 이벤트와 timestamp 비교 — 더 최근인 쪽이 이긴다.

## 저장

- **위치**: `app.getPath('userData')/session-aliases.json` (Windows: `%APPDATA%\hongtail\session-aliases.json`)
- **스키마**:
  ```json
  {
    "<sessionId-uuid>": {
      "alias": "최최종",
      "setAt": "2026-04-26T01:23:45.678Z"
    }
  }
  ```
- **`setAt`** 의 의미: "이 별칭이 결정된 시점". 사용자가 직접 입력하면 `now()`, jsonl 에서 import 하면 그 `Session renamed to:` 이벤트의 timestamp.

## 자동 동기화 규칙

**트리거**: 세션을 readonly 모드로 선택하는 시점 (`App.handleSelect` 에서 `else` 분기).

**입력 신호** — claude CLI 의 `/rename` 은 jsonl 에 다음 형태로 남는다:

```json
{
  "type": "system",
  "subtype": "local_command",
  "content": "<local-command-stdout>Session renamed to: 홍로드</local-command-stdout>",
  "timestamp": "2026-04-25T04:40:32.313Z",
  ...
}
```

`sessionAliases.ts:findLatestRenameInJsonl` 가 jsonl 끝까지 한 번 스캔하면서 위 패턴 매칭되는 라인 중 **마지막** 것의 `{alias: "홍로드", setAt: "2026-04-25T04:40:32.313Z"}` 를 추출한다.

**의사결정** (`syncFromJsonl`):

| 상태 | 결과 |
|---|---|
| jsonl 에 `/rename` 흔적 없음 | 저장된 alias 그대로 유지 (없으면 없는 채로) |
| 저장된 alias 없음 | jsonl 의 alias 채택, `setAt` = jsonl timestamp |
| `stored.setAt >= jsonl.timestamp` | **저장된 alias 유지** (사용자가 jsonl rename 이후 직접 별칭을 갱신했다는 뜻) |
| `stored.setAt < jsonl.timestamp` | **jsonl 값으로 덮어쓰기**, `setAt` = jsonl timestamp |

ISO 8601 timestamp 는 lexicographic 비교가 시간 순서와 일치하므로 그대로 `>=` 로 비교한다.

## 사용자 직접 편집

사이드바 세션 행 (`SessionRow`, 그리고 graduated live row) 의 title 을 더블클릭 → 인라인 input → Enter / blur 로 커밋, Escape 로 취소.

- 빈 값으로 커밋하면 alias 제거 (저장소에서 키 삭제)
- 커밋 시 `setAt` 은 `now()` 로 갱신 — 이후의 `/rename` 보다 사용자 의도가 우선이라는 의미

이 규칙 덕에:

- 사용자가 hongtail 에서 별칭을 지은 뒤 claude CLI 에서 `/rename` 했을 때, **claude 의 rename 이 더 최근이면 자동 import** 됨 (의도: 같은 세션을 두 도구에서 열어도 최신 의사결정이 따라감)
- 거꾸로 hongtail 에서 별칭 갱신했고 claude 에서 더 옛날에 한 번 `/rename` 했을 뿐이면 **사용자 별칭이 지켜짐**

## 표시 우선순위

UI 에서 세션 title 을 결정할 때:

1. `aliasesBySession[sessionId].alias` (사용자 또는 sync 결과)
2. jsonl 에서 추출한 heuristic title (`parseSessionMeta` 가 첫 user message 를 cleanTitle 한 값)
3. fallback `Session ${id.slice(0, 8)}`

`SessionTitleArea` 컴포넌트가 alias 가 적용됐을 때 `.aliased` 클래스 (굵게) 로 시각적으로 구분.

## 코드 anchor

| 책임 | 파일 |
|---|---|
| 저장소 + sync 로직 | `src/main/sessionAliases.ts` |
| IPC 핸들러 등록 | `src/main/index.ts` (`registerSessionAliasHandlers`) |
| preload 노출 | `src/preload/index.ts` (`api.sessionAliases.{list,set,sync}`) |
| 상태 + sync 트리거 | `src/renderer/src/App.tsx` (`handleSelect`, `handleSetSessionAlias`) |
| 인라인 편집 UI | `src/renderer/src/components/SessionTitleArea.tsx` |
| 사이드바 표시 | `src/renderer/src/components/{SessionRow,WorkspaceCard}.tsx` |

## 한계 / 향후

- **풀 스캔 비용**: 매 readonly 선택마다 jsonl 전체를 한 번 읽는다. 큰 jsonl (수 MB) 에서 노이즈가 될 수 있음. 첫 매칭 후 끝까지 가는 이유는 다중 `/rename` 의 마지막 값을 잡기 위함. mtime + size 를 키로 캐싱하면 회피 가능.
- **live 모드 자동 import 미지원**: 현재 sync 는 readonly 진입 시점에만. live 세션에서 사용자가 (터미널 모드 claude 의 TUI 등으로) `/rename` 하면 jsonl 에는 들어가지만 hongtail 별칭은 자동 갱신되지 않음. JSONL watcher 의 incremental read 에서 rename 이벤트를 잡아 sync 하는 식으로 확장 가능.
- **삭제 동기화 없음**: 세션 jsonl 자체를 지워도 alias 엔트리는 남는다. 큰 문제는 아니지만 (다음 sync 호출 시 그 세션이 안 열릴 뿐) deleteSession 흐름에 정리 호출을 끼울 만함.
