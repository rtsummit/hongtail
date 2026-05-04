# 로고

hongtail 로고는 시안 10종 중 **6번 (한글 ㅎ → 꼬리)** 을 채택. amber tone
(`#d6a85b` / 워크스페이스 마커 색 `#c89947`) 단일 색.

## 자산 위치

| 파일 | 용도 |
|---|---|
| `build/icon.svg` | **master SVG (viewBox 120, 투명 배경).** 모든 빌드 아이콘은 이 한 파일에서 파생. |
| `build/icon.png` | 1024×1024 PNG. electron-builder Linux/macOS base. |
| `build/icon.ico` | 16/24/32/48/64/128/256 multi-resolution Windows .ico. |
| `resources/icon.png` | 256×256. main process 의 BrowserWindow 윈도우 아이콘. |
| `src/renderer/src/assets/logo.svg` | UI 용 transparent SVG (viewBox 120, 배경 없음). Sidebar brand 영역 등에서 import. |
| `logo-drafts/` | 시안 10종 + 비교 페이지 (보존용, 빌드와 무관). |

## 갱신 절차

로고 자체를 바꿀 때는 **`build/icon.svg` master 만 수정** 하고:

```bash
npm run build:icons
```

→ `build/icon.png`, `build/icon.ico`, `resources/icon.png` 가 일괄 재생성된다.
스크립트는 `sharp` (SVG → PNG 다중 사이즈) + `png-to-ico` (PNG → ICO) 를
사용 (`scripts/build-icons.mjs`).

UI 용은 `src/renderer/src/assets/logo.svg` 를 별도로 갱신. (master 와 자동
sync 안 함 — 현재는 글리프가 동일하지만 둘 다 손으로 맞춰야 함.)

## 적용 위치

- **Sidebar 상단 brand** — `Sidebar.tsx` 가 `assets/logo.svg` 를 `<img>` 로
  로드. icon-only (최소화) 모드에서는 wordmark 가 숨겨지고 28×28 아이콘만
  남는다 (`.sidebar-brand`, `.sidebar-brand-name` in `main.css`).
- **앱 아이콘** — electron-builder 가 `build/` 의 자산을 자동 사용
  (`directories.buildResources: build` in `electron-builder.yml`).
- **윈도우 아이콘** — main process 의 `BrowserWindow` 가 `resources/icon.png`
  을 사용 (변경 없으면 자동).

## 시안 보관

`logo-drafts/index.html` — 다크/라이트 두 배경에 시안 10종을 비교하는 미리
보기 페이지. `logo-drafts/svg/01-comet … 10-wordmark` 에 각 시안 dark variant
SVG. 빌드와는 무관 (`!**/.vscode/*` 등과 같은 위치는 아니지만 electron-builder
의 files 패턴이 별도 root 임을 명시 안 했으므로 빌드 시 패키지에 포함될 수
있다 — 필요 시 `electron-builder.yml` 의 `files` 에 `!logo-drafts/**` 추가).
