import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import {
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
    expect(started.pairingToken).toEqual(expect.any(String))

    const status = await requestJson(baseUrl, `/codex-api/extension/listen/status?sessionId=${started.sessionId}`, {
      headers: { Authorization: `Bearer ${started.pairingToken}` },
    })

    expect(status.status).toBe(200)
    const statusSession = sessionFrom(status.body)
    expect(statusSession.sessionId).toBe(started.sessionId)
    expect(statusSession.threadId).toBe('thread-1')
    expect(statusSession.status).toBe('active')
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

  it('revokes a session and rejects the revoked token afterwards', async () => {
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

    expect(status.status).toBe(401)
    expect(status.body.error).toBe('Invalid or expired extension bearer token')
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

    expect(oldStatus.status).toBe(401)
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
