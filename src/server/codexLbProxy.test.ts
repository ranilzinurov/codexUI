import { describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CODEX_LB_PROXY_ROUTE_BASE,
  getCodexLbProxyConfigArgs,
  handleCodexLbProxyRequest,
  parseCodexLbConfigToml,
} from './codexLbProxy'

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address && typeof address === 'object') {
        resolve(address.port)
      } else {
        reject(new Error('test server did not bind to a TCP port'))
      }
    })
  })
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('error', reject)
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>)
      } catch (error) {
        reject(error)
      }
    })
  })
}

async function withTempConfig(contents: string): Promise<{ tempDir: string; configPath: string }> {
  const tempDir = await mkdtemp(join(tmpdir(), 'codexui-codex-lb-'))
  const configPath = join(tempDir, 'config.toml')
  await writeFile(configPath, contents, 'utf8')
  return { tempDir, configPath }
}

describe('codex lb proxy config', () => {
  it('detects an active codex-lb provider from top-level config', () => {
    const parsed = parseCodexLbConfigToml(`
model_provider = "codex-lb"

[model_providers.codex-lb]
base_url = "http://127.0.0.1:2455/backend-api/codex"
wire_api = "responses"
env_key = "CODEX_LB_API_KEY"
`)

    expect(parsed).toEqual({
      activeProviderId: 'codex-lb',
      provider: {
        providerId: 'codex-lb',
        baseUrl: 'http://127.0.0.1:2455/backend-api/codex',
        wireApi: 'responses',
        envKey: 'CODEX_LB_API_KEY',
      },
    })
  })

  it('detects codex-lb selected by an active profile', () => {
    const parsed = parseCodexLbConfigToml(`
profile = "work"

[profiles.work]
model_provider = "codex-lb"

[model_providers.codex-lb]
base_url = "http://127.0.0.1:2455/backend-api/codex"
wire_api = "responses"
`)

    expect(parsed.activeProviderId).toBe('codex-lb')
    expect(parsed.provider?.baseUrl).toBe('http://127.0.0.1:2455/backend-api/codex')
  })

  it('adds a runtime base_url override only when codex-lb proxy is enabled', async () => {
    const previous = process.env.CODEXUI_CODEX_LB_PROXY
    const { tempDir, configPath } = await withTempConfig(`
model_provider = "codex-lb"

[model_providers.codex-lb]
base_url = "http://127.0.0.1:2455/backend-api/codex"
wire_api = "responses"
`)
    process.env.CODEXUI_CODEX_LB_PROXY = '1'

    try {
      const args = getCodexLbProxyConfigArgs({ serverPort: 4173, configPath })

      expect(args).toEqual([
        '-c',
        `model_providers.codex-lb.base_url="http://127.0.0.1:4173${CODEX_LB_PROXY_ROUTE_BASE}"`,
        '-c',
        'model_providers.codex-lb.wire_api="responses"',
        '-c',
        'model_providers.codex-lb.experimental_bearer_token="codex-lb-proxy-token"',
      ])
    } finally {
      if (previous === undefined) {
        delete process.env.CODEXUI_CODEX_LB_PROXY
      } else {
        process.env.CODEXUI_CODEX_LB_PROXY = previous
      }
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('does not enable the codex-lb proxy by default', async () => {
    const previous = process.env.CODEXUI_CODEX_LB_PROXY
    delete process.env.CODEXUI_CODEX_LB_PROXY
    const { tempDir, configPath } = await withTempConfig(`
model_provider = "codex-lb"

[model_providers.codex-lb]
base_url = "http://127.0.0.1:2455/backend-api/codex"
wire_api = "responses"
`)

    try {
      expect(getCodexLbProxyConfigArgs({ serverPort: 4173, configPath })).toEqual([])
    } finally {
      if (previous === undefined) {
        delete process.env.CODEXUI_CODEX_LB_PROXY
      } else {
        process.env.CODEXUI_CODEX_LB_PROXY = previous
      }
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('can be disabled with CODEXUI_CODEX_LB_PROXY=0', async () => {
    const previous = process.env.CODEXUI_CODEX_LB_PROXY
    const { tempDir, configPath } = await withTempConfig(`
model_provider = "codex-lb"

[model_providers.codex-lb]
base_url = "http://127.0.0.1:2455/backend-api/codex"
wire_api = "responses"
`)
    process.env.CODEXUI_CODEX_LB_PROXY = '0'

    try {
      expect(getCodexLbProxyConfigArgs({ serverPort: 4173, configPath })).toEqual([])
    } finally {
      if (previous === undefined) {
        delete process.env.CODEXUI_CODEX_LB_PROXY
      } else {
        process.env.CODEXUI_CODEX_LB_PROXY = previous
      }
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})

describe('codex lb proxy request handling', () => {
  it('does not forward the local proxy bearer token upstream', async () => {
    const previousCodexLbApiKey = process.env.CODEX_LB_API_KEY
    delete process.env.CODEX_LB_API_KEY
    const upstreamRequests: Array<{ body: Record<string, unknown>; authorization: string }> = []
    const upstream = createServer((req, res) => {
      void (async () => {
        upstreamRequests.push({
          body: await readJsonBody(req),
          authorization: Array.isArray(req.headers.authorization)
            ? req.headers.authorization[0] ?? ''
            : req.headers.authorization ?? '',
        })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: 'resp_ok', object: 'response', model: 'gpt-5.5', output: [] }))
      })().catch((error) => {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : 'unknown error' } }))
      })
    })
    const upstreamPort = await listen(upstream)
    const { tempDir, configPath } = await withTempConfig(`
model_provider = "codex-lb"

[model_providers.codex-lb]
base_url = "http://127.0.0.1:${upstreamPort}/backend-api/codex"
wire_api = "responses"
env_key = "CODEX_LB_API_KEY"
`)
    const proxy = createServer((req, res) => {
      handleCodexLbProxyRequest(req, res, { configPath })
    })
    const proxyPort = await listen(proxy)

    try {
      const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/responses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer codex-lb-proxy-token',
        },
        body: JSON.stringify({ model: 'gpt-5.5', input: 'hello' }),
      })

      expect(response.status).toBe(200)
      expect(upstreamRequests).toHaveLength(1)
      expect(upstreamRequests[0]?.authorization).toBe('')
      expect(upstreamRequests[0]?.body).toMatchObject({ model: 'gpt-5.5', input: 'hello' })
    } finally {
      if (previousCodexLbApiKey === undefined) {
        delete process.env.CODEX_LB_API_KEY
      } else {
        process.env.CODEX_LB_API_KEY = previousCodexLbApiKey
      }
      await close(proxy)
      await rm(tempDir, { recursive: true, force: true })
      await close(upstream)
    }
  })

  it('forwards bearer auth and retries previous_response_not_found without previous_response_id', async () => {
    const upstreamRequests: Array<{ body: Record<string, unknown>; authorization: string }> = []
    const previousLogPath = process.env.CODEXUI_PREVIOUS_RESPONSE_ERROR_LOG
    const diagnosticDir = await mkdtemp(join(tmpdir(), 'codexui-codex-lb-diag-'))
    process.env.CODEXUI_PREVIOUS_RESPONSE_ERROR_LOG = join(diagnosticDir, 'diagnostics.jsonl')
    const upstreamSuccess = {
      id: 'resp_recovered',
      object: 'response',
      model: 'gpt-5.5',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }],
    }
    const upstream = createServer((req, res) => {
      void (async () => {
        upstreamRequests.push({
          body: await readJsonBody(req),
          authorization: Array.isArray(req.headers.authorization)
            ? req.headers.authorization[0] ?? ''
            : req.headers.authorization ?? '',
        })
        if (upstreamRequests.length === 1) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            error: {
              message: JSON.stringify({
                type: 'error',
                error: {
                  type: 'invalid_request_error',
                  code: 'previous_response_not_found',
                  message: "Previous response with id 'resp_missing' not found.",
                  param: 'previous_response_id',
                },
                status: 400,
              }),
            },
          }))
          return
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(upstreamSuccess))
      })().catch((error) => {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : 'unknown error' } }))
      })
    })
    const upstreamPort = await listen(upstream)
    const { tempDir, configPath } = await withTempConfig(`
model_provider = "codex-lb"

[model_providers.codex-lb]
base_url = "http://127.0.0.1:${upstreamPort}/backend-api/codex"
wire_api = "responses"
env_key = "CODEX_LB_API_KEY"
`)
    const proxy = createServer((req, res) => {
      handleCodexLbProxyRequest(req, res, { configPath })
    })
    const proxyPort = await listen(proxy)

    try {
      const input = [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'continue' }] }]
      const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/responses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer local-lb-token',
        },
        body: JSON.stringify({
          model: 'gpt-5.5',
          previous_response_id: 'resp_missing',
          input,
        }),
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual(upstreamSuccess)
      expect(upstreamRequests).toHaveLength(2)
      expect(upstreamRequests[0]?.authorization).toBe('Bearer local-lb-token')
      expect(upstreamRequests[1]?.authorization).toBe('Bearer local-lb-token')
      expect(upstreamRequests[0]?.body).toMatchObject({ previous_response_id: 'resp_missing', input })
      expect(upstreamRequests[1]?.body).toMatchObject({ input })
      expect(upstreamRequests[1]?.body).not.toHaveProperty('previous_response_id')
    } finally {
      if (previousLogPath === undefined) {
        delete process.env.CODEXUI_PREVIOUS_RESPONSE_ERROR_LOG
      } else {
        process.env.CODEXUI_PREVIOUS_RESPONSE_ERROR_LOG = previousLogPath
      }
      await close(proxy)
      await rm(diagnosticDir, { recursive: true, force: true })
      await rm(tempDir, { recursive: true, force: true })
      await close(upstream)
    }
  })
})
