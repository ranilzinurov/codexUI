import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const DEFAULT_LOG_PATH = resolve(process.cwd(), 'output', 'previous-response-errors.jsonl')
const MAX_TEXT_LENGTH = 1200
const MAX_MATCH_DEPTH = 8

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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  const trimmed = value.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null
  try {
    return asRecord(JSON.parse(trimmed) as unknown)
  } catch {
    return null
  }
}

function isPreviousResponseText(value: string): boolean {
  return (
    /previous_response_not_found/i.test(value)
    || (/previous[_\s-]+response/i.test(value) && /not[_\s-]+found/i.test(value))
    || (/previous_response_id/i.test(value) && /not[_\s-]+found/i.test(value))
  )
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function extractPreviousResponseId(message: string): string | null {
  const quoted = message.match(/Previous response with id ['"]([^'"]+)['"] not found/i)?.[1]
  if (quoted) return quoted
  return message.match(/\b(resp_[A-Za-z0-9_-]+)\b/u)?.[1] ?? null
}

function recordLooksLikePreviousResponseError(record: Record<string, unknown>): boolean {
  const type = readString(record.type)
  const code = readString(record.code)
  const param = readString(record.param)
  const message = readString(record.message)
  return (
    code === 'previous_response_not_found'
    || type === 'previous_response_not_found'
    || (param === 'previous_response_id' && isPreviousResponseText(message))
    || isPreviousResponseText(message)
  )
}

type PreviousResponseErrorMatch = {
  container: Record<string, unknown> | null
  error: Record<string, unknown> | null
  text: string
}

function findPreviousResponseErrorMatch(value: unknown, depth = 0): PreviousResponseErrorMatch | null {
  if (depth > MAX_MATCH_DEPTH) return null

  if (typeof value === 'string') {
    const parsed = parseJsonRecord(value)
    if (parsed) {
      const nested = findPreviousResponseErrorMatch(parsed, depth + 1)
      if (nested) return nested
    }
    return isPreviousResponseText(value)
      ? { container: null, error: null, text: value }
      : null
  }

  const record = asRecord(value)
  if (!record) return null

  const error = asRecord(record.error)
  const errorMessage = readString(error?.message)
  if (errorMessage) {
    const parsed = parseJsonRecord(errorMessage)
    if (parsed) {
      const nested = findPreviousResponseErrorMatch(parsed, depth + 1)
      if (nested) return nested
    }
  }

  if (error && recordLooksLikePreviousResponseError(error)) {
    return { container: record, error, text: readString(error.message) || safeJson(error) }
  }

  const message = readString(record.message)
  if (message) {
    const parsed = parseJsonRecord(message)
    if (parsed) {
      const nested = findPreviousResponseErrorMatch(parsed, depth + 1)
      if (nested) return nested
    }
  }

  if (recordLooksLikePreviousResponseError(record)) {
    return { container: record, error: record, text: readString(record.message) || safeJson(record) }
  }

  const prioritizedKeys = ['error', 'params', 'turn', 'message', 'cause', 'additionalDetails', 'additional_details']
  for (const key of prioritizedKeys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue
    const nested = findPreviousResponseErrorMatch(record[key], depth + 1)
    if (nested) return nested
  }

  return null
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
  return Boolean(findPreviousResponseErrorMatch(value))
}

export function summarizePreviousResponseError(value: unknown): Record<string, unknown> {
  const match = findPreviousResponseErrorMatch(value)
  if (!match) {
    return { message: truncateText(typeof value === 'string' ? value : safeJson(value)) }
  }

  const error = match.error
  const container = match.container
  const message = error ? readString(error.message) || match.text : match.text

  return {
    type: error ? readString(error.type) || null : null,
    code: error ? readString(error.code) || null : null,
    param: error ? readString(error.param) || null : null,
    status: readNumber(container?.status) ?? readNumber(error?.status),
    responseId: extractPreviousResponseId(message),
    message: truncateText(message),
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
