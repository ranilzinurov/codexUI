import { afterEach, describe, expect, it, vi } from 'vitest'

const capacitorMock = vi.hoisted(() => ({
  platform: 'web',
  native: false,
  request: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => capacitorMock.platform,
    isNativePlatform: () => capacitorMock.native,
  },
  CapacitorHttp: {
    request: capacitorMock.request,
  },
}))

import {
  getBackendUrlStorageKey,
  getConfiguredBackendUrl,
  installBackendRequestRouting,
  resolveBackendHttpUrl,
} from './backendUrl'

function installWindow(options: {
  platform?: string
  native?: boolean
  storedBackendUrl?: string
  fetch?: typeof fetch
} = {}) {
  const storage = new Map<string, string>()
  if (options.storedBackendUrl !== undefined) {
    storage.set(getBackendUrlStorageKey(), options.storedBackendUrl)
  }
  capacitorMock.platform = options.platform ?? 'web'
  capacitorMock.native = options.native === true

  vi.stubGlobal('window', {
    location: { href: 'capacitor://localhost/' },
    fetch: options.fetch ?? vi.fn(),
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    Capacitor: {
      getPlatform: () => options.platform ?? 'web',
      isNativePlatform: () => options.native === true,
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })
}

afterEach(() => {
  capacitorMock.platform = 'web'
  capacitorMock.native = false
  capacitorMock.request.mockReset()
  vi.unstubAllGlobals()
})

describe('backend URL routing', () => {
  it('uses the production backend by default inside the native iOS shell', () => {
    installWindow({ platform: 'ios', native: true })

    expect(getConfiguredBackendUrl()).toBe('https://codex-ui.todo-tg-app.ru')
    expect(resolveBackendHttpUrl('/codex-api/threads')).toBe('https://codex-ui.todo-tg-app.ru/codex-api/threads')
  })

  it('keeps an explicitly saved backend URL above the native iOS default', () => {
    installWindow({
      platform: 'ios',
      native: true,
      storedBackendUrl: 'https://custom.example.test/',
    })

    expect(getConfiguredBackendUrl()).toBe('https://custom.example.test')
    expect(resolveBackendHttpUrl('/codex-api/ws?thread=1')).toBe('https://custom.example.test/codex-api/ws?thread=1')
  })

  it('routes remote login requests to the configured backend', () => {
    installWindow({
      platform: 'ios',
      native: true,
      storedBackendUrl: 'https://codex-ui.todo-tg-app.ru',
    })

    expect(resolveBackendHttpUrl('/auth/login')).toBe('https://codex-ui.todo-tg-app.ru/auth/login')
  })

  it('routes native iOS API fetches through CapacitorHttp with JSON accept headers', async () => {
    installWindow({
      platform: 'ios',
      native: true,
      storedBackendUrl: 'https://codex-ui.todo-tg-app.ru',
    })
    capacitorMock.request.mockResolvedValueOnce({
      status: 202,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      data: {
        data: {
          id: 'job-1',
          state: 'queued',
        },
      },
      url: 'https://codex-ui.todo-tg-app.ru/codex-api/voice/jobs',
    })

    installBackendRequestRouting()

    const response = await window.fetch('/codex-api/voice/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: 'thread-1' }),
    })

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({
      data: {
        id: 'job-1',
        state: 'queued',
      },
    })
    expect(capacitorMock.request).toHaveBeenCalledTimes(1)
    expect(capitorRequest()).toMatchObject({
      url: 'https://codex-ui.todo-tg-app.ru/codex-api/voice/jobs',
      method: 'POST',
      responseType: 'text',
      headers: expect.objectContaining({
        accept: 'application/json, text/plain;q=0.9, */*;q=0.1',
        'content-type': 'application/json',
        origin: 'capacitor://localhost',
      }),
    })
  })

  it('requests audio-compatible native response types for iOS voice audio endpoints', async () => {
    installWindow({
      platform: 'ios',
      native: true,
      storedBackendUrl: 'https://codex-ui.todo-tg-app.ru',
    })
    capacitorMock.request.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'audio/mpeg' },
      data: btoa('audio'),
      url: 'https://codex-ui.todo-tg-app.ru/codex-api/voice/speech',
    })

    installBackendRequestRouting()

    const response = await window.fetch('/codex-api/voice/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    })

    expect(response.status).toBe(200)
    await expect(response.blob()).resolves.toMatchObject({ type: 'audio/mpeg' })
    expect(capitorRequest()).toMatchObject({
      url: 'https://codex-ui.todo-tg-app.ru/codex-api/voice/speech',
      responseType: 'blob',
      headers: expect.objectContaining({
        accept: 'audio/*, application/json;q=0.9, */*;q=0.1',
      }),
    })
  })
})

function capitorRequest(): Record<string, unknown> {
  const request = capacitorMock.request.mock.calls.at(-1)?.[0]
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('Expected CapacitorHttp request')
  }
  return request as Record<string, unknown>
}
