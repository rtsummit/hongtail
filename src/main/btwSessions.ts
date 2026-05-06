// BTW 자식이 만든 jsonl 파일을 sidebar 에서 숨기기 위한 marker 저장소.
// claude CLI 의 `--no-session-persistence` 는 resume 만 차단하고 jsonl 자체는
// 그대로 작성되므로, hongtail 이 spawn 한 BTW session id 를 따로 기록해 두고
// listSessions 가 필터링한다. 삭제 대신 필터를 쓰는 이유는 사후 디버깅·추적
// 용도로 jsonl 자체는 디스크에 남겨도 괜찮기 때문 (`docs/btw-side-chat.md`
// "세션 파일 leak" 참조).
import { app } from 'electron'
import { join } from 'path'
import { readJsonFile, writeJsonFile } from './jsonFile'

let cache: Set<string> | null = null
// 동시 markAsBtw 가 file write 를 인터리브하지 않도록 단일 chain 으로 직렬화.
let writeChain: Promise<void> = Promise.resolve()

function file(): string {
  return join(app.getPath('userData'), 'btw-sessions.json')
}

async function load(): Promise<Set<string>> {
  if (cache) return cache
  const parsed = await readJsonFile<string[]>(file(), [])
  const out = new Set<string>()
  if (Array.isArray(parsed)) {
    for (const id of parsed) {
      if (typeof id === 'string' && id) out.add(id)
    }
  }
  cache = out
  return cache
}

export async function getBtwSessionSet(): Promise<Set<string>> {
  return load()
}

export async function markAsBtw(sessionId: string): Promise<void> {
  const set = await load()
  if (set.has(sessionId)) return
  set.add(sessionId)
  writeChain = writeChain.then(() => writeJsonFile(file(), Array.from(set)))
  await writeChain
}
