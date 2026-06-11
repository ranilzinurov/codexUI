import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CodexApiError } from './codexErrors'
import { loginRemoteBackend, readRemoteBackendAuthStatus } from './remoteBackendAuth'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('remote backend auth helpers', () => {
  let originalFetch: typeof fetch | undefined
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    originalFetch = globalThis.fetch
    fetchMock = vi.fn()
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
    })
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    })
  })

  it('logs into the remote backend with a credentialed JSON request', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))

    await loginRemoteBackend('secret')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'secret' }),
      signal: undefined,
    })
  })

  it('throws a sanitized API error when the backend rejects the password', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Invalid password' }, 401))

    await expect(loginRemoteBackend('wrong')).rejects.toMatchObject({
      name: 'CodexApiError',
      code: 'http_error',
      method: '/auth/login',
      status: 401,
      message: 'Invalid password',
    } satisfies Partial<CodexApiError>)
  })

  it('reports unauthenticated status on 401 and authenticated status on success', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'Authentication required' }, 401))
      .mockResolvedValueOnce(jsonResponse({ data: {} }))

    await expect(readRemoteBackendAuthStatus()).resolves.toBe('unauthenticated')
    await expect(readRemoteBackendAuthStatus()).resolves.toBe('authenticated')
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/codex-api/thread-queue-state', {
      credentials: 'include',
      signal: undefined,
    })
  })
})
