# Find / Ctrl+F

Last Updated: 2026-04-26

Ctrl+F 로 띄우는 단일 FindBar 가 두 백엔드를 분기:

- **앱 모드** (ChatPane DOM 텍스트) → CSS Custom Highlight API
- **터미널 모드** (xterm.js canvas) → `@xterm/addon-search` 의 SearchAddon

코드는 `src/renderer/src/components/FindBar.tsx` 한 파일.

## 트리거

App.tsx 의 `window` 단계 `keydown` 캡처 핸들러:

```ts
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault()
      e.stopPropagation()
      setFindOpen(true)
    }
  }
  window.addEventListener('keydown', onKey, true)
  return () => window.removeEventListener('keydown', onKey, true)
}, [])
```

`mode` 는 selected 의 backend / mode 로 결정:

```ts
const findMode = selected?.backend === 'terminal' && selected.mode !== 'readonly' ? 'terminal' : 'app'
```

terminal readonly 는 jsonl 을 ChatPane 으로 렌더하므로 app 모드로 처리됨.

## 앱 모드 — CSS Custom Highlight API

### 왜 이걸 쓰는가

이 기능 구현 과정에서 **세 번** 갈아엎었음:

1. **시도 1: `webContents.findInPage` (Electron native find)**
   - 장점: 매치 카운트 자동 제공, Chrome 의 노란 하이라이트
   - 깨진 점: `.chat-messages` 가 `overflow-y: auto` 인 nested scroll container 인데, Chrome 의 find 가 **scroll container 안의 매치를 보이는 위치로 스크롤시키지 못함**. 매치가 viewport 밖에 있으면 사용자가 직접 찾아야 함.
   - 추가 문제: IPC 왕복 + 매 키스트로크마다 호출로 입력이 느려짐.

2. **시도 2: 직접 `<mark>` 로 DOM wrap**
   - 텍스트 노드를 TreeWalker 로 순회해서 매치를 `<mark.find-highlight>` 로 감싸고 `scrollIntoView` 호출.
   - 장점: 정확한 스크롤, IPC 제거.
   - **치명적 문제**: React 가 MessageList 를 re-render (assistant 응답 streaming, 새 메시지 등) 하면 React 의 reconciliation 이 우리가 만든 `<mark>` 노드들을 덮어씀 → 하이라이트가 사라지고, 텍스트 split 이 깨짐. 라이브 채팅 환경에서 사용 불가.

3. **현재: CSS Custom Highlight API** (Chrome 105+, Electron 39 = Chromium 130+)
   - **DOM 을 건드리지 않음**. Range 객체로 매치 위치를 가리키고 `CSS.highlights.set(name, highlight)` 로 등록. CSS `::highlight(name)` 의사 요소가 색칠만 함.
   - React reconciliation 과 충돌 없음.
   - Range 가 가리키는 텍스트 노드가 React 에 의해 detach 되면 그 Range 는 stale → MutationObserver 로 감지해 재계산.

### 동작 흐름

```
사용자 input 변경
  ↓ 200ms debounce
recompute()
  - getChatScroller() = document.querySelector('.chat-messages')
  - findRanges(scope, query) = TreeWalker 로 텍스트 노드 순회 → 매치마다 Range 생성
  - CSS.highlights.set('find-match', new Highlight(...ranges))
  - setMatchCount(ranges.length), setActive(0)
  ↓
active 변경 / matchCount 변경
  - CSS.highlights.set('find-match-active', new Highlight(ranges[active]))
  - ranges[active].startContainer.parentElement.scrollIntoView({block:'center'})

DOM 변경 (assistant 응답 streaming, 메시지 추가, 등)
  ↓ MutationObserver(scope, {childList, subtree, characterData})
  ↓ 150ms debounce (재계산이 너무 자주 일어나는 것 방지)
recompute() 다시
```

### CSS

```css
::highlight(find-match) {
  background-color: rgba(250, 204, 21, 0.4);
}

::highlight(find-match-active) {
  background-color: rgba(250, 204, 21, 0.9);
  color: #1e1e1e;
}
```

`::highlight(<name>)` 은 등록된 highlight 의 **각 Range 가 차지하는 텍스트 영역에만** 적용되는 의사 요소. Range 안 텍스트의 글자색 / 배경색만 바꿀 수 있고 padding / border-radius 같은 box-model 속성은 적용 안 됨 (분리된 의사 요소가 아니라 텍스트 위에 입혀지는 paint layer 라).

### 매치 카운트 / 네비게이션

- `matchCount` = ranges 길이.
- `active` 는 0..matchCount-1.
- ↑/↓ 또는 Shift+Enter / Enter 로 navigate(±1). modulo 로 wrap.
- 카운터 표시: `${active+1}/${matchCount}` 또는 "없음".

### 정리

- `open` 이 false 가 되거나 컴포넌트 언마운트 시 `CSS.highlights.delete('find-match')` + `delete('find-match-active')`.
- query 가 비어있으면 highlight 삭제 + matchCount=0.

## 터미널 모드 — xterm SearchAddon

xterm.js 는 canvas 에 텍스트를 그리므로 DOM 텍스트가 없음. `webContents.findInPage` 도 안 먹고 Custom Highlight API 도 안 됨. 대신 `@xterm/addon-search` 가 xterm 의 internal buffer 를 검색하고 자체 decoration 으로 하이라이트.

### 노출 방법

`TerminalSession` 이 `forwardRef` 로 imperative handle 노출:

```ts
export interface TerminalSearchHandle {
  findNext: (query: string) => boolean
  findPrevious: (query: string) => boolean
  clear: () => void
}
```

`SearchAddon.findNext / findPrevious` 는 boolean 만 반환 — **매치 총 개수는 노출 안 함**. 그래서 터미널 모드의 카운터는 "찾음 / 없음" 만 표시.

### App.tsx 에서 ref 관리

여러 터미널 세션이 있을 수 있어 `terminalRefs: Map<sessionId, TerminalSearchHandle>` 로 모음:

```ts
<TerminalSession
  ref={(handle) => {
    if (handle) terminalRefs.current.set(t.sessionId, handle)
    else terminalRefs.current.delete(t.sessionId)
    if (selected?.sessionId === t.sessionId) {
      activeTerminalRef.current = handle ?? null
    }
  }}
  ...
/>
```

`selected` 변경 시 render body 안에서 `activeTerminalRef` 를 현재 선택된 터미널로 갱신:

```ts
if (selected?.backend === 'terminal') {
  activeTerminalRef.current = terminalRefs.current.get(selected.sessionId) ?? null
} else {
  activeTerminalRef.current = null
}
```

FindBar 에는 `terminalRef={activeTerminalRef}` 로 전달.

## FindBar 컴포넌트 구조

| 상태 | 의미 |
|---|---|
| `query` | input box 의 텍스트 |
| `active` | 현재 활성 매치 인덱스 (-1 = 없음) |
| `matchCount` | 총 매치 수 (앱: 정확, 터미널: 0 또는 1) |
| `rangesRef.current` | 앱 모드용 Range 배열 |
| `debounceRef.current` | 입력 debounce 타이머 |

| Effect | 트리거 | 동작 |
|---|---|---|
| 포커스 | open 변경 | input 에 focus + select |
| 닫기 정리 | open=false | clearAll() + 상태 리셋 |
| 언마운트 정리 | unmount | clearAll() + timer 클리어 |
| 앱 모드 검색 | query, open, mode | 200ms debounce 후 recompute |
| MutationObserver | open && app && query | scope 변경 → 150ms debounce 후 recompute |
| 터미널 검색 | query, open, mode | 200ms debounce 후 SearchAddon.findNext |
| 활성 highlight | active, matchCount, mode | find-match-active 등록 + scrollIntoView |

## 한계 / 향후

- **터미널 매치 카운트 미지원**: SearchAddon 이 안 줘서 "찾음/없음" 만. 직접 buffer 순회해서 세는 방식 가능하지만 큰 scrollback 에서 비용.
- **case sensitive / regex 옵션**: 현재 `toLowerCase()` 로 case-insensitive only. 토글 추가 가능.
- **whole word**: 미지원.
- **Custom Highlight API 미지원 환경**: Electron 39 미만 / 일부 Chromium fork 에서 fallback 없음. 현재 `getHighlights()` 가 null 이면 조용히 무동작 — 사용자 입장에선 "찾기가 동작 안 함". 필요 시 fallback (시도 2 의 `<mark>` 방식 + 단순 onClick refresh) 가능하지만 복잡도 증가.
- **highlight 깜빡임**: streaming 중 MutationObserver 가 150ms 안에 두 번 이상 fire 되면 짧은 깜빡임. 재계산 비용이 작아서 보통 보이지 않지만, 매우 긴 메시지 + 빠른 streaming 조합에서 보일 수 있음.
- **virtualized list**: 만약 미래에 MessageList 를 가상화하면 viewport 밖 매치는 텍스트 노드가 없어서 못 찾음. 그땐 데이터 레벨 검색 + 가상 스크롤러 API 가 필요.

## 코드 anchor

| 책임 | 파일 |
|---|---|
| FindBar UI + 양 모드 분기 + Highlight 관리 | `src/renderer/src/components/FindBar.tsx` |
| Ctrl+F 글로벌 핸들러 + ref 관리 + mode 결정 | `src/renderer/src/App.tsx` (`useEffect` on `keydown`, `terminalRefs`, `findMode`) |
| 터미널 SearchAddon 노출 | `src/renderer/src/components/TerminalSession.tsx` (`forwardRef`, `useImperativeHandle`) |
| 하이라이트 색상 | `src/renderer/src/assets/main.css` (`::highlight(find-match)`, `::highlight(find-match-active)`) |
| FindBar 위치 / 버튼 스타일 | 같은 main.css 의 `.find-bar` / `.find-input` / `.find-btn` |
