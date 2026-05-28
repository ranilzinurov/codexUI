import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const DEFAULT_LOG_PATH = resolve(process.cwd(), 'output', 'previous-response-errors.jsonl')
const MAX_TEXT_LENGTH = 1200

let warnedAboutWriteFailure = false

function truncateText(value: string, maxLength = MAX_TEXT_LENGTH): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function getPreviousResponseDiagnosticsLogPath(): string {
  const configured = process.env.CODEXUI_PREVIOUS_RESPONSE_ERROR_LOG?.trim()
  return configured || DEFAULT_LOG_PATH
}

export function redactDiagnosticUrl(value: string): string {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return value
  }
}

export function isPreviousResponseNotFoundLike(value: unknown): boolean {
  const text = typeof value === 'string' ? value : safeJson(value)
  return (
    /previous_response_not_found/i.test(text)
    || (/previous[_\s-]+response/i.test(text) && /not[_\s-]+found/i.test(text))
    || (/previous_response_id/i.test(text) && /not[_\s-]+found/i.test(text))
  )
}

export function summarizePreviousResponseError(value: unknown): Record<string, unknown> {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
  const error = record?.error && typeof record.error === 'object' && !Array.isArray(record.error)
    ? record.error as Record<string, unknown>
    : record

  if (!error) {
    return { message: truncateText(typeof value === 'string' ? value : safeJson(value)) }
  }

  return {
    type: typeof error.type === 'string' ? error.type : null,
    code: typeof error.code === 'string' ? error.code : null,
    param: typeof error.param === 'string' ? error.param : null,
    message: truncateText(typeof error.message === 'string' ? error.message : safeJson(error)),
  }
}

export function writePreviousResponseDiagnostic(event: Record<string, unknown>): void {
  const logPath = getPreviousResponseDiagnosticsLogPath()
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
      console.warn('[previous-response-diagnostics] failed to write log:', message)
    }
  })()
}
