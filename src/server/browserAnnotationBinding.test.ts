import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BrowserAnnotationBindingStore,
  handleBrowserAnnotationBindingRoutes,
  type BrowserAnnotationBindingResponse,
} from './browserAnnotationBinding'

type JsonResponse = {
  status: number
  body: Record<string, unknown>
}

const servers: Server[] = []

async function listenWithStore(store: BrowserAnnotationBindingStore): Promise<{ baseUrl: string }> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (await handleBrowserAnnotationBindingRoutes(req, res, url, { store })) return
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
  return { baseUrl: `http://127.0.0.1:${address.port}` }
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

function bindingFrom(body: Record<string, unknown>): BrowserAnnotationBindingResponse {
  const binding = body.binding
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
    throw new Error('Expected binding response')
  }
  return binding as BrowserAnnotationBindingResponse
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve())
  })))
})

describe('browser annotation binding endpoints', () => {
  it('pairs a browser extension without creating a thread-scoped listen session', async () => {
    const store = new BrowserAnnotationBindingStore({ nowMs: () => Date.UTC(2026, 0, 1), pairingTtlMs: 60_000 })
    const { baseUrl } = await listenWithStore(store)

    const start = await requestJson(baseUrl, '/codex-api/extension/binding/start', {
      method: 'POST',
    })

    expect(start.status).toBe(200)
    const pairing = start.body.pairing as Record<string, unknown>
    expect(pairing.pairingId).toEqual(expect.any(String))
    expect(pairing.pairingCode).toEqual(expect.any(String))
    expect(pairing.serverPath).toBe('/codex-api/extension/binding')
    expect(pairing.expiresAtIso).toBe('2026-01-01T00:01:00.000Z')
    expect(pairing).not.toHaveProperty('threadId')
    expect(pairing).not.toHaveProperty('sessionId')

    const complete = await requestJson(baseUrl, '/codex-api/extension/binding/complete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${pairing.pairingCode}` },
      body: JSON.stringify({ pairingId: pairing.pairingId }),
    })

    expect(complete.status).toBe(200)
    const binding = bindingFrom(complete.body)
    expect(binding.bindingId).toEqual(expect.any(String))
    expect(binding.status).toBe('active')
    expect(binding.tokenType).toBe('browser-binding')
    expect(binding.bindingToken).toEqual(expect.any(String))
    expect(binding).not.toHaveProperty('threadId')
    expect(binding).not.toHaveProperty('sessionId')
  })

  it('validates browser binding status without returning the bearer token', async () => {
    const store = new BrowserAnnotationBindingStore({ nowMs: () => Date.UTC(2026, 0, 1), pairingTtlMs: 60_000 })
    const { baseUrl } = await listenWithStore(store)
    const start = await requestJson(baseUrl, '/codex-api/extension/binding/start', { method: 'POST' })
    const pairing = start.body.pairing as Record<string, unknown>
    const complete = await requestJson(baseUrl, '/codex-api/extension/binding/complete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${pairing.pairingCode}` },
      body: JSON.stringify({ pairingId: pairing.pairingId }),
    })
    const token = bindingFrom(complete.body).bindingToken
    expect(token).toEqual(expect.any(String))

    const status = await requestJson(baseUrl, '/codex-api/extension/binding/status', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(status.status).toBe(200)
    const binding = bindingFrom(status.body)
    expect(binding.status).toBe('active')
    expect(binding.tokenType).toBe('browser-binding')
    expect(binding.bindingToken).toBeUndefined()
    expect(binding).not.toHaveProperty('threadId')
  })

  it('rejects obsolete listen tokens for browser binding status', async () => {
    const store = new BrowserAnnotationBindingStore({ nowMs: () => Date.UTC(2026, 0, 1), pairingTtlMs: 60_000 })
    const { baseUrl } = await listenWithStore(store)

    const status = await requestJson(baseUrl, '/codex-api/extension/binding/status', {
      headers: { Authorization: 'Bearer obsolete-listen-token' },
    })

    expect(status.status).toBe(401)
    expect(status.body.error).toBe('Invalid or expired browser binding token')
  })
})
