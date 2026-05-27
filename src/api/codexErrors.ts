function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export type CodexErrorCode =
  | 'http_error'
  | 'rpc_error'
  | 'network_error'
  | 'invalid_response'
  | 'unknown_error'

const DEFAULT_SANITIZED_ERROR_MESSAGE = 'Codex API request failed.'
const HTML_ERROR_MESSAGE = 'received an HTML error page instead of JSON.'
const SECURITY_CHALLENGE_ERROR_MESSAGE = 'received an upstream security challenge instead of JSON.'

function looksLikeHtmlDocument(value: string): boolean {
  const normalized = value.slice(0, 2000).toLowerCase()
  return (
    /<!doctype\s+html[\s>]/iu.test(normalized) ||
    /<html[\s>]/iu.test(normalized) ||
    /<body[\s>]/iu.test(normalized) ||
    /<head[\s>]/iu.test(normalized) ||
    /<title[\s>]/iu.test(normalized)
  )
}

function looksLikeSecurityChallenge(value: string): boolean {
  const normalized = value.slice(0, 4000).toLowerCase()
  return (
    normalized.includes('cloudflare') ||
    normalized.includes('cf-chl') ||
    normalized.includes('cf-ray') ||
    normalized.includes('cloudflare ray id') ||
    normalized.includes('attention required') ||
    normalized.includes('checking your browser') ||
    normalized.includes('challenge-platform') ||
    normalized.includes('turnstile')
  )
}

function prefixBeforeUnsafeBody(value: string): string {
  const match = /(?:<!doctype\s+html|<html[\s>]|<body[\s>]|<head[\s>]|<title[\s>])/iu.exec(value)
  if (!match || match.index <= 0) return ''
  return value.slice(0, match.index).trim().replace(/[:\s]+$/u, '')
}

export function sanitizeCodexErrorMessage(message: string, fallback = DEFAULT_SANITIZED_ERROR_MESSAGE): string {
  const trimmed = message.trim()
  const sanitizedFallback = fallback.trim()
  if (!trimmed) return sanitizedFallback

  const securityChallenge = looksLikeSecurityChallenge(trimmed)
  const htmlDocument = looksLikeHtmlDocument(trimmed)
  if (!securityChallenge && !htmlDocument) return trimmed

  const prefix = prefixBeforeUnsafeBody(trimmed)
  const replacement = securityChallenge ? SECURITY_CHALLENGE_ERROR_MESSAGE : HTML_ERROR_MESSAGE
  return prefix ? `${prefix}: ${replacement}` : replacement
}

export class CodexApiError extends Error {
  code: CodexErrorCode
  method?: string
  status?: number

  constructor(message: string, options: { code: CodexErrorCode; method?: string; status?: number }) {
    super(sanitizeCodexErrorMessage(message))
    this.name = 'CodexApiError'
    this.code = options.code
    this.method = options.method
    this.status = options.status
  }
}

export function extractErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'string' && payload.length > 0) return sanitizeCodexErrorMessage(payload, fallback)

  const record = asRecord(payload)
  if (!record) return sanitizeCodexErrorMessage(fallback, '')

  const error = record.error
  if (typeof error === 'string' && error.length > 0) {
    return sanitizeCodexErrorMessage(error, fallback)
  }

  const nested = asRecord(error)
  if (nested && typeof nested.message === 'string' && nested.message.length > 0) {
    return sanitizeCodexErrorMessage(nested.message, fallback)
  }

  if (typeof record.message === 'string' && record.message.length > 0) {
    return sanitizeCodexErrorMessage(record.message, fallback)
  }
  if (typeof record.detail === 'string' && record.detail.length > 0) return sanitizeCodexErrorMessage(record.detail, fallback)

  return sanitizeCodexErrorMessage(fallback, '')
}

export function normalizeCodexApiError(error: unknown, fallback: string, method?: string): CodexApiError {
  if (error instanceof CodexApiError) {
    return error
  }

  if (error instanceof Error) {
    return new CodexApiError(error.message || fallback, {
      code: 'unknown_error',
      method,
    })
  }

  return new CodexApiError(fallback, {
    code: 'unknown_error',
    method,
  })
}
