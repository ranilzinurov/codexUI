import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodexApiError } from './codexErrors'
import { rpcCall } from './codexRpcClient'

const cloudflareHtml = `<!DOCTYPE html>
<html>
  <head><title>Attention Required! | Cloudflare</title></head>
  <body>
    <h1>Checking your browser before accessing example.test.</h1>
    <div>Cloudflare Ray ID: abc123</div>
  </body>
</html>`

describe('rpcCall error sanitization', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not expose raw HTML bodies from non-JSON HTTP failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(cloudflareHtml, {
      status: 403,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    })))

    let caught: unknown
    try {
      await rpcCall('turn/start', { threadId: 'thread-1' })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(CodexApiError)
    const error = caught as CodexApiError
    expect(error.message).toBe('RPC turn/start failed with HTTP 403: received an upstream security challenge instead of JSON.')
    expect(error.message).not.toContain('<html>')
    expect(error.message).not.toContain('Cloudflare Ray ID')
    expect(error.code).toBe('http_error')
    expect(error.method).toBe('turn/start')
    expect(error.status).toBe(403)
  })

  it('sanitizes JSON error envelopes that contain HTML challenge text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: {
        message: cloudflareHtml,
      },
    }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
      },
    })))

    let caught: unknown
    try {
      await rpcCall('turn/start', { threadId: 'thread-1' })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(CodexApiError)
    const error = caught as CodexApiError
    expect(error.message).toBe('RPC turn/start failed with HTTP 502: received an upstream security challenge instead of JSON.')
    expect(error.code).toBe('http_error')
    expect(error.method).toBe('turn/start')
    expect(error.status).toBe(502)
  })
})
