import { afterEach, describe, expect, it, vi } from 'vitest'
import * as codexGateway from './codexGateway'
import {
  getBrowserAnnotationListenStatus,
  listDirectoryApps,
  listDirectoryComposioConnectors,
  startBrowserAnnotationListenSession,
  startThreadTurn,
  stopBrowserAnnotationListenSession,
} from './codexGateway'

type RpcRequest = { method: string, params: Record<string, unknown> }

type MockRpcResponse = {
  result?: unknown
  status?: number
  error?: unknown
}

type SideThreadGatewayContract = typeof codexGateway & {
  forkSideThread(threadId: string): Promise<{ threadId: string, cwd: string, model: string }>
  startSideThread(threadId: string, options?: { initialPrompt?: string }): Promise<{ threadId: string, cwd: string, model: string }>
  startSideThreadTurn?: typeof startThreadTurn
}

const sideThreadGateway = codexGateway as SideThreadGatewayContract

function mockRpcFetch(): { requests: Array<{ method: string, params: Record<string, unknown> }> } {
  const requests: Array<{ method: string, params: Record<string, unknown> }> = []

  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === 'string'
      ? JSON.parse(init.body) as { method: string, params: Record<string, unknown> }
      : { method: '', params: {} }

    requests.push(body)

    return new Response(JSON.stringify({
      result: {
        turn: {
          id: `turn-${requests.length}`,
        },
      },
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  }))

  return { requests }
}

function mockRpcFetchWith(handler: (request: RpcRequest, index: number) => MockRpcResponse): { requests: RpcRequest[] } {
  const requests: RpcRequest[] = []

  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === 'string'
      ? JSON.parse(init.body) as RpcRequest
      : { method: '', params: {} }
    requests.push(body)

    const response = handler(body, requests.length - 1)
    const status = response.status ?? 200
    const payload = status >= 400
      ? { error: response.error ?? { message: 'RPC request failed' } }
      : { result: response.result ?? {} }

    return new Response(JSON.stringify(payload), {
      status,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  }))

  return { requests }
}

describe('side thread gateway API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forks a side thread with ephemeral extended-history RPC flags', async () => {
    const { requests } = mockRpcFetchWith(() => ({
      result: {
        thread: {
          id: 'side-thread-1',
          cwd: '/workspace/project',
        },
        model: 'gpt-5.4',
      },
    }))

    await sideThreadGateway.forkSideThread('thread-parent')

    expect(requests).toEqual([
      {
        method: 'thread/fork',
        params: {
          threadId: 'thread-parent',
          ephemeral: true,
          persistExtendedHistory: true,
        },
      },
    ])
  })

  it('starts a side thread and returns the side thread id plus model and cwd when present', async () => {
    const { requests } = mockRpcFetchWith(() => ({
      result: {
        thread: {
          id: 'side-thread-2',
          cwd: '/workspace/project',
        },
        model: 'gpt-5.4',
      },
    }))

    const sideThread = await sideThreadGateway.startSideThread('thread-parent')

    expect(requests[0]).toEqual({
      method: 'thread/fork',
      params: {
        threadId: 'thread-parent',
        ephemeral: true,
        persistExtendedHistory: true,
      },
    })
    expect(sideThread).toEqual({
      threadId: 'side-thread-2',
      cwd: '/workspace/project',
      model: 'gpt-5.4',
    })
  })

  it('does not fall back to turn/start when ephemeral side-thread forks are unsupported', async () => {
    const { requests } = mockRpcFetchWith(() => ({
      status: 400,
      error: {
        message: 'ephemeral threads are not supported by this app-server',
      },
    }))

    let error: unknown
    try {
      await sideThreadGateway.startSideThread('thread-parent', { initialPrompt: 'open a side chat' })
    } catch (caught) {
      error = caught
    }

    expect(requests.map((request) => request.method)).toEqual(['thread/fork'])
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({
      name: 'CodexApiError',
      code: 'http_error',
      method: 'thread/fork',
      status: 400,
    })
    expect((error as Error).message).toBe('RPC thread/fork failed with HTTP 400: ephemeral threads are not supported by this app-server')
  })

  it('starts turns against the side thread id', async () => {
    const { requests } = mockRpcFetchWith(() => ({
      result: {
        turn: {
          id: 'turn-side-1',
        },
      },
    }))
    const startSideTurn = sideThreadGateway.startSideThreadTurn ?? startThreadTurn

    const turnId = await startSideTurn('side-thread-3', 'continue here', [], 'gpt-5.4', 'medium')

    expect(turnId).toBe('turn-side-1')
    expect(requests[0].method).toBe('turn/start')
    expect(requests[0].params.threadId).toBe('side-thread-3')
  })
})

describe('startThreadTurn collaboration mode payloads', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends default collaboration mode explicitly after a plan turn', async () => {
    const { requests } = mockRpcFetch()

    await startThreadTurn('thread-1', 'make a plan', [], 'gpt-5.4', 'medium', undefined, [], 'plan')
    await startThreadTurn('thread-1', 'implement it', [], 'gpt-5.4', 'medium', undefined, [], 'default')

    expect(requests).toHaveLength(2)
    expect(requests[0].method).toBe('turn/start')
    expect(requests[0].params.collaborationMode).toEqual({
      mode: 'plan',
      settings: {
        model: 'gpt-5.4',
        reasoning_effort: 'medium',
        developer_instructions: null,
      },
    })
    expect(requests[1].method).toBe('turn/start')
    expect(requests[1].params.collaborationMode).toEqual({
      mode: 'default',
      settings: {
        model: 'gpt-5.4',
        reasoning_effort: 'medium',
        developer_instructions: null,
      },
    })
  })
})

describe('listDirectoryComposioConnectors', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends search queries as query params expected by the server', async () => {
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input))
      return new Response(JSON.stringify({
        data: [],
        nextCursor: null,
        total: 0,
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    }))

    await listDirectoryComposioConnectors('instagram', '50', 25)

    expect(requests).toEqual(['/codex-api/composio/connectors?query=instagram&cursor=50&limit=25'])
  })
})

describe('browser annotation listen helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts a listener session for the selected thread', async () => {
    const requests: Array<{ input: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input: String(input), init })
      return new Response(JSON.stringify({
        ok: true,
        session: {
          sessionId: 'session-1',
          threadId: 'thread-1',
          serverUrl: 'http://127.0.0.1:4173',
          serverPath: '/codex-api/extension/listen',
          expiresAtIso: '2026-05-28T12:10:00.000Z',
          createdAtIso: '2026-05-28T12:00:00.000Z',
          status: 'active',
          pairingToken: 'token-1',
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    const session = await startBrowserAnnotationListenSession('thread-1')

    expect(session.pairingToken).toBe('token-1')
    expect(requests).toHaveLength(1)
    expect(requests[0].input).toBe('/codex-api/extension/listen/start')
    expect(requests[0].init?.method).toBe('POST')
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({ threadId: 'thread-1' })
  })

  it('sends bearer token and selector for status and stop requests', async () => {
    const requests: Array<{ input: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input: String(input), init })
      return new Response(JSON.stringify({
        ok: true,
        session: {
          sessionId: 'session-1',
          threadId: 'thread-1',
          serverUrl: null,
          serverPath: '/codex-api/extension/listen',
          expiresAtIso: '2026-05-28T12:10:00.000Z',
          createdAtIso: '2026-05-28T12:00:00.000Z',
          status: 'active',
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    await getBrowserAnnotationListenStatus('token-1', { sessionId: 'session-1', threadId: 'thread-1' })
    await stopBrowserAnnotationListenSession('token-1', { sessionId: 'session-1', threadId: 'thread-1' })

    expect(requests[0].input).toBe('/codex-api/extension/listen/status?sessionId=session-1&threadId=thread-1')
    expect((requests[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer token-1')
    expect(requests[1].input).toBe('/codex-api/extension/listen/stop')
    expect(requests[1].init?.method).toBe('POST')
    expect((requests[1].init?.headers as Record<string, string>).Authorization).toBe('Bearer token-1')
    expect(JSON.parse(String(requests[1].init?.body))).toEqual({ sessionId: 'session-1', threadId: 'thread-1' })
  })
})

describe('listDirectoryApps', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('normalizes normal app rows and follows pagination', async () => {
    const requests: Array<{ method: string, params: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === 'string'
        ? JSON.parse(init.body) as { method: string, params: Record<string, unknown> }
        : { method: '', params: {} }
      requests.push(body)

      const result = requests.length === 1
        ? {
            data: [
              {
                id: 'gmail',
                name: 'Gmail',
                description: 'Email from Google',
                logoUrl: 'https://example.test/gmail.png',
                logoUrlDark: 'https://example.test/gmail-dark.png',
                distributionChannel: 'chatgpt',
                installUrl: 'https://chatgpt.test/gmail',
                isAccessible: true,
                isEnabled: false,
                pluginDisplayNames: ['Mail Helper'],
                branding: {
                  category: 'Productivity',
                  developer: 'Google',
                  website: 'https://gmail.test',
                  privacyPolicy: 'https://gmail.test/privacy',
                  termsOfService: 'https://gmail.test/terms',
                },
              },
            ],
            nextCursor: 'page-2',
          }
        : {
            data: [
              {
                id: 'calendar',
                name: 'Calendar',
                app_metadata: {
                  seo_description: 'Plan events',
                  developer: 'Google',
                },
                logo_url: 'https://example.test/calendar.png',
                logo_url_dark: 'https://example.test/calendar-dark.png',
                distribution_channel: 'chatgpt',
                install_url: 'https://chatgpt.test/calendar',
                is_accessible: false,
                is_enabled: true,
                plugin_display_names: ['Scheduler'],
              },
            ],
            next_cursor: null,
          }

      return new Response(JSON.stringify({ result }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    }))

    const apps = await listDirectoryApps('thread-123')

    expect(requests).toEqual([
      { method: 'app/list', params: { limit: 100, threadId: 'thread-123' } },
      { method: 'app/list', params: { limit: 100, cursor: 'page-2', threadId: 'thread-123' } },
    ])
    expect(apps).toEqual([
      {
        id: 'gmail',
        name: 'Gmail',
        description: 'Email from Google',
        logoUrl: 'https://example.test/gmail.png',
        logoUrlDark: 'https://example.test/gmail-dark.png',
        distributionChannel: 'chatgpt',
        installUrl: 'https://chatgpt.test/gmail',
        isAccessible: true,
        isEnabled: false,
        pluginDisplayNames: ['Mail Helper'],
        category: 'Productivity',
        developer: 'Google',
        website: 'https://gmail.test',
        privacyPolicy: 'https://gmail.test/privacy',
        termsOfService: 'https://gmail.test/terms',
        catalogRank: 0,
      },
      {
        id: 'calendar',
        name: 'Calendar',
        description: 'Plan events',
        logoUrl: 'https://example.test/calendar.png',
        logoUrlDark: 'https://example.test/calendar-dark.png',
        distributionChannel: 'chatgpt',
        installUrl: 'https://chatgpt.test/calendar',
        isAccessible: false,
        isEnabled: true,
        pluginDisplayNames: ['Scheduler'],
        category: '',
        developer: 'Google',
        website: '',
        privacyPolicy: '',
        termsOfService: '',
        catalogRank: 1,
      },
    ])
  })

  it('ignores unknown top-level metadata while normalizing app rows', async () => {
    const requests: Array<{ method: string, params: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === 'string'
        ? JSON.parse(init.body) as { method: string, params: Record<string, unknown> }
        : { method: '', params: {} }
      requests.push(body)

      return new Response(JSON.stringify({
        result: {
          data: [
            {
              id: 'slack',
              name: 'Slack',
              appMetadata: {
                seoDescription: 'Team chat',
                developer: 'Slack Technologies',
              },
              isAccessible: true,
              isEnabled: true,
            },
          ],
          nextCursor: null,
          fallback: {
            reason: 'app-list-failed',
            source: 'cached-snapshot',
          },
          cache: {
            key: 'apps-directory',
            hit: true,
          },
          snapshot: {
            cachedAtIso: '2026-05-28T00:00:00.000Z',
            stale: true,
          },
        },
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    }))

    const apps = await listDirectoryApps()

    expect(requests).toEqual([
      { method: 'app/list', params: { limit: 100 } },
    ])
    expect(apps).toEqual([
      {
        id: 'slack',
        name: 'Slack',
        description: 'Team chat',
        logoUrl: '',
        logoUrlDark: '',
        distributionChannel: '',
        installUrl: '',
        isAccessible: true,
        isEnabled: true,
        pluginDisplayNames: [],
        category: '',
        developer: 'Slack Technologies',
        website: '',
        privacyPolicy: '',
        termsOfService: '',
        catalogRank: 0,
      },
    ])
  })

  it('propagates final app list HTTP rejections when no server fallback is available', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response(JSON.stringify({
        error: {
          message: 'cached snapshot unavailable',
        },
      }), {
        status: 503,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    }))

    let error: unknown
    try {
      await listDirectoryApps()
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({
      name: 'CodexApiError',
      code: 'http_error',
      method: 'app/list',
      status: 503,
    })
    expect((error as Error).message).toBe('RPC app/list failed with HTTP 503: cached snapshot unavailable')
  })
})
