import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

export const BROWSER_ANNOTATION_BINDING_BASE_PATH = '/codex-api/extension/binding'
export const BROWSER_ANNOTATION_BINDING_PAIRING_TTL_MS = 10 * 60 * 1000
export const BROWSER_ANNOTATION_BINDING_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000
export const BROWSER_ANNOTATION_BINDING_MAX_ACTIVE_BINDINGS = 100
const BROWSER_ANNOTATION_BINDING_JSON_BODY_LIMIT_BYTES = 16 * 1024

export type BrowserAnnotationBindingStatus = 'active' | 'expired' | 'revoked'

export type BrowserAnnotationBindingPairingResponse = {
  pairingId: string
  pairingCode?: string
  serverUrl: string | null
  serverPath: string
  expiresAtIso: string
  createdAtIso: string
  status: BrowserAnnotationBindingStatus
}

export type BrowserAnnotationBindingResponse = {
  bindingId: string
  serverUrl: string | null
  serverPath: string
  expiresAtIso: string
  createdAtIso: string
  status: BrowserAnnotationBindingStatus
  tokenType: 'browser-binding'
  lastUsedAtIso?: string
  bindingToken?: string
}

type BrowserAnnotationBindingPairingRecord = {
  pairingId: string
  codeHash: string
  serverUrl: string | null
  serverPath: string
  createdAtMs: number
  expiresAtMs: number
  revokedAtMs: number | null
}

type BrowserAnnotationBindingRecord = {
  bindingId: string
  tokenHash: string
  serverUrl: string | null
  serverPath: string
  createdAtMs: number
  expiresAtMs: number
  lastUsedAtMs: number | null
  revokedAtMs: number | null
}

type BrowserAnnotationBindingStoreOptions = {
  pairingTtlMs?: number
  bindingTokenTtlMs?: number
  nowMs?: () => number
  tokenBytes?: number
  maxActiveBindings?: number
}

export class BrowserAnnotationBindingStore {
  private readonly pairings = new Map<string, BrowserAnnotationBindingPairingRecord>()
  private readonly bindings = new Map<string, BrowserAnnotationBindingRecord>()
  private readonly pairingTtlMs: number
  private readonly bindingTokenTtlMs: number
  private readonly nowMs: () => number
  private readonly tokenBytes: number
  private readonly maxActiveBindings: number

  constructor(options: BrowserAnnotationBindingStoreOptions = {}) {
    this.pairingTtlMs = options.pairingTtlMs ?? BROWSER_ANNOTATION_BINDING_PAIRING_TTL_MS
    this.bindingTokenTtlMs = options.bindingTokenTtlMs ?? BROWSER_ANNOTATION_BINDING_TOKEN_TTL_MS
    this.nowMs = options.nowMs ?? Date.now
    this.tokenBytes = options.tokenBytes ?? 24
    this.maxActiveBindings = options.maxActiveBindings ?? BROWSER_ANNOTATION_BINDING_MAX_ACTIVE_BINDINGS
  }

  start(input: { serverUrl: string | null; serverPath?: string }): BrowserAnnotationBindingPairingResponse {
    this.pruneExpired()
    const now = this.nowMs()
    const pairingCode = randomBytes(this.tokenBytes).toString('base64url')
    const pairing: BrowserAnnotationBindingPairingRecord = {
      pairingId: randomBytes(16).toString('hex'),
      codeHash: hashToken(pairingCode),
      serverUrl: input.serverUrl,
      serverPath: input.serverPath || BROWSER_ANNOTATION_BINDING_BASE_PATH,
      createdAtMs: now,
      expiresAtMs: now + this.pairingTtlMs,
      revokedAtMs: null,
    }
    this.pairings.set(pairing.pairingId, pairing)
    return {
      ...this.toPairingResponse(pairing),
      pairingCode,
    }
  }

  complete(pairingCode: string, selector: { pairingId?: string } = {}): BrowserAnnotationBindingResponse | null {
    this.pruneExpired()
    const candidates = selector.pairingId
      ? [this.pairings.get(selector.pairingId)].filter((pairing): pairing is BrowserAnnotationBindingPairingRecord => Boolean(pairing))
      : Array.from(this.pairings.values())
    const pairing = candidates.find((candidate) => (
      this.getPairingStatus(candidate) === 'active' && doesTokenMatchHash(pairingCode, candidate.codeHash)
    ))
    if (!pairing) return null

    pairing.revokedAtMs = this.nowMs()
    this.pruneOldestBindingsOverLimit(this.maxActiveBindings - 1)
    const now = this.nowMs()
    const bindingToken = randomBytes(this.tokenBytes).toString('base64url')
    const binding: BrowserAnnotationBindingRecord = {
      bindingId: randomBytes(16).toString('hex'),
      tokenHash: hashToken(bindingToken),
      serverUrl: pairing.serverUrl,
      serverPath: pairing.serverPath,
      createdAtMs: now,
      expiresAtMs: now + this.bindingTokenTtlMs,
      lastUsedAtMs: now,
      revokedAtMs: null,
    }
    this.bindings.set(binding.bindingId, binding)
    return {
      ...this.toBindingResponse(binding),
      bindingToken,
    }
  }

  getAuthorizedBinding(token: string, options: { allowRevoked?: boolean } = {}): BrowserAnnotationBindingResponse | null {
    this.pruneExpired()
    const binding = this.findAuthorizedBinding(token, options)
    return binding ? this.toBindingResponse(binding) : null
  }

  revokeAuthorizedBinding(token: string): BrowserAnnotationBindingResponse | null {
    this.pruneExpired()
    const binding = this.findAuthorizedBinding(token)
    if (!binding) return null
    binding.revokedAtMs = this.nowMs()
    return this.toBindingResponse(binding)
  }

  private findAuthorizedBinding(
    token: string,
    options: { allowRevoked?: boolean } = {},
  ): BrowserAnnotationBindingRecord | null {
    for (const binding of this.bindings.values()) {
      const status = this.getBindingStatus(binding)
      if (status !== 'active' && !(options.allowRevoked && status === 'revoked')) continue
      if (!doesTokenMatchHash(token, binding.tokenHash)) continue
      if (status === 'active') {
        const now = this.nowMs()
        binding.lastUsedAtMs = now
        binding.expiresAtMs = now + this.bindingTokenTtlMs
      }
      return binding
    }
    return null
  }

  private pruneExpired(): void {
    const now = this.nowMs()
    for (const [pairingId, pairing] of this.pairings.entries()) {
      if (pairing.revokedAtMs !== null || pairing.expiresAtMs <= now) {
        this.pairings.delete(pairingId)
      }
    }
    for (const [bindingId, binding] of this.bindings.entries()) {
      if (binding.revokedAtMs === null && binding.expiresAtMs <= now) {
        this.bindings.delete(bindingId)
      }
    }
  }

  private pruneOldestBindingsOverLimit(maxBeforeNewBinding: number): void {
    if (this.bindings.size <= maxBeforeNewBinding) return
    const bindingsByAge = Array.from(this.bindings.values()).sort((left, right) => left.createdAtMs - right.createdAtMs)
    for (const binding of bindingsByAge) {
      if (this.bindings.size <= maxBeforeNewBinding) return
      this.bindings.delete(binding.bindingId)
    }
  }

  private getPairingStatus(pairing: BrowserAnnotationBindingPairingRecord): BrowserAnnotationBindingStatus {
    if (pairing.revokedAtMs !== null) return 'revoked'
    return pairing.expiresAtMs <= this.nowMs() ? 'expired' : 'active'
  }

  private getBindingStatus(binding: BrowserAnnotationBindingRecord): BrowserAnnotationBindingStatus {
    if (binding.revokedAtMs !== null) return 'revoked'
    return binding.expiresAtMs <= this.nowMs() ? 'expired' : 'active'
  }

  private toPairingResponse(pairing: BrowserAnnotationBindingPairingRecord): BrowserAnnotationBindingPairingResponse {
    return {
      pairingId: pairing.pairingId,
      serverUrl: pairing.serverUrl,
      serverPath: pairing.serverPath,
      expiresAtIso: new Date(pairing.expiresAtMs).toISOString(),
      createdAtIso: new Date(pairing.createdAtMs).toISOString(),
      status: this.getPairingStatus(pairing),
    }
  }

  private toBindingResponse(binding: BrowserAnnotationBindingRecord): BrowserAnnotationBindingResponse {
    return {
      bindingId: binding.bindingId,
      serverUrl: binding.serverUrl,
      serverPath: binding.serverPath,
      expiresAtIso: new Date(binding.expiresAtMs).toISOString(),
      createdAtIso: new Date(binding.createdAtMs).toISOString(),
      status: this.getBindingStatus(binding),
      tokenType: 'browser-binding',
      ...(binding.lastUsedAtMs !== null ? { lastUsedAtIso: new Date(binding.lastUsedAtMs).toISOString() } : {}),
    }
  }
}

export const sharedBrowserAnnotationBindingStore = new BrowserAnnotationBindingStore()

export type BrowserAnnotationBindingRouteOptions = {
  store?: BrowserAnnotationBindingStore
}

export async function handleBrowserAnnotationBindingRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  options: BrowserAnnotationBindingRouteOptions = {},
): Promise<boolean> {
  if (!url.pathname.startsWith(`${BROWSER_ANNOTATION_BINDING_BASE_PATH}/`)) return false

  const store = options.store ?? sharedBrowserAnnotationBindingStore
  const routePath = url.pathname

  if (req.method === 'POST' && routePath === `${BROWSER_ANNOTATION_BINDING_BASE_PATH}/start`) {
    setJson(res, 200, {
      ok: true,
      pairing: store.start({
        serverUrl: deriveServerUrl(req),
        serverPath: BROWSER_ANNOTATION_BINDING_BASE_PATH,
      }),
    })
    return true
  }

  if (req.method === 'POST' && routePath === `${BROWSER_ANNOTATION_BINDING_BASE_PATH}/complete`) {
    const token = readBrowserAnnotationBearerToken(req)
    if (!token) {
      setJson(res, 401, { error: 'Missing browser binding pairing code' })
      return true
    }

    const bodyResult = await readJsonBody(req)
    if (!bodyResult.ok) {
      setJson(res, bodyResult.statusCode, { error: bodyResult.error })
      return true
    }
    const body = bodyResult.body
    const binding = store.complete(token, isRecord(body) ? { pairingId: readString(body.pairingId) } : {})
    if (!binding) {
      setJson(res, 401, { error: 'Invalid or expired browser binding pairing code' })
      return true
    }

    setJson(res, 200, { ok: true, binding })
    return true
  }

  if (req.method === 'GET' && routePath === `${BROWSER_ANNOTATION_BINDING_BASE_PATH}/status`) {
    const token = readBrowserAnnotationBearerToken(req)
    if (!token) {
      setJson(res, 401, { error: 'Missing browser binding bearer token' })
      return true
    }
    const binding = store.getAuthorizedBinding(token, { allowRevoked: true })
    if (!binding) {
      setJson(res, 401, { error: 'Invalid or expired browser binding token' })
      return true
    }
    setJson(res, 200, { ok: true, binding })
    return true
  }

  if (req.method === 'POST' && routePath === `${BROWSER_ANNOTATION_BINDING_BASE_PATH}/revoke`) {
    const token = readBrowserAnnotationBearerToken(req)
    if (!token) {
      setJson(res, 401, { error: 'Missing browser binding bearer token' })
      return true
    }
    const binding = store.revokeAuthorizedBinding(token)
    if (!binding) {
      setJson(res, 401, { error: 'Invalid, expired, or revoked browser binding token' })
      return true
    }
    setJson(res, 200, { ok: true, binding })
    return true
  }

  setJson(res, 404, { error: 'Unknown browser annotation binding endpoint' })
  return true
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function doesTokenMatchHash(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashToken(token), 'hex')
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
    if (byteLength > BROWSER_ANNOTATION_BINDING_JSON_BODY_LIMIT_BYTES) {
      return { ok: false, statusCode: 413, error: 'Browser annotation binding request body is too large' }
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

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
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
