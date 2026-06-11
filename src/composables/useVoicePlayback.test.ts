import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useVoicePlayback } from './useVoicePlayback'
import type { VoiceAnswerJob } from '../api/voiceMode'

const voiceApiMock = vi.hoisted(() => ({
  createVoiceJob: vi.fn(),
  createVoiceSpeech: vi.fn(),
  fetchVoiceJob: vi.fn(),
  fetchVoiceJobAudio: vi.fn(),
}))

const nativeAudioMock = vi.hoisted(() => ({
  addVoicePlaybackRemoteCommandListener: vi.fn(async () => ({ remove: vi.fn(async () => undefined) })),
  beginVoicePlaybackSession: vi.fn(async () => ({ ok: true })),
  beginVoiceWaitingSession: vi.fn(async () => ({ ok: true })),
  endVoicePlaybackSession: vi.fn(async () => ({ ok: true })),
  endVoiceWaitingSession: vi.fn(async () => ({ ok: true })),
  playVoiceAudioBase64: vi.fn(async () => ({ ok: true, duration: 1, audioBytes: 5 })),
  shouldUseNativeAudioSession: vi.fn(() => false),
}))

vi.mock('../api/voiceMode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/voiceMode')>()),
  ...voiceApiMock,
}))

vi.mock('../native/codexAudioSession', () => nativeAudioMock)

class FakeAudio {
  static instances: FakeAudio[] = []
  static nextPlayError: Error | null = null

  preload = ''
  src = ''
  currentSrc = ''
  currentTime = 0
  ended = false
  paused = true
  readonly play = vi.fn(async () => {
    if (FakeAudio.nextPlayError) {
      const error = FakeAudio.nextPlayError
      FakeAudio.nextPlayError = null
      throw error
    }
    this.paused = false
    this.ended = false
  })
  readonly pause = vi.fn(() => {
    this.paused = true
  })
  readonly load = vi.fn()
  readonly removeAttribute = vi.fn((name: string) => {
    if (name === 'src') {
      this.src = ''
      this.currentSrc = ''
    }
  })
  readonly addEventListener = vi.fn()

  constructor() {
    FakeAudio.instances.push(this)
  }
}

class FakeFileReader {
  result: string | ArrayBuffer | null = null
  error: DOMException | null = null
  private readonly listeners = new Map<string, Array<(event: Event) => void>>()

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type) ?? []
    if (typeof listener === 'function') {
      listeners.push(listener)
    } else {
      listeners.push((event) => listener.handleEvent(event))
    }
    this.listeners.set(type, listeners)
  }

  readAsDataURL(blob: Blob): void {
    this.result = `data:${blob.type || 'application/octet-stream'};base64,dm9pY2U=`
    queueMicrotask(() => this.dispatch('load'))
  }

  private dispatch(type: string): void {
    const event = new Event(type)
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event)
    }
  }
}

function createJob(overrides: Partial<VoiceAnswerJob>): VoiceAnswerJob {
  return {
    id: 'job-1',
    threadId: 'thread-1',
    state: 'queued',
    profile: 'medium',
    speed: 1,
    voice: 'nova',
    model: 'gpt-4o-mini-tts',
    autoplay: true,
    telegramFallback: false,
    messageId: 'message-1',
    turnId: null,
    error: null,
    createdAtIso: null,
    updatedAtIso: null,
    expiresAtIso: null,
    audioContentType: null,
    summaryText: null,
    ...overrides,
  }
}

describe('useVoicePlayback', () => {
  let originalAudio: typeof Audio | undefined
  let originalFileReader: typeof FileReader | undefined
  let originalCreateObjectUrl: PropertyDescriptor | undefined
  let originalRevokeObjectUrl: PropertyDescriptor | undefined

  beforeEach(() => {
    FakeAudio.instances = []
    FakeAudio.nextPlayError = null
    originalAudio = globalThis.Audio
    originalFileReader = globalThis.FileReader
    originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
    originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
    Object.defineProperty(globalThis, 'Audio', {
      configurable: true,
      value: FakeAudio,
    })
    Object.defineProperty(globalThis, 'FileReader', {
      configurable: true,
      value: FakeFileReader,
    })
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:voice-test'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
    for (const mock of Object.values(voiceApiMock)) {
      mock.mockReset()
    }
    for (const mock of Object.values(nativeAudioMock)) {
      mock.mockClear()
    }
    nativeAudioMock.addVoicePlaybackRemoteCommandListener.mockResolvedValue({ remove: vi.fn(async () => undefined) })
    nativeAudioMock.beginVoicePlaybackSession.mockResolvedValue({ ok: true })
    nativeAudioMock.beginVoiceWaitingSession.mockResolvedValue({ ok: true })
    nativeAudioMock.endVoicePlaybackSession.mockResolvedValue({ ok: true })
    nativeAudioMock.endVoiceWaitingSession.mockResolvedValue({ ok: true })
    nativeAudioMock.playVoiceAudioBase64.mockResolvedValue({ ok: true, duration: 1, audioBytes: 5 })
    nativeAudioMock.shouldUseNativeAudioSession.mockReturnValue(false)
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'Audio', {
      configurable: true,
      value: originalAudio,
    })
    Object.defineProperty(globalThis, 'FileReader', {
      configurable: true,
      value: originalFileReader,
    })
    if (originalCreateObjectUrl) {
      Object.defineProperty(URL, 'createObjectURL', originalCreateObjectUrl)
    } else {
      Reflect.deleteProperty(URL, 'createObjectURL')
    }
    if (originalRevokeObjectUrl) {
      Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectUrl)
    } else {
      Reflect.deleteProperty(URL, 'revokeObjectURL')
    }
  })

  it('creates a job, polls until ready, fetches audio, and plays it', async () => {
    voiceApiMock.createVoiceJob.mockResolvedValueOnce(createJob({ state: 'queued' }))
    voiceApiMock.fetchVoiceJob
      .mockResolvedValueOnce(createJob({ state: 'summarizing' }))
      .mockResolvedValueOnce(createJob({ state: 'ready', audioContentType: 'audio/mpeg' }))
    voiceApiMock.fetchVoiceJobAudio.mockResolvedValueOnce(new Blob(['voice'], { type: 'audio/mpeg' }))

    const playback = useVoicePlayback()
    const resultPromise = playback.playJob({
      threadId: 'thread-1',
      messageId: 'message-1',
      profile: 'medium',
      speed: 1,
      voice: 'nova',
      autoplay: true,
      telegramFallback: true,
      pollIntervalMs: 500,
    })

    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(playback.state.value).toBe('waiting_for_answer')

    await new Promise((resolve) => setTimeout(resolve, 550))
    expect(playback.state.value).toBe('summarizing')

    await new Promise((resolve) => setTimeout(resolve, 550))
    const result = await resultPromise

    expect(result?.state).toBe('ready')
    expect(playback.activeJob.value?.state).toBe('ready')
    expect(playback.state.value).toBe('playing')
    expect(FakeAudio.instances[0]?.src).toBe('blob:voice-test')
    expect(nativeAudioMock.beginVoiceWaitingSession).toHaveBeenCalledWith({ keepAlive: true })
    expect(nativeAudioMock.endVoiceWaitingSession).toHaveBeenCalled()
    expect(nativeAudioMock.beginVoicePlaybackSession).toHaveBeenCalledWith({ duckOthers: true, mixWithOthers: true })
    expect(voiceApiMock.createVoiceJob).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'thread-1',
      messageId: 'message-1',
      profile: 'medium',
      speed: 1,
      voice: 'nova',
      autoplay: true,
      telegramFallback: true,
    }), expect.any(AbortSignal))
    expect(voiceApiMock.fetchVoiceJobAudio).toHaveBeenCalledWith('job-1', expect.any(AbortSignal))
  })

  it('plays compatibility speech blobs and reuses the in-memory cache', async () => {
    voiceApiMock.createVoiceSpeech.mockResolvedValueOnce(new Blob(['speech'], { type: 'audio/mpeg' }))

    const playback = useVoicePlayback()
    await playback.playSpeech({
      text: 'hello',
      threadId: 'thread-1',
      messageId: 'message-1',
      speed: 1,
      voice: 'nova',
    })
    playback.stop()
    await playback.playSpeech({
      text: 'hello',
      threadId: 'thread-1',
      messageId: 'message-1',
      speed: 1,
      voice: 'nova',
    })

    expect(voiceApiMock.createVoiceSpeech).toHaveBeenCalledTimes(1)
    expect(FakeAudio.instances[0]?.play).toHaveBeenCalledTimes(2)
    expect(playback.state.value).toBe('playing')
  })

  it('replays job audio by message cache instead of creating latest speech again', async () => {
    voiceApiMock.createVoiceJob.mockResolvedValueOnce(createJob({ state: 'ready', audioContentType: 'audio/mpeg' }))
    voiceApiMock.fetchVoiceJobAudio.mockResolvedValueOnce(new Blob(['job voice'], { type: 'audio/mpeg' }))

    const playback = useVoicePlayback()
    const readyJob = await playback.playJob({
      threadId: 'thread-1',
      messageId: 'message-1',
      profile: 'medium',
      speed: 1,
      voice: 'nova',
      model: 'gpt-4o-mini-tts',
      pollIntervalMs: 500,
    })
    playback.stop()

    await playback.playSpeech({
      text: 'assistant answer text',
      threadId: 'thread-1',
      messageId: 'message-1',
      profile: 'medium',
      speed: 1,
      voice: 'nova',
      model: 'gpt-4o-mini-tts',
    })

    expect(readyJob?.state).toBe('ready')
    expect(voiceApiMock.fetchVoiceJobAudio).toHaveBeenCalledTimes(1)
    expect(voiceApiMock.createVoiceSpeech).not.toHaveBeenCalled()
    expect(FakeAudio.instances[0]?.play).toHaveBeenCalledTimes(2)
    expect(playback.state.value).toBe('playing')
  })

  it('keeps persistent native waiting audio alive during direct replay', async () => {
    nativeAudioMock.shouldUseNativeAudioSession.mockReturnValue(true)

    const playback = useVoicePlayback()
    await playback.setVoiceModeKeepAlive(true)
    nativeAudioMock.endVoiceWaitingSession.mockClear()

    await playback.playBlob({
      blob: new Blob(['voice'], { type: 'audio/mpeg' }),
      messageId: 'message-1',
    })
    playback.stop()

    expect(nativeAudioMock.playVoiceAudioBase64).toHaveBeenCalled()
    expect(nativeAudioMock.endVoiceWaitingSession).not.toHaveBeenCalled()

    await playback.setVoiceModeKeepAlive(false)
    expect(nativeAudioMock.endVoiceWaitingSession).toHaveBeenCalledTimes(1)
  })

  it('passes audio content type to native iOS playback', async () => {
    nativeAudioMock.shouldUseNativeAudioSession.mockReturnValue(true)

    const playback = useVoicePlayback()
    await playback.playBlob({
      blob: new Blob(['voice'], { type: 'audio/mpeg' }),
      messageId: 'message-1',
    })

    if (nativeAudioMock.playVoiceAudioBase64.mock.calls.length === 0) {
      throw new Error(`Native playback was not called; state=${playback.state.value}; error=${playback.errorMessage.value}; fileReader=${typeof FileReader}; shouldUseCalls=${nativeAudioMock.shouldUseNativeAudioSession.mock.calls.length}`)
    }

    expect(nativeAudioMock.playVoiceAudioBase64).toHaveBeenCalledWith(expect.objectContaining({
      base64: expect.any(String),
      contentType: 'audio/mpeg',
      duckOthers: true,
      mixWithOthers: true,
    }))
    expect(nativeAudioMock.beginVoicePlaybackSession).not.toHaveBeenCalled()
    expect(playback.state.value).toBe('playing')
  })

  it('supports pause, resume, blocked playback, and stop', async () => {
    const playback = useVoicePlayback()
    FakeAudio.nextPlayError = new Error('blocked')

    await playback.playBlob({
      blob: new Blob(['voice'], { type: 'audio/mpeg' }),
      messageId: 'message-1',
    })
    expect(playback.state.value).toBe('blocked')
    expect(playback.canResume.value).toBe(true)

    await playback.resume()
    expect(playback.state.value).toBe('playing')

    playback.pause()
    expect(playback.state.value).toBe('paused')

    await playback.resume()
    expect(playback.state.value).toBe('playing')

    playback.stop()
    await nextTick()
    expect(playback.state.value).toBe('idle')
    expect(playback.activeMessageId.value).toBe('')
    expect(nativeAudioMock.endVoicePlaybackSession).toHaveBeenCalled()
  })

  it('surfaces failed job states without fetching audio', async () => {
    voiceApiMock.createVoiceJob.mockResolvedValueOnce(createJob({ state: 'failed', error: 'summary failed' }))

    const playback = useVoicePlayback()
    const result = await playback.playJob({ threadId: 'thread-1' })

    expect(result).toBeNull()
    expect(playback.state.value).toBe('error')
    expect(playback.errorMessage.value).toBe('summary failed')
    expect(voiceApiMock.fetchVoiceJobAudio).not.toHaveBeenCalled()
  })
})
