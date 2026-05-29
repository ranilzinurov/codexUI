import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const DEFAULT_LOG_PATH = resolve(process.cwd(), 'output', 'thread-errors.jsonl')
const MAX_TEXT_LENGTH = 1200

let warnedAboutWriteFailure = false

function truncateText(value: string): string {
  return value.length > MAX_TEXT_LENGTH ? `${value.slice(0, MAX_TEXT_LENGTH)}...` : value
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  try {
    return JSON.stringify(value ?? '')
  } catch {
    return String(value ?? '')
  }
}

export function getThreadErrorDiagnosticsLogPath(): string {
  const configured = process.env.CODEXUI_THREAD_ERROR_LOG?.trim()
  return configured || DEFAULT_LOG_PATH
}

export function isTurnStartThreadNotFoundLike(value: unknown): boolean {
  const message = stringifyUnknown(value)
  return /thread not found/i.test(message)
}

export function summarizeTurnStartThreadNotFound(value: unknown): Record<string, unknown> {
  const message = stringifyUnknown(value)
  const threadId = message.match(/thread not found:\s*([A-Za-z0-9_-]+)/iu)?.[1] ?? null
  const httpStatus = message.match(/HTTP\s+(\d+)/iu)?.[1] ?? null
  return {
    message: truncateText(message),
    threadId,
    httpStatus: httpStatus ? Number.parseInt(httpStatus, 10) : null,
  }
}

export function writeThreadErrorDiagnostic(event: Record<string, unknown>): void {
  const logPath = getThreadErrorDiagnosticsLogPath()
  const row = {
    atIso: new Date().toISOString(),
    ...event,
  }

  void (async () => {
    try {
      await mkdir(dirname(logPath), { recursive: true })
      await appendFile(logPath, `${JSON.stringify(row)}\n`, 'utf8')
    } catch (error) {
      if (warnedAboutWriteFailure) return
      warnedAboutWriteFailure = true
      const message = error instanceof Error ? error.message : String(error)
      console.warn('[thread-error-diagnostics] failed to write log:', message)
    }
  })()
}
