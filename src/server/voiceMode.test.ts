import { createServer, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  VOICE_MODE_JOBS_PATH,
  VOICE_MODE_SPEECH_PATH,
  VoiceJobStore,
  extractLatestAssistantText,
  handleVoiceModeRoutes,
  summarizeVoiceTextLocally,
} from './voiceMode'

type JsonResponse = {
  status: number
  body: Record<string, unknown>
}

type TestAppServer = {
  rpc: (method: string, params: unknown) => Promise<unknown>
}

const servers: Server[] = []

function makeAppServer(responses: unknown[] = []): TestAppServer {
  return {
    rpc: vi.fn(async (_method: string, _params: unknown): Promise<unknown> => {
      const response = responses.shift()
      if (response instanceof Error) throw response
      return response ?? completedThread('thread-voice', 'Готово: тестовый ответ.')
    }),
  }
}

async function listenVoiceServer(options: {
  appServer?: TestAppServer
  fetch?: typeof fetch
  jobStore?: VoiceJobStore
  pollIntervalMs?: number
  waitTimeoutMs?: number
  notify?: Parameters<typeof handleVoiceModeRoutes>[3]['notify']
} = {}): Promise<{ baseUrl: string; appServer: TestAppServer }> {
  const appServer = options.appServer ?? makeAppServer()
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (await handleVoiceModeRoutes(req, res, url, {
      appServer,
      fetch: options.fetch,
      jobStore: options.jobStore,
      pollIntervalMs: options.pollIntervalMs,
      waitTimeoutMs: options.waitTimeoutMs,
      notify: options.notify,
    })) {
      return
    }
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
  return { baseUrl: `http://127.0.0.1:${address.port}`, appServer }
}

async function requestJson(baseUrl: string, path: string, init: RequestInit = {}): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  }
}

async function createVoiceJob(baseUrl: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await requestJson(baseUrl, VOICE_MODE_JOBS_PATH, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  expect([200, 202]).toContain(response.status)
  expect(response.body.data).toBeTruthy()
  const job = response.body.job
  if (!job || typeof job !== 'object' || Array.isArray(job)) {
    throw new Error('Expected voice job response')
  }
  return job as Record<string, unknown>
}

async function waitForJob(baseUrl: string, jobId: string, status = 'ready'): Promise<Record<string, unknown>> {
  let lastJob: Record<string, unknown> | null = null
  for (let index = 0; index < 40; index += 1) {
    const response = await requestJson(baseUrl, `${VOICE_MODE_JOBS_PATH}/${encodeURIComponent(jobId)}`)
    expect(response.status).toBe(200)
    const job = response.body.job as Record<string, unknown>
    lastJob = job
    if (job.status === status) return job
    if (job.status === 'failed') return job
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Voice job did not reach ${status}; last=${JSON.stringify(lastJob)}`)
}

function completedThread(threadId: string, assistantText: string): unknown {
  return {
    thread: {
      id: threadId,
      turns: [
        {
          id: 'turn-user',
          status: 'completed',
          items: [{ type: 'userMessage', content: [{ type: 'text', text: 'Сделай задачу' }] }],
        },
        {
          id: 'turn-assistant',
          status: 'completed',
          items: [{ type: 'agentMessage', text: assistantText }],
        },
      ],
    },
  }
}

function inProgressThread(threadId: string): unknown {
  return {
    thread: {
      id: threadId,
      turns: [
        {
          id: 'turn-running',
          status: 'inProgress',
          items: [{ type: 'agentMessage', text: 'partial text should not be spoken yet' }],
        },
      ],
    },
  }
}

function createAudioResponse(bytes = [1, 2, 3], status = 200): Response {
  return new Response(new Uint8Array(bytes), {
    status,
    headers: { 'Content-Type': 'audio/mpeg' },
  })
}

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createFetchMock(responses: Response[]): typeof fetch {
  return vi.fn(async () => {
    const response = responses.shift()
    if (!response) throw new Error('Unexpected fetch call')
    return response
  }) as unknown as typeof fetch
}

function callsFor(fetchImpl: typeof fetch): Array<[string, RequestInit]> {
  return vi.mocked(fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls as Array<[string, RequestInit]>
}

describe('voice mode server routes', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env.CODEXUI_VOICE_TTS_API_KEY = 'voice-key'
    process.env.CODEXUI_TRANSCRIBE_API_KEY = ''
    process.env.OPENAI_API_KEY = ''
    process.env.CODEXUI_VOICE_TTS_MODEL = ''
    process.env.CODEXUI_VOICE_TTS_BASE_URL = ''
    process.env.CODEXUI_VOICE_SUMMARY_API_KEY = ''
    process.env.CODEXUI_VOICE_SUMMARY_MODEL = 'local'
    process.env.CODEXUI_VOICE_SUMMARY_DISABLED = ''
    process.env.OPENAI_BASE_URL = ''
  })

  afterEach(async () => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
      server.close(() => resolve())
    })))
  })

  it('returns binary speech audio with default TTS model, nova voice, mp3 format, and bounded spoken text', async () => {
    const fetchImpl = createFetchMock([createAudioResponse([4, 5, 6])])
    const { baseUrl } = await listenVoiceServer({ fetch: fetchImpl })

    const response = await fetch(`${baseUrl}${VOICE_MODE_SPEECH_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Сделал voice mode. ```ts\nconst secret = "do-not-read"\n``` Проверь кнопку.',
        speed: 1.25,
        voice: 'nova',
      }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('audio/mpeg')
    expect(response.headers.get('x-codex-voice')).toBe('nova')
    expect(response.headers.get('x-codex-voice-speed')).toBe('1.25')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([4, 5, 6]))

    const calls = callsFor(fetchImpl)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.[0]).toBe('https://api.openai.com/v1/audio/speech')
    expect(calls[0]?.[1].headers).toEqual({
      Authorization: 'Bearer voice-key',
      'Content-Type': 'application/json',
    })
    const body = JSON.parse(String(calls[0]?.[1].body)) as Record<string, unknown>
    expect(body.model).toBe('gpt-4o-mini-tts')
    expect(body.voice).toBe('nova')
    expect(body.response_format).toBe('mp3')
    expect(body.speed).toBe(1.25)
    expect(String(body.input)).toContain('Сделал voice mode')
    expect(String(body.input)).not.toContain('const secret')
  })

  it('uses the transcription key before OPENAI_API_KEY when a dedicated TTS key is absent', async () => {
    process.env.CODEXUI_VOICE_TTS_API_KEY = ''
    process.env.CODEXUI_TRANSCRIBE_API_KEY = 'transcribe-key'
    process.env.OPENAI_API_KEY = 'openai-key'
    const fetchImpl = createFetchMock([createAudioResponse()])
    const { baseUrl } = await listenVoiceServer({ fetch: fetchImpl })

    const response = await fetch(`${baseUrl}${VOICE_MODE_SPEECH_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Ответ готов.' }),
    })

    expect(response.status).toBe(200)
    expect(callsFor(fetchImpl)[0]?.[1].headers).toMatchObject({ Authorization: 'Bearer transcribe-key' })
  })

  it('validates text, voice, format, and missing TTS configuration without calling the provider', async () => {
    const fetchImpl = createFetchMock([])
    const { baseUrl } = await listenVoiceServer({ fetch: fetchImpl })

    const missingText = await requestJson(baseUrl, VOICE_MODE_SPEECH_PATH, {
      method: 'POST',
      body: JSON.stringify({ text: '   ' }),
    })
    const badVoice = await requestJson(baseUrl, VOICE_MODE_SPEECH_PATH, {
      method: 'POST',
      body: JSON.stringify({ text: 'hello', voice: 'robot-secret' }),
    })
    const badFormat = await requestJson(baseUrl, VOICE_MODE_SPEECH_PATH, {
      method: 'POST',
      body: JSON.stringify({ text: 'hello', format: 'exe' }),
    })

    process.env.CODEXUI_VOICE_TTS_API_KEY = ''
    process.env.CODEXUI_TRANSCRIBE_API_KEY = ''
    process.env.OPENAI_API_KEY = ''
    const missingKey = await requestJson(baseUrl, VOICE_MODE_SPEECH_PATH, {
      method: 'POST',
      body: JSON.stringify({ text: 'hello' }),
    })

    expect(missingText.status).toBe(400)
    expect(missingText.body.error).toBe('Voice speech requires non-empty text')
    expect(badVoice.status).toBe(400)
    expect(badFormat.status).toBe(400)
    expect(missingKey.status).toBe(503)
    expect(String(missingKey.body.error)).toContain('CODEXUI_VOICE_TTS_API_KEY')
    expect(callsFor(fetchImpl)).toHaveLength(0)
  })

  it('sanitizes provider and network errors', async () => {
    const providerFetch = createFetchMock([
      createJsonResponse({ error: { message: 'bad key voice-key for org secret-org' } }, 400),
    ])
    const { baseUrl } = await listenVoiceServer({ fetch: providerFetch })

    const providerError = await requestJson(baseUrl, VOICE_MODE_SPEECH_PATH, {
      method: 'POST',
      body: JSON.stringify({ text: 'hello' }),
    })

    expect(providerError.status).toBe(400)
    expect(providerError.body.error).toBe('OpenAI voice generation rejected the request. Check voice mode TTS configuration.')
    expect(JSON.stringify(providerError.body)).not.toContain('voice-key')
    expect(JSON.stringify(providerError.body)).not.toContain('secret-org')

    const networkFetch = vi.fn(async () => {
      throw new Error('network leaked voice-key')
    }) as unknown as typeof fetch
    const { baseUrl: networkBaseUrl } = await listenVoiceServer({ fetch: networkFetch })

    const networkError = await requestJson(networkBaseUrl, VOICE_MODE_SPEECH_PATH, {
      method: 'POST',
      body: JSON.stringify({ text: 'hello' }),
    })

    expect(networkError.status).toBe(502)
    expect(networkError.body.error).toBe('OpenAI voice generation request failed. Please retry.')
    expect(JSON.stringify(networkError.body)).not.toContain('voice-key')
  })

  it('can use the Responses API for Russian profile summaries before TTS', async () => {
    process.env.CODEXUI_VOICE_SUMMARY_MODEL = 'gpt-5.5'
    process.env.CODEXUI_VOICE_SUMMARY_API_KEY = 'summary-key'
    const fetchImpl = createFetchMock([
      createJsonResponse({ output_text: 'Готово: я добавил серверный режим озвучки. Код не читаю, важно проверить маршрут.' }),
      createAudioResponse([7, 8, 9]),
    ])
    const { baseUrl } = await listenVoiceServer({ fetch: fetchImpl })

    const response = await fetch(`${baseUrl}${VOICE_MODE_SPEECH_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Detailed markdown answer', profile: 'forte' }),
    })

    expect(response.status).toBe(200)
    const calls = callsFor(fetchImpl)
    expect(calls).toHaveLength(2)
    expect(calls[0]?.[0]).toBe('https://api.openai.com/v1/responses')
    expect(calls[0]?.[1].headers).toMatchObject({ Authorization: 'Bearer summary-key' })
    const summaryBody = JSON.parse(String(calls[0]?.[1].body)) as Record<string, unknown>
    expect(summaryBody.model).toBe('gpt-5.5')
    expect(summaryBody.reasoning).toEqual({ effort: 'medium' })
    expect(String(summaryBody.instructions)).toContain('Всегда отвечай по-русски')
    const ttsBody = JSON.parse(String(calls[1]?.[1].body)) as Record<string, unknown>
    expect(ttsBody.input).toBe('Готово: я добавил серверный режим озвучки. Код не читаю, важно проверить маршрут.')
  })

  it('creates asynchronous voice jobs and serves cached audio', async () => {
    const fetchImpl = createFetchMock([createAudioResponse([10, 11, 12])])
    const { baseUrl } = await listenVoiceServer({ fetch: fetchImpl })

    const created = await createVoiceJob(baseUrl, {
      text: 'Сделал задачу. Проверь результат.',
      profile: 'economy',
      voice: 'nova',
      messageId: 'message-voice',
      autoplay: true,
      telegramFallback: true,
    })

    const jobId = String(created.id)
    const ready = await waitForJob(baseUrl, jobId)
    expect(ready.status).toBe('ready')
    expect(ready.state).toBe('ready')
    expect(ready.profile).toBe('economy')
    expect(ready.messageId).toBe('message-voice')
    expect(ready.autoplay).toBe(true)
    expect(ready.telegramFallback).toBe(true)
    expect(ready.audioReady).toBe(true)

    const audio = await fetch(`${baseUrl}${VOICE_MODE_JOBS_PATH}/${encodeURIComponent(jobId)}/audio`)
    expect(audio.status).toBe(200)
    expect(audio.headers.get('content-type')).toContain('audio/mpeg')
    expect(new Uint8Array(await audio.arrayBuffer())).toEqual(new Uint8Array([10, 11, 12]))
  })

  it('waits for a completed assistant answer before synthesizing a thread voice job', async () => {
    const appServer = makeAppServer([
      inProgressThread('thread-wait'),
      completedThread('thread-wait', 'Сделал серверные endpoints. ```diff\n+secret code\n``` Проверь audio route.'),
    ])
    const fetchImpl = createFetchMock([createAudioResponse([13])])
    const { baseUrl } = await listenVoiceServer({
      appServer,
      fetch: fetchImpl,
      pollIntervalMs: 5,
      waitTimeoutMs: 500,
    })

    const created = await createVoiceJob(baseUrl, {
      threadId: 'thread-wait',
      profile: 'medium',
    })
    const ready = await waitForJob(baseUrl, String(created.id))

    expect(ready.status).toBe('ready')
    expect(appServer.rpc).toHaveBeenCalledTimes(2)
    const ttsBody = JSON.parse(String(callsFor(fetchImpl)[0]?.[1].body)) as Record<string, unknown>
    expect(String(ttsBody.input)).toContain('Сделал серверные endpoints')
    expect(String(ttsBody.input)).not.toContain('secret code')
  })

  it('emits a fallback notification when a Telegram-enabled voice job becomes ready', async () => {
    const fetchImpl = createFetchMock([createAudioResponse([15])])
    const notify = vi.fn()
    const { baseUrl } = await listenVoiceServer({ fetch: fetchImpl, notify })

    const created = await createVoiceJob(baseUrl, {
      text: 'Ответ для Telegram fallback.',
      telegramFallback: true,
    })
    const ready = await waitForJob(baseUrl, String(created.id))

    expect(ready.status).toBe('ready')
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ready',
      job: expect.objectContaining({
        id: String(created.id),
        telegramFallback: true,
        status: 'ready',
      }),
    }))
  })

  it('expires in-memory job audio by TTL', async () => {
    let now = Date.UTC(2026, 0, 1)
    const store = new VoiceJobStore({ ttlMs: 20, nowMs: () => now })
    const fetchImpl = createFetchMock([createAudioResponse([14])])
    const { baseUrl } = await listenVoiceServer({ fetch: fetchImpl, jobStore: store })

    const created = await createVoiceJob(baseUrl, { text: 'Ответ для TTL.' })
    const ready = await waitForJob(baseUrl, String(created.id))
    expect(ready.status).toBe('ready')

    now += 21
    const expiredAudio = await requestJson(baseUrl, `${VOICE_MODE_JOBS_PATH}/${encodeURIComponent(String(created.id))}/audio`)
    const expiredStatus = await requestJson(baseUrl, `${VOICE_MODE_JOBS_PATH}/${encodeURIComponent(String(created.id))}`)

    expect(expiredAudio.status).toBe(410)
    expect(expiredStatus.body.job).toMatchObject({ status: 'expired', audioReady: false })
  })

  it('extracts and locally summarizes assistant text without reading code or logs verbatim', () => {
    const payload = completedThread('thread-local', [
      '## Готово',
      'Добавил route.',
      '```ts',
      'const token = "secret"',
      '```',
      '[2026-01-01] error internal details',
      'Проверь тесты.',
    ].join('\n'))

    expect(extractLatestAssistantText(payload)).toContain('Добавил route')

    const summary = summarizeVoiceTextLocally(extractLatestAssistantText(payload), 'medium')
    expect(summary).toContain('Добавил route')
    expect(summary).not.toContain('const token')
    expect(summary).not.toContain('[2026-01-01]')
  })
})
