import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CodexApiError } from './codexErrors'

const capacitorMock = vi.hoisted(() => ({
  platform: 'web',
  native: false,
  request: vi.fn(),
  getCookies: vi.fn(),
  setCookie: vi.fn(),
  deleteCookie: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => capacitorMock.platform,
    isNativePlatform: () => capacitorMock.native,
  },
  CapacitorHttp: {
    request: capacitorMock.request,
  },
  CapacitorCookies: {
    getCookies: capacitorMock.getCookies,
    setCookie: capacitorMock.setCookie,
    deleteCookie: capacitorMock.deleteCookie,
  },
}))

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
    capacitorMock.platform = 'web'
    capacitorMock.native = false
    capacitorMock.request.mockReset()
    capacitorMock.getCookies.mockReset()
    capacitorMock.setCookie.mockReset()
    capacitorMock.deleteCookie.mockReset()
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
    capacitorMock.platform = 'web'
    capacitorMock.native = false
    vi.unstubAllGlobals()
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

  it('does not treat an HTML response as an authenticated remote backend status', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<!doctype html><html><title>Codex Web</title></html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }))

    await expect(readRemoteBackendAuthStatus()).resolves.toBe('unknown')
  })

  it('stores the native iOS remote login cookie returned by CapacitorHttp', async () => {
    capacitorMock.platform = 'ios'
    capacitorMock.native = true
    const storage = new Map<string, string>([
      ['codex-web-local.backend-url.v1', 'https://codex-ui.todo-tg-app.ru'],
    ])
    vi.stubGlobal('window', {
      location: { href: 'capacitor://localhost/' },
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
      Capacitor: {
        getPlatform: () => 'ios',
        isNativePlatform: () => true,
      },
    })
    capacitorMock.deleteCookie.mockResolvedValueOnce(undefined)
    capacitorMock.request.mockResolvedValueOnce({
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'set-cookie': 'portal_session=session-1; Path=/; HttpOnly; SameSite=None; Secure; Expires=Wed, 11 Jun 2036 17:00:00 GMT',
      },
      data: { ok: true },
      url: 'https://codex-ui.todo-tg-app.ru/auth/login',
    })
    capacitorMock.getCookies
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ portal_session: 'session-1' })
    capacitorMock.setCookie.mockResolvedValueOnce(undefined)

    await loginRemoteBackend('secret')

    expect(capacitorMock.request).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://codex-ui.todo-tg-app.ru/auth/login',
      method: 'POST',
      responseType: 'json',
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
        Origin: 'capacitor://localhost',
      }),
    }))
    expect(capacitorMock.setCookie).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://codex-ui.todo-tg-app.ru',
      key: 'portal_session',
      value: 'session-1',
      path: '/',
    }))
  })
})
