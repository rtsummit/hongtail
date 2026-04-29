#!/usr/bin/env node
// Phase 0 Probe B — PermissionRequest hook stub.
// stdin 에서 hook event JSON 받아 tmpdir 의 hongtail-hook-event.log 에 append,
// 항상 { behavior: "allow" } 반환. probe 전용, 끝나면 삭제.
const fs = require('fs')
const os = require('os')
const path = require('path')

const chunks = []
process.stdin.on('data', (c) => chunks.push(c))
process.stdin.on('end', () => {
  const raw = Buffer.concat(chunks).toString('utf8')
  let event
  try {
    event = JSON.parse(raw)
  } catch {
    event = { _parseError: true, raw }
  }
  const logFile = path.join(os.tmpdir(), 'hongtail-hook-event.log')
  fs.appendFileSync(
    logFile,
    `[${new Date().toISOString()}] ${JSON.stringify(event)}\n`
  )
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'allow' }
      }
    })
  )
  process.exit(0)
})
