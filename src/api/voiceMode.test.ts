import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CodexApiError } from './codexErrors'
import {
  createVoiceJob,
  createVoiceSpeech,
  fetchVoiceJob,
  fetchVoiceJobAudio,
  isVoiceJobTerminal,
} from './voiceMode'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('voiceMode API helpers', () => {
  let originalFetch: typeof fetch | undefined
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
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
  })

  it('creates voice jobs with the expected JSON contract', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: {
        id: 'job-1',
        threadId: 'thread-1',
        state: 'queued',
        profile: 'medium',
        speed: 1.1,
        voice: 'nova',
        autoplay: true,
        telegramFallback: true,
        messageId: 'message-1',
        createdAtIso: '2026-06-10T00:00:00.000Z',
        updatedAtIso: '2026-06-10T00:00:01.000Z',
        expiresAtIso: '2026-06-10T00:10:00.000Z',
        audioContentType: null,
        summaryText: null,
      },
    }))

    const job = await createVoiceJob({
      threadId: 'thread-1',
      text: 'long answer',
      messageId: 'message-1',
      afterMessageId: 'message-before',
      profile: 'medium',
      speed: 1.1,
      voice: 'nova',
      model: 'gpt-4o-mini-tts',
      autoplay: true,
      telegramFallback: true,
    })

    expect(job).toMatchObject({
      id: 'job-1',
      threadId: 'thread-1',
      state: 'queued',
      profile: 'medium',
      speed: 1.1,
      voice: 'nova',
      model: 'gpt-4o-mini-tts',
      autoplay: true,
      telegramFallback: true,
      messageId: 'message-1',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [path, init] = fetchMock.mock.calls[0]
    expect(path).toBe('/codex-api/voice/jobs')
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(JSON.parse(String(init.body))).toEqual({
      threadId: 'thread-1',
      text: 'long answer',
      messageId: 'message-1',
      afterMessageId: 'message-before',
      profile: 'medium',
      speed: 1.1,
      voice: 'nova',
      model: 'gpt-4o-mini-tts',
      autoplay: true,
      telegramFallback: true,
    })
  })

  it('fetches job status with encoded IDs', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: {
        id: 'job/1',
        threadId: 'thread-1',
        status: 'ready',
      },
    }))

    const job = await fetchVoiceJob('job/1')

    expect(job.state).toBe('ready')
    expect(fetchMock.mock.calls[0][0]).toBe('/codex-api/voice/jobs/job%2F1')
  })

  it('accepts legacy job envelopes while the app and server roll forward independently', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      job: {
        id: 'job-legacy',
        status: 'synthesizing',
        threadId: null,
        createdAt: '2026-06-10T00:00:00.000Z',
      },
    }))

    const job = await fetchVoiceJob('job-legacy')

    expect(job).toMatchObject({
      id: 'job-legacy',
      threadId: null,
      state: 'synthesizing',
      createdAtIso: '2026-06-10T00:00:00.000Z',
    })
  })

  it('accepts gateway-wrapped voice job envelopes', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      result: {
        data: {
          id: 'job-wrapped',
          status: 'waiting_for_answer',
          threadId: 'thread-1',
        },
      },
    }))

    const job = await fetchVoiceJob('job-wrapped')

    expect(job).toMatchObject({
      id: 'job-wrapped',
      threadId: 'thread-1',
      state: 'waiting_for_answer',
    })
  })

  it('accepts stringified and content-text voice job envelopes', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        result: JSON.stringify({
          data: {
            id: 'job-stringified',
            status: 'summarizing',
            threadId: 'thread-1',
          },
        }),
      }))
      .mockResolvedValueOnce(jsonResponse({
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                job: {
                  id: 'job-content',
                  status: 'synthesizing',
                  threadId: 'thread-2',
                },
              }),
            },
          ],
        },
      }))

    const stringifiedJob = await fetchVoiceJob('job-stringified')
    const contentJob = await fetchVoiceJob('job-content')

    expect(stringifiedJob).toMatchObject({
      id: 'job-stringified',
      threadId: 'thread-1',
      state: 'summarizing',
    })
    expect(contentJob).toMatchObject({
      id: 'job-content',
      threadId: 'thread-2',
      state: 'synthesizing',
    })
  })

  it('returns audio blobs for compatibility speech and job audio endpoints', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(new Blob(['speech'], { type: 'audio/mpeg' })))
      .mockResolvedValueOnce(new Response(new Blob(['job-audio'], { type: 'audio/mpeg' })))

    const speech = await createVoiceSpeech({ text: 'hello', threadId: 'thread-1' })
    const jobAudio = await fetchVoiceJobAudio('job-1')

    expect(await speech.text()).toBe('speech')
    expect(await jobAudio.text()).toBe('job-audio')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      text: 'hello',
      threadId: 'thread-1',
      profile: 'medium',
      speed: 1,
      voice: 'nova',
      model: 'gpt-4o-mini-tts',
      responseFormat: 'mp3',
    })
    expect(fetchMock.mock.calls[1][0]).toBe('/codex-api/voice/jobs/job-1/audio')
  })

  it('rejects non-audio success responses for voice audio endpoints', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>login</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }))

    await expect(createVoiceSpeech({ text: 'hello', threadId: 'thread-1' })).rejects.toMatchObject({
      name: 'CodexApiError',
      code: 'invalid_response',
      method: '/codex-api/voice/speech',
      status: 200,
    })
  })

  it('throws typed API errors for malformed and failed responses', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'job-1' } }))
      .mockResolvedValueOnce(jsonResponse({ error: 'not ready' }, 409))

    await expect(fetchVoiceJob('job-1')).rejects.toMatchObject({
      name: 'CodexApiError',
      code: 'invalid_response',
      method: '/codex-api/voice/jobs/job-1',
    })
    await expect(fetchVoiceJobAudio('job-1')).rejects.toMatchObject({
      name: 'CodexApiError',
      code: 'http_error',
      status: 409,
      message: 'not ready',
    })
  })

  it('includes non-JSON success payload shape in malformed response errors', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>login</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }))

    let caught: unknown
    try {
      await fetchVoiceJob('job-html')
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(CodexApiError)
    expect(caught).toMatchObject({
      code: 'invalid_response',
      method: '/codex-api/voice/jobs/job-html',
    })
    expect((caught as Error).message).toContain('string(18): received an HTML error page instead of JSON')
  })

  it('exposes terminal state checks', () => {
    expect(isVoiceJobTerminal('queued')).toBe(false)
    expect(isVoiceJobTerminal('ready')).toBe(true)
    expect(isVoiceJobTerminal('failed')).toBe(true)
    expect(isVoiceJobTerminal('expired')).toBe(true)
  })
})
