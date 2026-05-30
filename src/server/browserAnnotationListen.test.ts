import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BROWSER_ANNOTATION_EXTENSION_TOKEN_TTL_MS,
  BROWSER_ANNOTATION_LISTEN_TTL_MS,
  BrowserAnnotationListenStore,
  handleBrowserAnnotationListenRoutes,
  type BrowserAnnotationListenSessionResponse,
} from './browserAnnotationListen'

type JsonResponse = {
  status: number
  body: Record<string, unknown>
}

const servers: Server[] = []

async function listenWithStore(store: BrowserAnnotationListenStore): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (await handleBrowserAnnotationListenRoutes(req, res, url, { store })) return
    res.statusCode = 404
    res.end()
  })
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    }),
  }
}

async function requestJson(baseUrl: string, path: string, init: RequestInit = {}): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })
  const body = await response.json() as Record<string, unknown>
  return { status: response.status, body }
}

function sessionFrom(body: Record<string, unknown>): BrowserAnnotationListenSessionResponse {
  const session = body.session
  if (!session || typeof session !== 'object' || Array.isArray(session)) {
    throw new Error('Expected session response')
  }
  return session as BrowserAnnotationListenSessionResponse
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve())
  })))
})

describe('browser annotation listen endpoints', () => {
  it('starts a pairing session and authorizes status with the returned bearer token', async () => {
    const store = new BrowserAnnotationListenStore({ nowMs: () => Date.UTC(2026, 0, 1), ttlMs: 60_000 })
    const { baseUrl } = await listenWithStore(store)

    const start = await requestJson(baseUrl, '/codex-api/extension/listen/start', {
      method: 'POST',
      body: JSON.stringify({ threadId: 'thread-1' }),
    })

    expect(start.status).toBe(200)
    const started = sessionFrom(start.body)
    expect(started.threadId).toBe('thread-1')
    expect(started.status).toBe('active')
    expect(started.serverUrl).toMatch(/^http:\/\/127\.0\.0\.1:/)
    expect(started.serverPath).toBe('/codex-api/extension/listen')
    expect(started.tokenType).toBe('pairing')
    expect(started.pairingToken).toEqual(expect.any(String))

    const status = await requestJson(baseUrl, `/codex-api/extension/listen/status?sessionId=${started.sessionId}`, {
      headers: { Authorization: `Bearer ${started.pairingToken}` },
    })

    expect(status.status).toBe(200)
    const statusSession = sessionFrom(status.body)
    expect(statusSession.sessionId).toBe(started.sessionId)
    expect(statusSession.threadId).toBe('thread-1')
    expect(statusSession.status).toBe('active')
    expect(statusSession.tokenType).toBe('pairing')
    expect(statusSession.lastUsedAtIso).toBe('2026-01-01T00:00:00.000Z')
    expect(statusSession.pairingToken).toBeUndefined()

    store.recordReceivedBatch(started.sessionId, {
      batchId: 'batch-1',
      queuedMessageId: 'queued-batch-message',
      receivedAtIso: '2026-01-01T00:00:01.000Z',
      annotationCount: 2,
      imageCount: 1,
      consoleCount: 3,
      networkCount: 4,
    })
    const statusAfterBatch = await requestJson(baseUrl, `/codex-api/extension/listen/status?sessionId=${started.sessionId}`, {
      headers: { Authorization: `Bearer ${started.pairingToken}` },
    })

    expect(statusAfterBatch.status).toBe(200)
    expect(sessionFrom(statusAfterBatch.body).lastReceivedBatch).toEqual({
      batchId: 'batch-1',
      queuedMessageId: 'queued-batch-message',
      receivedAtIso: '2026-01-01T00:00:01.000Z',
      annotationCount: 2,
      imageCount: 1,
      consoleCount: 3,
      networkCount: 4,
    })
  })

  it('exchanges a valid pairing token for a long-lived scoped extension token', async () => {
    let now = Date.UTC(2026, 0, 1)
    const store = new BrowserAnnotationListenStore({
      nowMs: () => now,
      ttlMs: 60_000,
      extensionTokenTtlMs: 30 * 24 * 60 * 60 * 1000,
    })
    const { baseUrl } = await listenWithStore(store)
    const start = await requestJson(baseUrl, '/codex-api/extension/listen/start', {
      method: 'POST',
      body: JSON.stringify({ threadId: 'thread-persistent' }),
    })
    const started = sessionFrom(start.body)
    now += 5_000

    const token = await requestJson(baseUrl, '/codex-api/extension/listen/token', {
      method: 'POST',
      headers: { Authorization: `Bearer ${started.pairingToken}` },
      body: JSON.stringify({ sessionId: started.sessionId, threadId: started.threadId }),
    })

    expect(token.status).toBe(200)
    const persistentSession = sessionFrom(token.body)
    expect(persistentSession.sessionId).toBe(started.sessionId)
    expect(persistentSession.threadId).toBe('thread-persistent')
    expect(persistentSession.status).toBe('active')
    expect(persistentSession.tokenType).toBe('extension')
    expect(persistentSession.createdAtIso).toBe('2026-01-01T00:00:05.000Z')
    expect(persistentSession.lastUsedAtIso).toBe('2026-01-01T00:00:05.000Z')
    expect(persistentSession.expiresAtIso).toBe('2026-01-31T00:00:05.000Z')
    expect(persistentSession.extensionToken).toEqual(expect.any(String))
    expect(persistentSession.pairingToken).toBeUndefined()
    expect(persistentSession.extensionToken).not.toBe(started.pairingToken)
  })

  it('uses a longer default extension token expiry while keeping the pairing token short-lived', async () => {
    const now = Date.UTC(2026, 0, 1)
    const store = new BrowserAnnotationListenStore({ nowMs: () => now })
    const { baseUrl } = await listenWithStore(store)
    const start = await requestJson(baseUrl, '/codex-api/extension/listen/start', {
      method: 'POST',
      body: JSON.stringify({ threadId: 'thread-default-ttl' }),
    })
    const started = sessionFrom(start.body)

    const token = await requestJson(baseUrl, '/codex-api/extension/listen/token', {
      method: 'POST',
      headers: { Authorization: `Bearer ${started.pairingToken}` },
      body: JSON.stringify({ sessionId: started.sessionId }),
    })
    const persistentSession = sessionFrom(token.body)

    expect(Date.parse(started.expiresAtIso) - now).toBe(BROWSER_ANNOTATION_LISTEN_TTL_MS)
    expect(Date.parse(persistentSession.expiresAtIso) - now).toBe(BROWSER_ANNOTATION_EXTENSION_TOKEN_TTL_MS)
    expect(BROWSER_ANNOTATION_EXTENSION_TOKEN_TTL_MS).toBeGreaterThan(BROWSER_ANNOTATION_LISTEN_TTL_MS)
    expect(persistentSession.tokenType).toBe('extension')
  })

  it('keeps the same extension token while sliding its expiry forward on authorized requests', async () => {
    let now = Date.UTC(2026, 0, 1)
    const store = new BrowserAnnotationListenStore({
      nowMs: () => now,
      ttlMs: 60_000,
      extensionTokenTtlMs: 1_000,
    })
    const { baseUrl } = await listenWithStore(store)
    const start = await requestJson(baseUrl, '/codex-api/extension/listen/start', {
      method: 'POST',
      body: JSON.stringify({ threadId: 'thread-sliding-extension' }),
    })
    const started = sessionFrom(start.body)
    const token = await requestJson(baseUrl, '/codex-api/extension/listen/token', {
      method: 'POST',
      headers: { Authorization: `Bearer ${started.pairingToken}` },
      body: JSON.stringify({ sessionId: started.sessionId }),
    })
    const persistentSession = sessionFrom(token.body)
    const extensionToken = persistentSession.extensionToken
    expect(extensionToken).toEqual(expect.any(String))
    expect(persistentSession.expiresAtIso).toBe('2026-01-01T00:00:01.000Z')

    now += 800
    const renewed = await requestJson(baseUrl, `/codex-api/extension/listen/status?sessionId=${started.sessionId}`, {
      headers: { Authorization: `Bearer ${extensionToken}` },
    })
    const renewedSession = sessionFrom(renewed.body)

    expect(renewed.status).toBe(200)
    expect(renewedSession.sessionId).toBe(started.sessionId)
    expect(renewedSession.threadId).toBe('thread-sliding-extension')
    expect(renewedSession.tokenType).toBe('extension')
    expect(renewedSession.extensionToken).toBeUndefined()
    expect(renewedSession.lastUsedAtIso).toBe('2026-01-01T00:00:00.800Z')
    expect(renewedSession.expiresAtIso).toBe('2026-01-01T00:00:01.800Z')

    now += 400
    const stillAuthorized = await requestJson(baseUrl, `/codex-api/extension/listen/status?sessionId=${started.sessionId}`, {
      headers: { Authorization: `Bearer ${extensionToken}` },
    })

    expect(stillAuthorized.status).toBe(200)
    expect(sessionFrom(stillAuthorized.body)).toMatchObject({
      sessionId: started.sessionId,
      threadId: 'thread-sliding-extension',
      status: 'active',
      tokenType: 'extension',
      lastUsedAtIso: '2026-01-01T00:00:01.200Z',
      expiresAtIso: '2026-01-01T00:00:02.200Z',
    })
  })

  it('authorizes status and downstream session lookup with a persistent token after the pairing token expires', async () => {
    let now = Date.UTC(2026, 0, 1)
    const store = new BrowserAnnotationListenStore({
      nowMs: () => now,
      ttlMs: 100,
      extensionTokenTtlMs: 10_000,
    })
    const { baseUrl } = await listenWithStore(store)
    const start = await requestJson(baseUrl, '/codex-api/extension/listen/start', {
      method: 'POST',
      body: JSON.stringify({ threadId: 'thread-after-pairing' }),
    })
    const started = sessionFrom(start.body)
    const token = await requestJson(baseUrl, '/codex-api/extension/listen/token', {
      method: 'POST',
      headers: { Authorization: `Bearer ${started.pairingToken}` },
      body: JSON.stringify({ sessionId: started.sessionId }),
    })
    const extensionToken = sessionFrom(token.body).extensionToken
    expect(extensionToken).toEqual(expect.any(String))

    now += 101
    const pairingStatus = await requestJson(baseUrl, `/codex-api/extension/listen/status?sessionId=${started.sessionId}`, {
      headers: { Authorization: `Bearer ${started.pairingToken}` },
    })
    const persistentStatus = await requestJson(baseUrl, `/codex-api/extension/listen/status?sessionId=${started.sessionId}`, {
      headers: { Authorization: `Bearer ${extensionToken}` },
    })
    const authorized = store.getAuthorizedSession(extensionToken ?? '', { sessionId: started.sessionId })

    expect(pairingStatus.status).toBe(401)
    expect(persistentStatus.status).toBe(200)
    expect(sessionFrom(persistentStatus.body)).toMatchObject({
      sessionId: started.sessionId,
      threadId: 'thread-after-pairing',
      status: 'active',
      tokenType: 'extension',
      lastUsedAtIso: '2026-01-01T00:00:00.101Z',
    })
    expect(authorized).toMatchObject({
      sessionId: started.sessionId,
      threadId: 'thread-after-pairing',
      status: 'active',
      tokenType: 'extension',
    })
  })

  it('revokes a persistent token through the existing stop endpoint', async () => {
    let now = Date.UTC(2026, 0, 1)
    const store = new BrowserAnnotationListenStore({ nowMs: () => now, ttlMs: 60_000, extensionTokenTtlMs: 10_000 })
    const { baseUrl } = await listenWithStore(store)
    const start = await requestJson(baseUrl, '/codex-api/extension/listen/start', {
      method: 'POST',
      body: JSON.stringify({ threadId: 'thread-disconnect' }),
    })
    const started = sessionFrom(start.body)
    const token = await requestJson(baseUrl, '/codex-api/extension/listen/token', {
      method: 'POST',
      headers: { Authorization: `Bearer ${started.pairingToken}` },
      body: JSON.stringify({ sessionId: started.sessionId }),
    })
    const extensionToken = sessionFrom(token.body).extensionToken
    now += 250

    const stopped = await requestJson(baseUrl, '/codex-api/extension/listen/stop', {
      method: 'POST',
      headers: { Authorization: `Bearer ${extensionToken}` },
      body: JSON.stringify({ sessionId: started.sessionId }),
    })
    const status = await requestJson(baseUrl, `/codex-api/extension/listen/status?sessionId=${started.sessionId}`, {
      headers: { Authorization: `Bearer ${extensionToken}` },
    })
    const authorized = store.getAuthorizedSession(extensionToken ?? '', { sessionId: started.sessionId })

    expect(stopped.status).toBe(200)
    expect(sessionFrom(stopped.body)).toMatchObject({
      sessionId: started.sessionId,
      status: 'revoked',
      tokenType: 'extension',
    })
    expect(status.status).toBe(200)
    expect(sessionFrom(status.body)).toMatchObject({
      sessionId: started.sessionId,
      status: 'revoked',
      tokenType: 'extension',
    })
    expect(authorized).toBeNull()
  })

  it('supports extension-facing bind and binding revoke aliases', async () => {
    const store = new BrowserAnnotationListenStore({ nowMs: () => Date.UTC(2026, 0, 1), ttlMs: 60_000 })
    const { baseUrl } = await listenWithStore(store)
    const start = await requestJson(baseUrl, '/codex-api/extension/listen/start', {
      method: 'POST',
      body: JSON.stringify({ threadId: 'thread-bind-alias' }),
    })
    const started = sessionFrom(start.body)

    const bound = await requestJson(baseUrl, '/codex-api/extension/listen/bind', {
      method: 'POST',
      headers: { Authorization: `Bearer ${started.pairingToken}` },
      body: JSON.stringify({ sessionId: started.sessionId }),
    })
    const boundSession = sessionFrom(bound.body)
    const revoked = await requestJson(baseUrl, '/codex-api/extension/listen/binding/revoke', {
      method: 'POST',
      headers: { Authorization: `Bearer ${boundSession.extensionToken}` },
      body: JSON.stringify({ sessionId: started.sessionId }),
    })

    expect(bound.status).toBe(200)
    expect(boundSession.tokenType).toBe('extension')
    expect(boundSession.extensionToken).toEqual(expect.any(String))
    expect(revoked.status).toBe(200)
    expect(sessionFrom(revoked.body)).toMatchObject({
      sessionId: started.sessionId,
      status: 'revoked',
      tokenType: 'extension',
    })
  })

  it('does not issue persistent tokens for wrong or already-expired pairing tokens', async () => {
    let now = Date.UTC(2026, 0, 1)
    const store = new BrowserAnnotationListenStore({ nowMs: () => now, ttlMs: 100, extensionTokenTtlMs: 10_000 })
    const { baseUrl } = await listenWithStore(store)
    const start = await requestJson(baseUrl, '/codex-api/extension/listen/start', {
      method: 'POST',
      body: JSON.stringify({ threadId: 'thread-token-reject' }),
    })
    const started = sessionFrom(start.body)

    const wrong = await requestJson(baseUrl, '/codex-api/extension/listen/token', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-token' },
      body: JSON.stringify({ sessionId: started.sessionId }),
    })
    now += 101
    const expired = await requestJson(baseUrl, '/codex-api/extension/listen/token', {
      method: 'POST',
      headers: { Authorization: `Bearer ${started.pairingToken}` },
      body: JSON.stringify({ sessionId: started.sessionId }),
    })

    expect(wrong.status).toBe(401)
    expect(wrong.body.error).toBe('Invalid or expired pairing token')
    expect(expired.status).toBe(401)
    expect(expired.body.error).toBe('Invalid or expired pairing token')
  })

  it('rejects expired pairing tokens', async () => {
    let now = Date.UTC(2026, 0, 1)
    const store = new BrowserAnnotationListenStore({ nowMs: () => now, ttlMs: 100 })
    const { baseUrl } = await listenWithStore(store)
    const start = await requestJson(baseUrl, '/codex-api/extension/listen/start', {
      method: 'POST',
      body: JSON.stringify({ threadId: 'thread-expire' }),
    })
    const started = sessionFrom(start.body)

    now += 101
    const status = await requestJson(baseUrl, `/codex-api/extension/listen/status?sessionId=${started.sessionId}`, {
      headers: { Authorization: `Bearer ${started.pairingToken}` },
    })

    expect(status.status).toBe(401)
    expect(status.body.error).toBe('Invalid or expired extension bearer token')
  })

  it('rejects the wrong bearer token for an active session', async () => {
    const store = new BrowserAnnotationListenStore({ nowMs: () => Date.UTC(2026, 0, 1), ttlMs: 60_000 })
    const { baseUrl } = await listenWithStore(store)
    const start = await requestJson(baseUrl, '/codex-api/extension/listen/start', {
      method: 'POST',
      body: JSON.stringify({ threadId: 'thread-wrong-token' }),
    })
    const started = sessionFrom(start.body)

    const status = await requestJson(baseUrl, `/codex-api/extension/listen/status?sessionId=${started.sessionId}`, {
      headers: { Authorization: 'Bearer not-the-token' },
    })

    expect(status.status).toBe(401)
    expect(status.body.error).toBe('Invalid or expired extension bearer token')
  })

  it('revokes a session and returns revoked status for the same token afterwards', async () => {
    const store = new BrowserAnnotationListenStore({ nowMs: () => Date.UTC(2026, 0, 1), ttlMs: 60_000 })
    const { baseUrl } = await listenWithStore(store)
    const start = await requestJson(baseUrl, '/codex-api/extension/listen/start', {
      method: 'POST',
      body: JSON.stringify({ threadId: 'thread-revoke' }),
    })
    const started = sessionFrom(start.body)

    const stopped = await requestJson(baseUrl, '/codex-api/extension/listen/stop', {
      method: 'POST',
      headers: { Authorization: `Bearer ${started.pairingToken}` },
      body: JSON.stringify({ sessionId: started.sessionId }),
    })

    expect(stopped.status).toBe(200)
    expect(sessionFrom(stopped.body).status).toBe('revoked')

    const status = await requestJson(baseUrl, `/codex-api/extension/listen/status?sessionId=${started.sessionId}`, {
      headers: { Authorization: `Bearer ${started.pairingToken}` },
    })

    expect(status.status).toBe(200)
    const statusSession = sessionFrom(status.body)
    expect(statusSession.sessionId).toBe(started.sessionId)
    expect(statusSession.status).toBe('revoked')
  })

  it('rejects malformed start JSON without creating a session', async () => {
    const store = new BrowserAnnotationListenStore({ nowMs: () => Date.UTC(2026, 0, 1), ttlMs: 60_000 })
    const { baseUrl } = await listenWithStore(store)

    const response = await fetch(`${baseUrl}/codex-api/extension/listen/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"threadId":',
    })
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(400)
    expect(body.error).toBe('Malformed JSON body')
  })

  it('rejects oversized stop JSON bodies before token lookup', async () => {
    const store = new BrowserAnnotationListenStore({ nowMs: () => Date.UTC(2026, 0, 1), ttlMs: 60_000 })
    const { baseUrl } = await listenWithStore(store)
    const start = await requestJson(baseUrl, '/codex-api/extension/listen/start', {
      method: 'POST',
      body: JSON.stringify({ threadId: 'thread-large-body' }),
    })
    const started = sessionFrom(start.body)

    const tooLargeBody = JSON.stringify({ sessionId: started.sessionId, padding: 'x'.repeat(20_000) })
    const response = await fetch(`${baseUrl}/codex-api/extension/listen/stop`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${started.pairingToken}`,
        'Content-Type': 'application/json',
      },
      body: tooLargeBody,
    })
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(413)
    expect(body.error).toBe('Browser annotation listen request body is too large')
  })

  it('revokes an older active session when the same thread starts listening again', async () => {
    let now = Date.UTC(2026, 0, 1)
    const store = new BrowserAnnotationListenStore({ nowMs: () => now, ttlMs: 60_000 })
    const { baseUrl } = await listenWithStore(store)
    const first = await requestJson(baseUrl, '/codex-api/extension/listen/start', {
      method: 'POST',
      body: JSON.stringify({ threadId: 'thread-replace' }),
    })
    const firstSession = sessionFrom(first.body)
    now += 1

    const second = await requestJson(baseUrl, '/codex-api/extension/listen/start', {
      method: 'POST',
      body: JSON.stringify({ threadId: 'thread-replace' }),
    })
    const secondSession = sessionFrom(second.body)

    const oldStatus = await requestJson(baseUrl, `/codex-api/extension/listen/status?sessionId=${firstSession.sessionId}`, {
      headers: { Authorization: `Bearer ${firstSession.pairingToken}` },
    })
    const newStatus = await requestJson(baseUrl, `/codex-api/extension/listen/status?sessionId=${secondSession.sessionId}`, {
      headers: { Authorization: `Bearer ${secondSession.pairingToken}` },
    })

    expect(oldStatus.status).toBe(200)
    expect(sessionFrom(oldStatus.body).status).toBe('revoked')
    expect(newStatus.status).toBe(200)
    expect(sessionFrom(newStatus.body).sessionId).toBe(secondSession.sessionId)
  })

  it('caps retained listen sessions by removing the oldest records', async () => {
    let now = Date.UTC(2026, 0, 1)
    const store = new BrowserAnnotationListenStore({ nowMs: () => now, ttlMs: 60_000, maxActiveSessions: 2 })
    const { baseUrl } = await listenWithStore(store)
    const sessions: BrowserAnnotationListenSessionResponse[] = []

    for (const threadId of ['thread-1', 'thread-2', 'thread-3']) {
      const start = await requestJson(baseUrl, '/codex-api/extension/listen/start', {
        method: 'POST',
        body: JSON.stringify({ threadId }),
      })
      sessions.push(sessionFrom(start.body))
      now += 1
    }

    const oldest = await requestJson(baseUrl, `/codex-api/extension/listen/status?sessionId=${sessions[0]?.sessionId}`, {
      headers: { Authorization: `Bearer ${sessions[0]?.pairingToken}` },
    })
    const newest = await requestJson(baseUrl, `/codex-api/extension/listen/status?sessionId=${sessions[2]?.sessionId}`, {
      headers: { Authorization: `Bearer ${sessions[2]?.pairingToken}` },
    })

    expect(oldest.status).toBe(401)
    expect(newest.status).toBe(200)
  })
})
