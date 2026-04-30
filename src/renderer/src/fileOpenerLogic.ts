// Read/Edit/Write 카드의 Ctrl+클릭 → 파일 열기 fallback 로직.
// Electron 은 openExternal 성공 (OS default app), web 은 reject 후 read 텍스트
// 받아 hongtail 모달에 표시. 컴포넌트 (useFileOpener) 의 결정 흐름만 따로
// 빼서 unit test 가능하게.

export type OpenOrLoadResult =
  | { kind: 'empty' }
  | { kind: 'opened' }
  | { kind: 'loaded'; text: string }
  | { kind: 'failed'; error: unknown }

export interface FileApiLike {
  openExternal: (path: string) => Promise<void>
  read: (path: string) => Promise<string>
}

export async function openOrLoadFile(
  path: string,
  api: FileApiLike
): Promise<OpenOrLoadResult> {
  if (!path) return { kind: 'empty' }
  try {
    await api.openExternal(path)
    return { kind: 'opened' }
  } catch {
    try {
      const text = await api.read(path)
      return { kind: 'loaded', text }
    } catch (err) {
      return { kind: 'failed', error: err }
    }
  }
}
