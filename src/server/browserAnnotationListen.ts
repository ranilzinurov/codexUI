import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

export const BROWSER_ANNOTATION_LISTEN_BASE_PATH = '/codex-api/extension/listen'
export const BROWSER_ANNOTATION_LISTEN_TTL_MS = 10 * 60 * 1000
export const BROWSER_ANNOTATION_EXTENSION_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000
export const BROWSER_ANNOTATION_LISTEN_MAX_ACTIVE_SESSIONS = 100
const BROWSER_ANNOTATION_LISTEN_JSON_BODY_LIMIT_BYTES = 16 * 1024

export type BrowserAnnotationListenStatus = 'active' | 'expired' | 'revoked'
export type BrowserAnnotationListenTokenType = 'pairing' | 'extension'

export type BrowserAnnotationListenSessionResponse = {
  sessionId: string
  threadId: string
  serverUrl: string | null
  serverPath: string
  expiresAtIso: string
  createdAtIso: string
  status: BrowserAnnotationListenStatus
  tokenType?: BrowserAnnotationListenTokenType
  lastUsedAtIso?: string
  lastReceivedBatch?: BrowserAnnotationListenLastReceivedBatch
  pairingToken?: string
  extensionToken?: string
}

export type BrowserAnnotationListenLastReceivedBatch = {
  batchId: string
  queuedMessageId: string
  receivedAtIso: string
  annotationCount: number
  imageCount: number
  consoleCount: number
  networkCount: number
}

type BrowserAnnotationListenSessionRecord = {
  sessionId: string
  threadId: string
  serverUrl: string | null
  serverPath: string
  pairingCredential: BrowserAnnotationListenCredentialRecord
  extensionCredential: BrowserAnnotationListenCredentialRecord | null
  lastReceivedBatch: BrowserAnnotationListenLastReceivedBatch | null
}

type BrowserAnnotationListenCredentialRecord = {
  type: BrowserAnnotationListenTokenType
  tokenHash: string
  createdAtMs: number
  lastUsedAtMs: number | null
  expiresAtMs: number
  revokedAtMs: number | null
}

type BrowserAnnotationListenStoreOptions = {
  ttlMs?: number
  extensionTokenTtlMs?: number
  nowMs?: () => number
  tokenBytes?: number
  maxActiveSessions?: number
}

type StartSessionInput = {
  threadId: string
  serverUrl: string | null
  serverPath: string
}

export class BrowserAnnotationListenStore {
  private readonly sessions = new Map<string, BrowserAnnotationListenSessionRecord>()
  private readonly ttlMs: number
  private readonly extensionTokenTtlMs: number
  private readonly nowMs: () => number
  private readonly tokenBytes: number
  private readonly maxActiveSessions: number

  constructor(options: BrowserAnnotationListenStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? BROWSER_ANNOTATION_LISTEN_TTL_MS
    this.extensionTokenTtlMs = options.extensionTokenTtlMs ?? BROWSER_ANNOTATION_EXTENSION_TOKEN_TTL_MS
    this.nowMs = options.nowMs ?? Date.now
    this.tokenBytes = options.tokenBytes ?? 24
    this.maxActiveSessions = options.maxActiveSessions ?? BROWSER_ANNOTATION_LISTEN_MAX_ACTIVE_SESSIONS
  }

  start(input: StartSessionInput): BrowserAnnotationListenSessionResponse {
    this.pruneExpired()
    this.revokeActiveSessionsForThread(input.threadId)
    this.pruneOldestSessionsOverLimit(this.maxActiveSessions - 1)
    const now = this.nowMs()
    const pairingToken = randomBytes(this.tokenBytes).toString('base64url')
    const session: BrowserAnnotationListenSessionRecord = {
      sessionId: randomBytes(16).toString('hex'),
      threadId: input.threadId,
      serverUrl: input.serverUrl,
      serverPath: input.serverPath,
      pairingCredential: {
        type: 'pairing',
        tokenHash: hashPairingToken(pairingToken),
        createdAtMs: now,
        lastUsedAtMs: null,
        expiresAtMs: now + this.ttlMs,
        revokedAtMs: null,
      },
      extensionCredential: null,
      lastReceivedBatch: null,
    }
    this.sessions.set(session.sessionId, session)
    return {
      ...this.toResponse(session, session.pairingCredential),
      pairingToken,
    }
  }

  issueExtensionToken(token: string, selector: { sessionId?: string; threadId?: string } = {}): BrowserAnnotationListenSessionResponse | null {
    this.pruneExpired()
    const authorized = this.findAuthorizedCredential(token, selector, { tokenType: 'pairing' })
    if (!authorized) return null
    const now = this.nowMs()
    const extensionToken = randomBytes(this.tokenBytes).toString('base64url')
    const extensionCredential: BrowserAnnotationListenCredentialRecord = {
      type: 'extension',
      tokenHash: hashPairingToken(extensionToken),
      createdAtMs: now,
      lastUsedAtMs: now,
      expiresAtMs: now + this.extensionTokenTtlMs,
      revokedAtMs: null,
    }
    authorized.session.extensionCredential = extensionCredential
    return {
      ...this.toResponse(authorized.session, extensionCredential),
      extensionToken,
    }
  }

  getAuthorizedSession(token: string, selector: { sessionId?: string; threadId?: string } = {}): BrowserAnnotationListenSessionResponse | null {
    this.pruneExpired()
    const authorized = this.findAuthorizedCredential(token, selector)
    return authorized ? this.toResponse(authorized.session, authorized.credential) : null
  }

  getAuthorizedSessionStatus(token: string, selector: { sessionId?: string; threadId?: string } = {}): BrowserAnnotationListenSessionResponse | null {
    this.pruneExpired()
    const authorized = this.findAuthorizedCredential(token, selector, { allowRevoked: true })
    return authorized ? this.toResponse(authorized.session, authorized.credential) : null
  }

  stopAuthorizedSession(token: string, selector: { sessionId?: string; threadId?: string } = {}): BrowserAnnotationListenSessionResponse | null {
    this.pruneExpired()
    const authorized = this.findAuthorizedCredential(token, selector)
    if (!authorized) return null
    this.revokeSession(authorized.session)
    return this.toResponse(authorized.session, authorized.credential)
  }

  getSessionStatus(sessionId: string): BrowserAnnotationListenStatus | null {
    const session = this.sessions.get(sessionId)
    if (!session) return null
    if (this.getActiveCredential(session)) return 'active'
    return this.getCredentialStatus(session.pairingCredential)
  }

  recordReceivedBatch(sessionId: string, batch: BrowserAnnotationListenLastReceivedBatch): BrowserAnnotationListenSessionResponse | null {
    const session = this.sessions.get(sessionId)
    const activeCredential = this.getActiveCredential(session)
    if (!session || !activeCredential) return null
    session.lastReceivedBatch = { ...batch }
    return this.toResponse(session, activeCredential)
  }

  private findAuthorizedCredential(
    token: string,
    selector: { sessionId?: string; threadId?: string },
    options: { allowRevoked?: boolean; tokenType?: BrowserAnnotationListenTokenType } = {},
  ): { session: BrowserAnnotationListenSessionRecord; credential: BrowserAnnotationListenCredentialRecord } | null {
    const candidates = selector.sessionId
      ? [this.sessions.get(selector.sessionId)].filter((session): session is BrowserAnnotationListenSessionRecord => Boolean(session))
      : Array.from(this.sessions.values())

    for (const session of candidates) {
      if (selector.threadId && session.threadId !== selector.threadId) continue
      for (const credential of this.getCredentials(session)) {
        if (options.tokenType && credential.type !== options.tokenType) continue
        const status = this.getCredentialStatus(credential)
        if (status !== 'active' && !(options.allowRevoked && status === 'revoked')) continue
        if (!doesTokenMatchHash(token, credential.tokenHash)) continue
        if (status === 'active') {
          const now = this.nowMs()
          credential.lastUsedAtMs = now
          if (credential.type === 'extension') {
            credential.expiresAtMs = now + this.extensionTokenTtlMs
          }
        }
        return { session, credential }
      }
    }
    return null
  }

  private pruneExpired(): void {
    const now = this.nowMs()
    for (const [sessionId, session] of this.sessions.entries()) {
      const hasRetainedCredential = this.getCredentials(session).some((credential) => {
        if (credential.revokedAtMs !== null) return true
        return credential.expiresAtMs > now
      })
      if (!hasRetainedCredential) {
        this.sessions.delete(sessionId)
      }
    }
  }

  private revokeActiveSessionsForThread(threadId: string): void {
    for (const session of this.sessions.values()) {
      if (session.threadId === threadId && this.getActiveCredential(session)) {
        this.revokeSession(session)
      }
    }
  }

  private pruneOldestSessionsOverLimit(maxBeforeNewSession: number): void {
    if (this.sessions.size <= maxBeforeNewSession) return
    const sessionsByAge = Array.from(this.sessions.values()).sort(
      (left, right) => left.pairingCredential.createdAtMs - right.pairingCredential.createdAtMs,
    )
    for (const session of sessionsByAge) {
      if (this.sessions.size <= maxBeforeNewSession) return
      this.sessions.delete(session.sessionId)
    }
  }

  private getCredentials(session: BrowserAnnotationListenSessionRecord): BrowserAnnotationListenCredentialRecord[] {
    return [session.pairingCredential, session.extensionCredential].filter(
      (credential): credential is BrowserAnnotationListenCredentialRecord => Boolean(credential),
    )
  }

  private getActiveCredential(session: BrowserAnnotationListenSessionRecord | undefined): BrowserAnnotationListenCredentialRecord | null {
    if (!session) return null
    return this.getCredentials(session).find((credential) => this.getCredentialStatus(credential) === 'active') ?? null
  }

  private revokeSession(session: BrowserAnnotationListenSessionRecord): void {
    const now = this.nowMs()
    for (const credential of this.getCredentials(session)) {
      if (this.getCredentialStatus(credential) === 'active') {
        credential.revokedAtMs = now
      }
    }
  }

  private getCredentialStatus(credential: BrowserAnnotationListenCredentialRecord): BrowserAnnotationListenStatus {
    if (credential.revokedAtMs !== null) return 'revoked'
    return credential.expiresAtMs <= this.nowMs() ? 'expired' : 'active'
  }

  private toResponse(
    session: BrowserAnnotationListenSessionRecord,
    credential: BrowserAnnotationListenCredentialRecord,
  ): BrowserAnnotationListenSessionResponse {
    return {
      sessionId: session.sessionId,
      threadId: session.threadId,
      serverUrl: session.serverUrl,
      serverPath: session.serverPath,
      expiresAtIso: new Date(credential.expiresAtMs).toISOString(),
      createdAtIso: new Date(credential.createdAtMs).toISOString(),
      status: this.getCredentialStatus(credential),
      tokenType: credential.type,
      ...(credential.lastUsedAtMs !== null ? { lastUsedAtIso: new Date(credential.lastUsedAtMs).toISOString() } : {}),
      ...(session.lastReceivedBatch ? { lastReceivedBatch: { ...session.lastReceivedBatch } } : {}),
    }
  }
}

export const sharedBrowserAnnotationListenStore = new BrowserAnnotationListenStore()

export type BrowserAnnotationListenRouteOptions = {
  store?: BrowserAnnotationListenStore
}

export async function handleBrowserAnnotationListenRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  options: BrowserAnnotationListenRouteOptions = {},
): Promise<boolean> {
  if (!url.pathname.startsWith(`${BROWSER_ANNOTATION_LISTEN_BASE_PATH}/`)) return false

  const store = options.store ?? sharedBrowserAnnotationListenStore
  const routePath = url.pathname

  if (req.method === 'POST' && routePath === `${BROWSER_ANNOTATION_LISTEN_BASE_PATH}/start`) {
    const bodyResult = await readJsonBody(req)
    if (!bodyResult.ok) {
      setJson(res, bodyResult.statusCode, { error: bodyResult.error })
      return true
    }
    const body = bodyResult.body
    if (!isRecord(body) || typeof body.threadId !== 'string' || body.threadId.trim().length === 0) {
      setJson(res, 400, { error: 'Missing threadId' })
      return true
    }

    setJson(res, 200, {
      ok: true,
      session: store.start({
        threadId: body.threadId.trim(),
        serverUrl: deriveServerUrl(req),
        serverPath: BROWSER_ANNOTATION_LISTEN_BASE_PATH,
      }),
    })
    return true
  }

  if (req.method === 'GET' && routePath === `${BROWSER_ANNOTATION_LISTEN_BASE_PATH}/status`) {
    const token = readBrowserAnnotationBearerToken(req)
    if (!token) {
      setJson(res, 401, { error: 'Missing extension bearer token' })
      return true
    }

    const session = store.getAuthorizedSessionStatus(token, readBrowserAnnotationSessionSelector(url))
    if (!session) {
      setJson(res, 401, { error: 'Invalid or expired extension bearer token' })
      return true
    }

    setJson(res, 200, { ok: true, session })
    return true
  }

  if (
    req.method === 'POST'
    && (routePath === `${BROWSER_ANNOTATION_LISTEN_BASE_PATH}/token`
      || routePath === `${BROWSER_ANNOTATION_LISTEN_BASE_PATH}/bind`)
  ) {
    const token = readBrowserAnnotationBearerToken(req)
    if (!token) {
      setJson(res, 401, { error: 'Missing extension bearer token' })
      return true
    }

    const bodyResult = await readJsonBody(req)
    if (!bodyResult.ok) {
      setJson(res, bodyResult.statusCode, { error: bodyResult.error })
      return true
    }
    const body = bodyResult.body
    const selector = {
      ...readBrowserAnnotationSessionSelector(url),
      ...(isRecord(body) ? readBrowserAnnotationSessionSelectorFromRecord(body) : {}),
    }
    const session = store.issueExtensionToken(token, selector)
    if (!session) {
      setJson(res, 401, { error: 'Invalid or expired pairing token' })
      return true
    }

    setJson(res, 200, { ok: true, session })
    return true
  }

  if (
    req.method === 'POST'
    && (routePath === `${BROWSER_ANNOTATION_LISTEN_BASE_PATH}/stop`
      || routePath === `${BROWSER_ANNOTATION_LISTEN_BASE_PATH}/binding/revoke`)
  ) {
    const token = readBrowserAnnotationBearerToken(req)
    if (!token) {
      setJson(res, 401, { error: 'Missing extension bearer token' })
      return true
    }

    const bodyResult = await readJsonBody(req)
    if (!bodyResult.ok) {
      setJson(res, bodyResult.statusCode, { error: bodyResult.error })
      return true
    }
    const body = bodyResult.body
    const selector = {
      ...readBrowserAnnotationSessionSelector(url),
      ...(isRecord(body) ? readBrowserAnnotationSessionSelectorFromRecord(body) : {}),
    }
    const session = store.stopAuthorizedSession(token, selector)
    if (!session) {
      setJson(res, 401, { error: 'Invalid, expired, or revoked extension bearer token' })
      return true
    }

    setJson(res, 200, { ok: true, session })
    return true
  }

  setJson(res, 404, { error: 'Unknown browser annotation listen endpoint' })
  return true
}

function hashPairingToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function doesTokenMatchHash(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashPairingToken(token), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function readBrowserAnnotationBearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization
  const value = Array.isArray(header) ? header[0] : header
  if (!value) return null
  const match = /^Bearer\s+(.+)$/i.exec(value.trim())
  const token = match?.[1]?.trim() ?? ''
  return token.length > 0 ? token : null
}

export function readBrowserAnnotationSessionSelector(url: URL): { sessionId?: string; threadId?: string } {
  return readBrowserAnnotationSessionSelectorFromRecord({
    sessionId: url.searchParams.get('sessionId'),
    threadId: url.searchParams.get('threadId'),
  })
}

export function readBrowserAnnotationSessionSelectorFromRecord(record: Record<string, unknown>): { sessionId?: string; threadId?: string } {
  const selector: { sessionId?: string; threadId?: string } = {}
  if (typeof record.sessionId === 'string' && record.sessionId.trim().length > 0) {
    selector.sessionId = record.sessionId.trim()
  }
  if (typeof record.threadId === 'string' && record.threadId.trim().length > 0) {
    selector.threadId = record.threadId.trim()
  }
  return selector
}

function deriveServerUrl(req: IncomingMessage): string | null {
  const host = singleHeader(req.headers.host)
  if (!host) return null
  const forwardedProto = singleHeader(req.headers['x-forwarded-proto'])?.split(',')[0]?.trim()
  const proto = forwardedProto || ((req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http')
  return `${proto}://${host}`
}

function singleHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

type JsonBodyReadResult =
  | { ok: true; body: unknown }
  | { ok: false; statusCode: 400 | 413; error: string }

async function readJsonBody(req: IncomingMessage): Promise<JsonBodyReadResult> {
  const chunks: Uint8Array[] = []
  let byteLength = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    byteLength += buffer.byteLength
    if (byteLength > BROWSER_ANNOTATION_LISTEN_JSON_BODY_LIMIT_BYTES) {
      return { ok: false, statusCode: 413, error: 'Browser annotation listen request body is too large' }
    }
    chunks.push(buffer)
  }
  const raw = Buffer.concat(chunks)
  if (raw.length === 0) return { ok: true, body: null }
  const text = raw.toString('utf8').trim()
  if (text.length === 0) return { ok: true, body: null }
  try {
    return { ok: true, body: JSON.parse(text) as unknown }
  } catch {
    return { ok: false, statusCode: 400, error: 'Malformed JSON body' }
  }
}

function setJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', Buffer.byteLength(body))
  res.end(body)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
