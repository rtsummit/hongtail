import { app } from 'electron'
import log from 'electron-log/main'
import { mkdirSync } from 'fs'
import { dirname, join } from 'path'

export function setupLogging(): void {
  const baseDir = app.isPackaged ? dirname(app.getPath('exe')) : process.cwd()
  const logsDir = join(baseDir, 'logs')
  try {
    mkdirSync(logsDir, { recursive: true })
  } catch {
    // ignore
  }

  log.transports.file.resolvePathFn = (variables) =>
    join(logsDir, variables.fileName ?? 'main.log')
  log.transports.file.maxSize = 5 * 1024 * 1024 // 5MB → rotate to .old
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'
  log.transports.console.format = '[{h}:{i}:{s}.{ms}] [{level}] {text}'

  // Initialize IPC channel so renderer's `electron-log/renderer` calls land here.
  log.initialize()

  // Hook main-process console.* so existing console.log / .error in main also
  // hit the file transport.
  Object.assign(console, log.functions)

  // Capture unhandled errors and lifecycle events.
  log.errorHandler.startCatching()
  log.eventLogger.startLogging()

  log.info('--- hongtail starting (logs at:', logsDir, ') ---')
}
