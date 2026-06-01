const MAX_PREVIOUS_RESPONSE_ERROR_DEPTH = 8

export type PreviousResponseNotFoundMatch = {
  responseId: string
  signature: string
  message: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
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

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function isPreviousResponseText(value: string): boolean {
  return (
    /previous_response_not_found/i.test(value)
    || (/previous[_\s-]+response/i.test(value) && /not[_\s-]+found/i.test(value))
    || (/previous_response_id/i.test(value) && /not[_\s-]+found/i.test(value))
  )
}

function extractPreviousResponseId(message: string): string {
  const quoted = message.match(/Previous response with id ['"]([^'"]+)['"] not found/i)?.[1]
  if (quoted) return quoted
  return message.match(/\b(resp_[A-Za-z0-9_-]+)\b/u)?.[1] ?? ''
}

function stableSignature(message: string): string {
  return message.replace(/\s+/gu, ' ').trim().slice(0, 240)
}

function toMatch(message: string): PreviousResponseNotFoundMatch {
  const responseId = extractPreviousResponseId(message)
  return {
    responseId,
    signature: responseId ? `response:${responseId}` : `signature:${stableSignature(message)}`,
    message,
  }
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

export function classifyPreviousResponseNotFound(
  value: unknown,
  depth = 0,
): PreviousResponseNotFoundMatch | null {
  if (depth > MAX_PREVIOUS_RESPONSE_ERROR_DEPTH) return null

  if (typeof value === 'string') {
    const parsed = parseJsonRecord(value)
    if (parsed) {
      const nested = classifyPreviousResponseNotFound(parsed, depth + 1)
      if (nested) return nested
    }
    return isPreviousResponseText(value) ? toMatch(value) : null
  }

  const record = asRecord(value)
  if (!record) return null

  const error = asRecord(record.error)
  const errorMessage = readString(error?.message)
  if (errorMessage) {
    const nested = classifyPreviousResponseNotFound(errorMessage, depth + 1)
    if (nested) return nested
  }

  if (error && recordLooksLikePreviousResponseError(error)) {
    return toMatch(readString(error.message) || JSON.stringify(error))
  }

  const message = readString(record.message)
  if (message) {
    const nested = classifyPreviousResponseNotFound(message, depth + 1)
    if (nested) return nested
  }

  if (recordLooksLikePreviousResponseError(record)) {
    return toMatch(readString(record.message) || JSON.stringify(record))
  }

  for (const key of ['params', 'turn', 'cause', 'additionalDetails', 'additional_details']) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue
    const nested = classifyPreviousResponseNotFound(record[key], depth + 1)
    if (nested) return nested
  }

  return null
}

export function isPreviousResponseNotFoundLike(value: unknown): boolean {
  return Boolean(classifyPreviousResponseNotFound(value))
}
