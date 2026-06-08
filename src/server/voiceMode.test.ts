import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { handleVoiceModeSpeechRoute } from './voiceMode'

function makeAppServer() {
  return {
    rpc: vi.fn(async () => {
      throw new Error('app-server summary should not be called without threadId')
    }),
  }
}

type TestAppServer = {
  rpc: (method: string, params: unknown) => Promise<unknown>
}

async function withVoiceServer(
  options: {
    fetch?: typeof fetch
    appServer?: TestAppServer
  },
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const appServer = options.appServer ?? makeAppServer()
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (await handleVoiceModeSpeechRoute(req, res, url, { appServer, fetch: options.fetch })) {
      return
    }
    res.statusCode = 404
    res.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('test server did not bind to a TCP port')
  }
  try {
    await run(`http://127.0.0.1:${address.port}`)
  } finally {
    server.close()
    await once(server as Server, 'close')
  }
}

describe('voice mode speech route', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env.CODEXUI_VOICE_TTS_API_KEY = 'test-key'
    process.env.CODEXUI_VOICE_TTS_MODEL = ''
    process.env.CODEXUI_VOICE_TTS_BASE_URL = ''
    process.env.OPENAI_API_KEY = ''
    process.env.OPENAI_BASE_URL = ''
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  it('returns binary speech audio from OpenAI TTS with nova and speed', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body.model).toBe('gpt-4o-mini-tts')
      expect(body.voice).toBe('nova')
      expect(body.speed).toBe(1.25)
      expect(body.response_format).toBe('mp3')
      expect(String(body.input)).toContain('Implemented voice mode')
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      })
    }) as unknown as typeof fetch

    await withVoiceServer({ fetch: fetchMock }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/codex-api/voice/speech`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Implemented voice mode. ```ts\nconst x = 1\n```',
          speed: 1.25,
          voice: 'nova',
        }),
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('audio/mpeg')
      expect(response.headers.get('x-codex-voice')).toBe('nova')
      expect(response.headers.get('x-codex-voice-speed')).toBe('1.25')
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    })
  })

  it('rejects empty text', async () => {
    await withVoiceServer({}, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/codex-api/voice/speech`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '   ', speed: 1 }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: 'Voice speech requires non-empty text' })
    })
  })

  it('sends the app-server conversational summary to TTS instead of the full response', async () => {
    const appServer = {
      rpc: vi.fn(async (method: string, params: unknown) => {
        if (method === 'thread/fork') {
          expect(params).toMatchObject({ threadId: 'thread-1', ephemeral: true })
          return { thread: { id: 'voice-thread-1' } }
        }
        if (method === 'turn/start') {
          expect(params).toMatchObject({ threadId: 'voice-thread-1' })
          return { turn: { id: 'turn-1' } }
        }
        if (method === 'thread/read') {
          return {
            thread: {
              turns: [{
                status: 'completed',
                items: [{
                  id: 'summary-1',
                  type: 'agentMessage',
                  text: 'Short spoken summary. It explains the change without reading the code.',
                }],
              }],
            },
          }
        }
        throw new Error(`Unexpected rpc method ${method}`)
      }),
    }
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body.input).toBe('Short spoken summary. It explains the change without reading the code.')
      expect(String(body.input)).not.toContain('very long detailed answer')
      return new Response(new Uint8Array([4, 5, 6]), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      })
    }) as unknown as typeof fetch

    await withVoiceServer({ appServer, fetch: fetchMock }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/codex-api/voice/speech`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: 'thread-1',
          text: 'This is a very long detailed answer with code and logs. ```ts\nconsole.log("do not read this")\n```',
          speed: 1,
          voice: 'nova',
        }),
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('x-codex-voice-summary-source')).toBe('app-server')
      expect(fetchMock).toHaveBeenCalledOnce()
    })
  })
})
