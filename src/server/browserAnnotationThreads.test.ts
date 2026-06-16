import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { BrowserAnnotationBindingStore } from './browserAnnotationBinding'
import { handleBrowserAnnotationThreadRoutes, type BrowserAnnotationThreadGroup } from './browserAnnotationThreads'

type JsonResponse = {
  status: number
  body: Record<string, unknown>
}

const servers: Server[] = []

async function listenWithThreads(input: {
  bindingStore: BrowserAnnotationBindingStore
  groups: BrowserAnnotationThreadGroup[]
}): Promise<{ baseUrl: string }> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (await handleBrowserAnnotationThreadRoutes(req, res, url, {
      bindingStore: input.bindingStore,
      listThreadGroups: async () => input.groups,
    })) return
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
      ...(init.headers ?? {}),
    },
  })
  const body = await response.json() as Record<string, unknown>
  return { status: response.status, body }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve())
  })))
})

describe('browser annotation thread target endpoint', () => {
  it('lists project/thread targets for a valid browser binding token', async () => {
    const bindingStore = new BrowserAnnotationBindingStore({
      nowMs: () => Date.UTC(2026, 0, 1),
      pairingTtlMs: 60_000,
    })
    const groups: BrowserAnnotationThreadGroup[] = [
      {
        projectName: 'codexUI',
        cwd: '/home/rnl1/prog/codexUI',
        threads: [
          {
            id: 'thread-annotation',
            title: 'Ресерч browser remote extension',
            preview: 'ок, законнектился',
            updatedAtIso: '2026-06-16T14:30:00.000Z',
            cwd: '/home/rnl1/prog/codexUI',
          },
        ],
      },
      {
        projectName: 'TestChat',
        cwd: '/tmp/TestChat',
        threads: [],
      },
    ]
    const { baseUrl } = await listenWithThreads({ bindingStore, groups })
    const pairing = bindingStore.start({ serverUrl: baseUrl })
    const binding = bindingStore.complete(pairing.pairingCode ?? '')
    expect(binding?.bindingToken).toEqual(expect.any(String))

    const rejected = await requestJson(baseUrl, '/codex-api/extension/threads')
    expect(rejected.status).toBe(401)
    expect(rejected.body.error).toBe('Missing browser binding bearer token')

    const response = await requestJson(baseUrl, '/codex-api/extension/threads', {
      headers: { Authorization: `Bearer ${binding?.bindingToken}` },
    })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      ok: true,
      groups,
    })
  })
})
