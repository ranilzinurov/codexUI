import { createServer as createNodeServer, type Server } from 'node:http'
import { request as httpRequest } from 'node:http'
import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import { createAuthSession } from './authMiddleware'
import { createServer as createCodexWebServer, type ServerInstance } from './httpServer'
import { createMobileShellCorsMiddleware } from './mobileShellCors'

const runningServers: Array<{ server: Server; instance: ServerInstance }> = []

async function listenCodexWebServer(options: Parameters<typeof createCodexWebServer>[0] = {}): Promise<string> {
  const instance = createCodexWebServer(options)
  const server = createNodeServer(instance.app)
  runningServers.push({ server, instance })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address')
  return `http://127.0.0.1:${address.port}`
}

async function listenAuthOnlyServer(): Promise<string> {
  const authSession = createAuthSession('secret')
  const app = express()
  app.use(createMobileShellCorsMiddleware())
  app.use(authSession.middleware)
  app.use((_req, res) => {
    res.status(503).send('fallback')
  })
  const server = createNodeServer(app)
  runningServers.push({
    server,
    instance: {
      app,
      dispose: () => undefined,
      attachWebSocket: () => undefined,
    },
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address')
  return `http://127.0.0.1:${address.port}`
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
}

async function requestRaw(
  baseUrl: string,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string }> {
  const url = new URL(path, baseUrl)
  return await new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: options.method ?? 'GET',
      headers: options.headers,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          text: Buffer.concat(chunks).toString('utf8'),
        })
      })
    })
    req.on('error', reject)
    if (options.body) req.write(options.body)
    req.end()
  })
}

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(', ') : value ?? ''
}

afterEach(async () => {
  const servers = runningServers.splice(0)
  await Promise.all(servers.map(async ({ server, instance }) => {
    await closeServer(server)
    instance.dispose()
  }))
})

describe('mobile shell HTTP contracts', () => {
  it('returns JSON instead of SPA HTML for unknown codex API routes', async () => {
    const baseUrl = await listenCodexWebServer()

    const response = await fetch(`${baseUrl}/codex-api/voice/jobs/`, {
      headers: { Accept: 'application/json' },
    })
    const text = await response.text()

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(text.toLowerCase()).not.toContain('<!doctype html')
    expect(JSON.parse(text)).toMatchObject({
      error: expect.stringMatching(/not found/i),
    })
  })

  it('allows native Capacitor preflight requests for remote backend login', async () => {
    const baseUrl = await listenAuthOnlyServer()

    const response = await requestRaw(baseUrl, '/auth/login', {
      method: 'OPTIONS',
      headers: {
        Host: 'codex-ui.todo-tg-app.ru',
        Origin: 'capacitor://localhost',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
      },
    })

    expect(response.status).toBe(204)
    expect(headerValue(response.headers['access-control-allow-origin'])).toBe('capacitor://localhost')
    expect(headerValue(response.headers['access-control-allow-credentials'])).toBe('true')
    expect(headerValue(response.headers['access-control-allow-methods'])).toContain('POST')
  })

  it('sets a cross-site secure session cookie for native HTTPS remote login', async () => {
    const baseUrl = await listenAuthOnlyServer()

    const response = await requestRaw(baseUrl, '/auth/login', {
      method: 'POST',
      headers: {
        Host: 'codex-ui.todo-tg-app.ru',
        'Content-Type': 'application/json',
        Origin: 'capacitor://localhost',
        'X-Forwarded-Proto': 'https',
      },
      body: JSON.stringify({ password: 'secret' }),
    })

    expect(response.status).toBe(200)
    const setCookie = headerValue(response.headers['set-cookie'])
    expect(setCookie).toContain('portal_session=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=None')
    expect(setCookie).toContain('Secure')
  })

  it('keeps same-origin browser login cookies strict', async () => {
    const baseUrl = await listenAuthOnlyServer()

    const response = await requestRaw(baseUrl, '/auth/login', {
      method: 'POST',
      headers: {
        Host: 'codex-ui.todo-tg-app.ru',
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https',
      },
      body: JSON.stringify({ password: 'secret' }),
    })

    expect(response.status).toBe(200)
    const setCookie = headerValue(response.headers['set-cookie'])
    expect(setCookie).toContain('portal_session=')
    expect(setCookie).toContain('SameSite=Strict')
    expect(setCookie).toContain('Secure')
  })
})
