// userData 디렉토리의 작은 JSON 설정 파일 (workspaces.json, web-settings.json,
// session-aliases.json 등) 의 read/write 보일러플레이트. 캐싱·정규화는 호출자
// 책임이고 여기는 파일 I/O + JSON.parse/stringify + ENOENT 디폴트만 담당.
import { promises as fs } from 'fs'

// 파일을 읽어 JSON 으로 파싱. 빈 파일·ENOENT 는 fallback 반환. 그 외 에러
// (parse 실패 등) 은 throw — webSettings 처럼 모든 에러를 디폴트로 흡수하고
// 싶으면 fallthrough=true 로.
export async function readJsonFile<T>(
  path: string,
  fallback: T,
  options: { fallthrough?: boolean } = {}
): Promise<unknown | T> {
  try {
    const raw = await fs.readFile(path, 'utf-8')
    if (!raw.trim()) return fallback
    return JSON.parse(raw)
  } catch (err) {
    if (options.fallthrough || (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback
    }
    throw err
  }
}

// pretty-print + utf-8 일관 적용.
export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await fs.writeFile(path, JSON.stringify(value, null, 2), 'utf-8')
}
