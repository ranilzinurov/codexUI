import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BrowserAnnotationListenStore,
  handleBrowserAnnotationListenRoutes,
  type BrowserAnnotationListenSessionResponse,
} from './browserAnnotationListen'
import {
  BROWSER_ANNOTATION_TRANSCRIBE_PATH,
  handleBrowserAnnotationTranscribeRoute,
} from './browserAnnotationTranscribe'
import type { AnnotationTranscriptionConfig } from './annotationTranscriptionConfig'

const webmBytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01])
const testConfig: AnnotationTranscriptionConfig = {
  openAiApiKey: 'sk-test-browser-annotation',
  model: 'gpt-4o-mini-transcribe',
  fallbackModel: 'gpt-4o-transcribe',
}

type JsonResponse = {
  status: number
  body: Record<string, unknown>
}

const servers: Server[] = []

async function listenWithStore(
  store: BrowserAnnotationListenStore,
  options: {
    config?: AnnotationTranscriptionConfig
    fetch?: typeof fetch
    maxBytes?: number
  } = {},
): Promise<{ baseUrl: string }> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (await handleBrowserAnnotationListenRoutes(req, res, url, { store })) return
    if (await handleBrowserAnnotationTranscribeRoute(req, res, url, {
      store,
      config: options.config ?? testConfig,
      fetch: options.fetch,
      maxBytes: options.maxBytes,
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
      ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })
  const body = await response.json() as Record<string, unknown>
  return { status: response.status, body }
}

async function startSession(baseUrl: string, threadId = 'thread-transcribe'): Promise<BrowserAnnotationListenSessionResponse> {
  const start = await requestJson(baseUrl, '/codex-api/extension/listen/start', {
    method: 'POST',
    body: JSON.stringify({ threadId }),
  })
  const session = start.body.session
  if (!session || typeof session !== 'object' || Array.isArray(session)) {
    throw new Error('Expected session response')
  }
  return session as BrowserAnnotationListenSessionResponse
}

async function transcribeAudio(
  baseUrl: string,
  session: BrowserAnnotationListenSessionResponse,
  input: { mimeType?: string; bytes?: Buffer; token?: string; includeSelector?: boolean } = {},
): Promise<JsonResponse> {
  const form = new FormData()
  form.append('language', 'en')
  form.append('file', new Blob([new Uint8Array(input.bytes ?? webmBytes)], {
    type: input.mimeType ?? 'audio/webm',
  }), 'voice.webm')
  const path = input.includeSelector === false
    ? BROWSER_ANNOTATION_TRANSCRIBE_PATH
    : `${BROWSER_ANNOTATION_TRANSCRIBE_PATH}?sessionId=${encodeURIComponent(session.sessionId)}&threadId=${encodeURIComponent(session.threadId)}`
  return requestJson(baseUrl, path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${input.token ?? session.pairingToken}` },
    body: form,
  })
}

function createOpenAiJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createFetchMock(responses: Response[]): typeof fetch {
  const mock = vi.fn(async () => {
    const response = responses.shift()
    if (!response) throw new Error('Unexpected fetch call')
    return response
  })
  return mock as unknown as typeof fetch
}

function callsFor(fetchImpl: typeof fetch): Array<[string, RequestInit]> {
  return vi.mocked(fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls as Array<[string, RequestInit]>
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve())
  })))
  vi.restoreAllMocks()
})

describe('browser annotation transcription endpoint', () => {
  it('transcribes audio with the configured OpenAI model for an authorized listen session', async () => {
    const fetchImpl = createFetchMock([
      createOpenAiJsonResponse({ text: 'hello from the browser', language: 'en', duration: 1.2, usage: { input_tokens: 10 } }),
    ])
    const store = new BrowserAnnotationListenStore({ nowMs: () => Date.UTC(2026, 0, 1), ttlMs: 60_000 })
    const { baseUrl } = await listenWithStore(store, { fetch: fetchImpl })
    const session = await startSession(baseUrl)

    const response = await transcribeAudio(baseUrl, session)

    expect(response.status).toBe(200)
    expect(response.body.ok).toBe(true)
    expect(response.body.text).toBe('hello from the browser')
    expect(response.body.model).toBe('gpt-4o-mini-transcribe')
    expect(response.body.session).toEqual({ sessionId: session.sessionId, threadId: session.threadId })
    const calls = callsFor(fetchImpl)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.[0]).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(calls[0]?.[1].headers).toEqual({ Authorization: 'Bearer sk-test-browser-annotation' })
    const form = calls[0]?.[1].body as FormData
    expect(form.get('model')).toBe('gpt-4o-mini-transcribe')
    expect(form.get('language')).toBe('en')
    expect(form.get('file')).toBeInstanceOf(Blob)
  })

  it('accepts a persistent extension token for transcription after the pairing token expires', async () => {
    let now = Date.UTC(2026, 0, 1)
    const fetchImpl = createFetchMock([
      createOpenAiJsonResponse({ text: 'persistent token transcript', language: 'ru' }),
    ])
    const store = new BrowserAnnotationListenStore({
      nowMs: () => now,
      ttlMs: 100,
      extensionTokenTtlMs: 10_000,
    })
    const { baseUrl } = await listenWithStore(store, { fetch: fetchImpl })
    const session = await startSession(baseUrl)
    const bound = await requestJson(baseUrl, '/codex-api/extension/listen/bind', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.pairingToken}` },
      body: JSON.stringify({ sessionId: session.sessionId }),
    })
    const boundSession = bound.body.session as BrowserAnnotationListenSessionResponse
    now += 101

    const response = await transcribeAudio(baseUrl, boundSession, { token: boundSession.extensionToken })

    expect(bound.status).toBe(200)
    expect(boundSession.tokenType).toBe('extension')
    expect(response.status).toBe(200)
    expect(response.body.text).toBe('persistent token transcript')
    expect(response.body.language).toBe('ru')
    expect(callsFor(fetchImpl)).toHaveLength(1)
  })

  it('falls back to the configured fallback model after a retryable provider failure', async () => {
    const fetchImpl = createFetchMock([
      createOpenAiJsonResponse({ error: { message: 'temporary provider failure' } }, 500),
      createOpenAiJsonResponse({ text: 'fallback transcript' }),
    ])
    const store = new BrowserAnnotationListenStore({ nowMs: () => Date.UTC(2026, 0, 1), ttlMs: 60_000 })
    const { baseUrl } = await listenWithStore(store, { fetch: fetchImpl })
    const session = await startSession(baseUrl)

    const response = await transcribeAudio(baseUrl, session)

    expect(response.status).toBe(200)
    expect(response.body.text).toBe('fallback transcript')
    expect(response.body.model).toBe('gpt-4o-transcribe')
    const calls = callsFor(fetchImpl)
    expect(calls).toHaveLength(2)
    expect((calls[0]?.[1].body as FormData).get('model')).toBe('gpt-4o-mini-transcribe')
    expect((calls[1]?.[1].body as FormData).get('model')).toBe('gpt-4o-transcribe')
  })

  it('sanitizes provider and network errors before returning them to the extension', async () => {
    const providerFetch = createFetchMock([
      createOpenAiJsonResponse({ error: { message: 'bad key sk-test-browser-annotation for org secret-org' } }, 400),
    ])
    const store = new BrowserAnnotationListenStore({ nowMs: () => Date.UTC(2026, 0, 1), ttlMs: 60_000 })
    const { baseUrl } = await listenWithStore(store, { fetch: providerFetch })
    const session = await startSession(baseUrl)

    const providerError = await transcribeAudio(baseUrl, session)

    expect(providerError.status).toBe(400)
    expect(providerError.body.error).toBe('OpenAI transcription rejected the request. Check server transcription configuration.')
    expect(JSON.stringify(providerError.body)).not.toContain('sk-test-browser-annotation')
    expect(JSON.stringify(providerError.body)).not.toContain('secret-org')

    const networkFetch = vi.fn(async () => {
      throw new Error('network leaked sk-test-browser-annotation')
    }) as unknown as typeof fetch
    const { baseUrl: networkBaseUrl } = await listenWithStore(store, { fetch: networkFetch })
    const networkSession = await startSession(networkBaseUrl, 'thread-network-error')

    const networkError = await transcribeAudio(networkBaseUrl, networkSession)

    expect(networkError.status).toBe(502)
    expect(networkError.body.error).toBe('OpenAI transcription request failed. Please retry.')
    expect(JSON.stringify(networkError.body)).not.toContain('sk-test-browser-annotation')
  })

  it('returns configuration errors without calling OpenAI when key or model is missing', async () => {
    const fetchImpl = createFetchMock([])
    const store = new BrowserAnnotationListenStore({ nowMs: () => Date.UTC(2026, 0, 1), ttlMs: 60_000 })
    const { baseUrl } = await listenWithStore(store, {
      fetch: fetchImpl,
      config: { openAiApiKey: '', model: 'gpt-4o-mini-transcribe', fallbackModel: '' },
    })
    const session = await startSession(baseUrl)

    const missingKey = await transcribeAudio(baseUrl, session)

    expect(missingKey.status).toBe(503)
    expect(String(missingKey.body.error)).toContain('OPENAI_API_KEY')
    expect(JSON.stringify(missingKey.body)).not.toContain('sk-')
    expect(callsFor(fetchImpl)).toHaveLength(0)

    const { baseUrl: modelBaseUrl } = await listenWithStore(store, {
      fetch: fetchImpl,
      config: { openAiApiKey: 'sk-test-browser-annotation', model: '', fallbackModel: '' },
    })
    const missingModel = await transcribeAudio(modelBaseUrl, session)

    expect(missingModel.status).toBe(503)
    expect(String(missingModel.body.error)).toContain('CODEXUI_ANNOTATION_TRANSCRIBE_MODEL')
    expect(JSON.stringify(missingModel.body)).not.toContain('sk-test-browser-annotation')
    expect(callsFor(fetchImpl)).toHaveLength(0)
  })

  it('rejects missing, invalid, and revoked extension authorization before transcription', async () => {
    const fetchImpl = createFetchMock([])
    const store = new BrowserAnnotationListenStore({ nowMs: () => Date.UTC(2026, 0, 1), ttlMs: 60_000 })
    const { baseUrl } = await listenWithStore(store, { fetch: fetchImpl })
    const session = await startSession(baseUrl)
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(webmBytes)], { type: 'audio/webm' }), 'voice.webm')

    const missingToken = await requestJson(baseUrl, `${BROWSER_ANNOTATION_TRANSCRIBE_PATH}?sessionId=${encodeURIComponent(session.sessionId)}`, {
      method: 'POST',
      body: form,
    })
    const wrongToken = await transcribeAudio(baseUrl, session, { token: 'wrong-token' })
    await requestJson(baseUrl, '/codex-api/extension/listen/stop', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.pairingToken}` },
      body: JSON.stringify({ sessionId: session.sessionId }),
    })
    const revoked = await transcribeAudio(baseUrl, session)

    expect(missingToken.status).toBe(401)
    expect(missingToken.body.error).toBe('Missing extension bearer token')
    expect(wrongToken.status).toBe(401)
    expect(wrongToken.body.error).toBe('Invalid or expired extension bearer token')
    expect(revoked.status).toBe(401)
    expect(revoked.body.error).toBe('Invalid or expired extension bearer token')
    expect(callsFor(fetchImpl)).toHaveLength(0)
  })

  it('rejects requests without a session selector before reading multipart fields', async () => {
    const fetchImpl = createFetchMock([])
    const store = new BrowserAnnotationListenStore({ nowMs: () => Date.UTC(2026, 0, 1), ttlMs: 60_000 })
    const { baseUrl } = await listenWithStore(store, { fetch: fetchImpl })
    const session = await startSession(baseUrl)

    const response = await transcribeAudio(baseUrl, session, { includeSelector: false })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('Missing sessionId')
    expect(callsFor(fetchImpl)).toHaveLength(0)
  })

  it('rejects invalid mime types and oversized uploads without calling OpenAI', async () => {
    const fetchImpl = createFetchMock([])
    const store = new BrowserAnnotationListenStore({ nowMs: () => Date.UTC(2026, 0, 1), ttlMs: 60_000 })
    const { baseUrl } = await listenWithStore(store, { fetch: fetchImpl })
    const session = await startSession(baseUrl)

    const invalidMime = await transcribeAudio(baseUrl, session, {
      mimeType: 'text/plain',
      bytes: Buffer.from('not audio'),
    })
    const { baseUrl: cappedBaseUrl } = await listenWithStore(store, { fetch: fetchImpl, maxBytes: 64 })
    const oversized = await transcribeAudio(cappedBaseUrl, session, {
      mimeType: 'audio/webm',
      bytes: Buffer.alloc(128, 1),
    })

    expect(invalidMime.status).toBe(415)
    expect(invalidMime.body.error).toBe('Unsupported audio type for transcription')
    expect(oversized.status).toBe(413)
    expect(oversized.body.error).toBe('Browser annotation audio upload is too large')
    expect(callsFor(fetchImpl)).toHaveLength(0)
  })

  it('rejects malformed multipart and expired sessions before calling OpenAI', async () => {
    let now = Date.UTC(2026, 0, 1)
    const fetchImpl = createFetchMock([])
    const store = new BrowserAnnotationListenStore({ nowMs: () => now, ttlMs: 100 })
    const { baseUrl } = await listenWithStore(store, { fetch: fetchImpl })
    const session = await startSession(baseUrl)

    const malformed = await requestJson(baseUrl, `${BROWSER_ANNOTATION_TRANSCRIBE_PATH}?sessionId=${encodeURIComponent(session.sessionId)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.pairingToken}`,
        'Content-Type': 'multipart/form-data; boundary=missing-audio',
      },
      body: '--missing-audio--\r\n',
    })
    now += 101
    const expired = await transcribeAudio(baseUrl, session)

    expect(malformed.status).toBe(400)
    expect(malformed.body.error).toBe('Expected multipart form upload with an audio file field')
    expect(expired.status).toBe(401)
    expect(expired.body.error).toBe('Invalid or expired extension bearer token')
    expect(callsFor(fetchImpl)).toHaveLength(0)
  })
})
