import { computed, onBeforeUnmount, ref } from 'vue'
import {
  createVoiceJob,
  createVoiceSpeech,
  fetchVoiceJob,
  fetchVoiceJobAudio,
  type CreateVoiceJobInput,
  type CreateVoiceSpeechInput,
  type VoiceAnswerJob,
  type VoiceJobState,
  type VoiceProfile,
  type VoiceTtsModel,
} from '../api/voiceMode'
import {
  addVoicePlaybackRemoteCommandListener,
  beginVoicePlaybackSession,
  beginVoiceWaitingSession,
  endVoicePlaybackSession,
  endVoiceWaitingSession,
  pauseVoicePlayback,
  playVoiceAudioBase64,
  resumeVoicePlayback,
  seekVoicePlaybackBy,
  shouldUseNativeAudioSession,
} from '../native/codexAudioSession'

export type VoicePlaybackState =
  | 'idle'
  | 'creating_job'
  | 'waiting_for_answer'
  | 'summarizing'
  | 'synthesizing'
  | 'fetching_audio'
  | 'playing'
  | 'paused'
  | 'blocked'
  | 'error'

export type PlayVoiceJobInput = Partial<Pick<CreateVoiceJobInput, 'profile' | 'speed' | 'voice' | 'model' | 'autoplay' | 'telegramFallback'>> & {
  threadId: string
  text?: string
  messageId?: string
  afterMessageId?: string
  pollIntervalMs?: number
}

export type PlayVoiceSpeechInput = Omit<CreateVoiceSpeechInput, 'responseFormat'> & {
  cacheKey?: string
}

export type PlayVoiceBlobInput = {
  blob: Blob
  cacheKey?: string
  messageId?: string
}

type CacheEntry = {
  blob: Blob
}

const DEFAULT_PROFILE: VoiceProfile = 'medium'
const DEFAULT_VOICE = 'nova'
const DEFAULT_TTS_MODEL: VoiceTtsModel = 'gpt-4o-mini-tts'
const DEFAULT_SPEED = 1
const DEFAULT_POLL_INTERVAL_MS = 1500
const MIN_POLL_INTERVAL_MS = 500
const MAX_POLL_INTERVAL_MS = 10000
const VOICE_CACHE_LIMIT = 16

function clampPollIntervalMs(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_POLL_INTERVAL_MS
  return Math.max(MIN_POLL_INTERVAL_MS, Math.min(MAX_POLL_INTERVAL_MS, Math.floor(value)))
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function hashText(text: string): string {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

function createSpeechCacheKey(input: PlayVoiceSpeechInput): string {
  return [
    'speech',
    input.threadId ?? '',
    input.messageId ?? '',
    input.profile ?? DEFAULT_PROFILE,
    input.voice ?? DEFAULT_VOICE,
    input.model ?? DEFAULT_TTS_MODEL,
    (input.speed ?? DEFAULT_SPEED).toFixed(2),
    hashText(input.text),
  ].join(':')
}

function createMessageCacheKey(input: {
  threadId?: string
  messageId?: string | null
  profile?: string
  voice?: string
  model?: string
  speed?: number
}): string | null {
  const threadId = input.threadId?.trim()
  const messageId = input.messageId?.trim()
  if (!threadId || !messageId) return null
  return [
    'message',
    threadId,
    messageId,
    input.profile ?? DEFAULT_PROFILE,
    input.voice ?? DEFAULT_VOICE,
    input.model ?? DEFAULT_TTS_MODEL,
    (input.speed ?? DEFAULT_SPEED).toFixed(2),
  ].join(':')
}

function uniqueCacheKeys(keys: Array<string | null | undefined>): string[] {
  return Array.from(new Set(keys.filter((key): key is string => Boolean(key))))
}

function setBoundedCacheEntry<K, V>(cache: Map<K, V>, key: K, value: V, limit: number): void {
  if (cache.has(key)) cache.delete(key)
  cache.set(key, value)
  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value as K | undefined
    if (oldestKey === undefined) break
    cache.delete(oldestKey)
  }
}

function mapJobStateToPlaybackState(state: VoiceJobState): VoicePlaybackState {
  if (state === 'queued' || state === 'waiting_for_answer') return 'waiting_for_answer'
  if (state === 'summarizing') return 'summarizing'
  if (state === 'synthesizing') return 'synthesizing'
  return 'fetching_audio'
}

function createAbortError(): DOMException {
  return new DOMException('Voice playback was aborted.', 'AbortError')
}

function isUnsupportedPlaybackError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === 'NotSupportedError' || /operation is not supported|not supported/iu.test(error.message)
}

function describeBlob(blob: Blob): string {
  const type = blob.type || 'unknown type'
  return `${type}, ${blob.size} bytes`
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }
      reject(new Error('Failed to prepare voice audio data URL.'))
    }, { once: true })
    reader.addEventListener('error', () => {
      reject(reader.error ?? new Error('Failed to read voice audio blob.'))
    }, { once: true })
    reader.readAsDataURL(blob)
  })
}

async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await blobToDataUrl(blob)
  const commaIndex = dataUrl.indexOf(',')
  return commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl
}

function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(createAbortError())
  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof globalThis.setTimeout> | null = null
    const cleanup = () => {
      if (timeout !== null) {
        globalThis.clearTimeout(timeout)
        timeout = null
      }
      signal.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(createAbortError())
    }
    timeout = globalThis.setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export function useVoicePlayback() {
  const state = ref<VoicePlaybackState>('idle')
  const errorMessage = ref('')
  const activeMessageId = ref('')
  const activeJob = ref<VoiceAnswerJob | null>(null)

  const isBusy = computed(() => (
    state.value === 'creating_job' ||
    state.value === 'waiting_for_answer' ||
    state.value === 'summarizing' ||
    state.value === 'synthesizing' ||
    state.value === 'fetching_audio' ||
    state.value === 'playing'
  ))
  const isPolling = computed(() => (
    state.value === 'waiting_for_answer' ||
    state.value === 'summarizing' ||
    state.value === 'synthesizing'
  ))
  const canPause = computed(() => state.value === 'playing')
  const canResume = computed(() => state.value === 'paused' || state.value === 'blocked')

  const audio = typeof Audio !== 'undefined' ? new Audio() : null
  const cache = new Map<string, CacheEntry>()
  let abortController: AbortController | null = null
  let activeObjectUrl = ''
  let playSequence = 0
  let nativePlaybackEndTimer: ReturnType<typeof globalThis.setTimeout> | null = null
  let remoteCommandHandlePromise: ReturnType<typeof addVoicePlaybackRemoteCommandListener> | null = null
  let persistentWaitingSessionActive = false
  let transientWaitingSessionActive = false

  if (audio) {
    audio.preload = 'auto'
    audio.addEventListener('ended', () => {
      if (state.value === 'playing') {
        state.value = 'idle'
        activeMessageId.value = ''
        void endVoicePlaybackSession()
      }
    })
  }

  function registerRemoteCommandListener(): void {
    if (remoteCommandHandlePromise) return
    remoteCommandHandlePromise = addVoicePlaybackRemoteCommandListener((event) => {
      if (event.command === 'pause') {
        void pause()
        return
      }
      if (event.command === 'play') {
        void resume()
        return
      }
      if (event.command === 'toggle') {
        if (state.value === 'playing') {
          void pause()
        } else {
          void resume()
        }
      }
    }).catch((error) => {
      console.warn('Failed to register iOS voice playback remote commands.', error)
      return {
        remove: async () => undefined,
      }
    })
  }

  registerRemoteCommandListener()

  async function unlockAudio(): Promise<void> {
    if (typeof window === 'undefined') return
    const AudioContextCtor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) return
    try {
      const context = new AudioContextCtor()
      if (context.state === 'suspended') {
        await context.resume()
      }
      await context.close()
    } catch {
      // Mobile browsers may still require the later playback call to happen after a user gesture.
    }
  }

  function startOperation(): { controller: AbortController; sequence: number } {
    const sequence = playSequence + 1
    playSequence = sequence
    abortController?.abort()
    abortController = new AbortController()
    errorMessage.value = ''
    return { controller: abortController, sequence }
  }

  function isCurrent(sequence: number): boolean {
    return sequence === playSequence
  }

  function revokeActiveObjectUrl(): void {
    if (!activeObjectUrl) return
    URL.revokeObjectURL(activeObjectUrl)
    activeObjectUrl = ''
  }

  function resetAudioElement(): void {
    if (!audio) return
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }

  function clearNativePlaybackEndTimer(): void {
    if (nativePlaybackEndTimer === null) return
    globalThis.clearTimeout(nativePlaybackEndTimer)
    nativePlaybackEndTimer = null
  }

  async function playAudioSource(src: string): Promise<void> {
    if (!audio) return
    audio.src = src
    audio.currentTime = 0
    await audio.play()
  }

  function scheduleNativePlaybackEnd(durationSeconds: number | undefined, sequence: number): void {
    clearNativePlaybackEndTimer()
    if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return
    nativePlaybackEndTimer = globalThis.setTimeout(() => {
      nativePlaybackEndTimer = null
      if (!isCurrent(sequence) || state.value !== 'playing') return
      state.value = 'idle'
      activeMessageId.value = ''
      void endVoicePlaybackSession()
    }, Math.ceil(durationSeconds * 1000) + 250)
  }

  function scheduleNativePlaybackEndFromResult(
    result: { duration?: number; currentTime?: number },
    sequence: number,
  ): void {
    const duration = typeof result.duration === 'number' ? result.duration : undefined
    const currentTime = typeof result.currentTime === 'number' ? result.currentTime : 0
    const remainingSeconds = typeof duration === 'number'
      ? Math.max(0, duration - currentTime)
      : undefined
    scheduleNativePlaybackEnd(remainingSeconds, sequence)
  }

  function stop(): void {
    playSequence += 1
    abortController?.abort()
    abortController = null
    resetAudioElement()
    clearNativePlaybackEndTimer()
    revokeActiveObjectUrl()
    activeMessageId.value = ''
    activeJob.value = null
    errorMessage.value = ''
    state.value = 'idle'
    void endTransientWaitingSession()
    void endVoicePlaybackSession()
  }

  async function setVoiceModeKeepAlive(enabled: boolean): Promise<void> {
    if (!shouldUseNativeAudioSession()) return
    if (enabled) {
      if (persistentWaitingSessionActive) return
      const result = await beginVoiceWaitingSession({ keepAlive: true })
      if (result.ok) {
        persistentWaitingSessionActive = true
      } else if (!result.skipped) {
        console.warn('Failed to start persistent iOS voice waiting session.', result)
      }
      return
    }

    if (!persistentWaitingSessionActive) return
    persistentWaitingSessionActive = false
    const result = await endVoiceWaitingSession()
    if (!result.ok && !result.skipped) {
      console.warn('Failed to stop persistent iOS voice waiting session.', result)
    }
  }

  async function beginTransientWaitingSession(keepAlive: boolean): Promise<void> {
    await endTransientWaitingSession()
    const result = await beginVoiceWaitingSession({ keepAlive })
    if (result.ok) {
      transientWaitingSessionActive = true
    } else if (!result.skipped) {
      console.warn('Failed to start transient iOS voice waiting session.', result)
    }
  }

  async function endTransientWaitingSession(): Promise<void> {
    if (!transientWaitingSessionActive) return
    transientWaitingSessionActive = false
    const result = await endVoiceWaitingSession()
    if (!result.ok && !result.skipped) {
      console.warn('Failed to stop transient iOS voice waiting session.', result)
    }
  }

  function cacheBlob(cacheKeys: string[], blob: Blob): void {
    for (const key of cacheKeys) {
      setBoundedCacheEntry(cache, key, { blob }, VOICE_CACHE_LIMIT)
    }
  }

  async function playCachedBlob(cacheKeys: string[], messageId: string | undefined, sequence: number): Promise<boolean> {
    for (const cacheKey of cacheKeys) {
      const entry = cache.get(cacheKey)
      if (!entry) continue
      await playBlobInternal(entry.blob, cacheKeys, messageId, sequence)
      return true
    }
    return false
  }

  async function playBlobInternal(blob: Blob, cacheKeys: string[], messageId: string | undefined, sequence: number): Promise<void> {
    if (!audio) {
      state.value = 'error'
      errorMessage.value = 'Audio playback is not supported in this browser.'
      return
    }

    revokeActiveObjectUrl()
    activeObjectUrl = URL.createObjectURL(blob)
    audio.src = activeObjectUrl
    audio.currentTime = 0
    activeMessageId.value = messageId ?? ''

    try {
      await endTransientWaitingSession()
      if (shouldUseNativeAudioSession()) {
        const nativeResult = await playVoiceAudioBase64({
          base64: await blobToBase64(blob),
          contentType: blob.type || 'application/octet-stream',
          duckOthers: true,
          mixWithOthers: true,
        })
        if (!nativeResult.ok) {
          throw new Error(nativeResult.error || nativeResult.warning || 'Native iOS audio playback failed.')
        }
        if (!isCurrent(sequence)) return
        cacheBlob(cacheKeys, blob)
        state.value = 'playing'
        scheduleNativePlaybackEnd(nativeResult.duration, sequence)
        return
      }

      await beginVoicePlaybackSession({ duckOthers: true, mixWithOthers: true })
      try {
        await playAudioSource(activeObjectUrl)
      } catch (error) {
        if (!isUnsupportedPlaybackError(error)) throw error
        const dataUrl = await blobToDataUrl(blob)
        revokeActiveObjectUrl()
        await playAudioSource(dataUrl)
      }
      if (!isCurrent(sequence)) return
      cacheBlob(cacheKeys, blob)
      state.value = 'playing'
    } catch (error) {
      if (!isCurrent(sequence)) return
      state.value = 'blocked'
      const detail = error instanceof Error ? error.message : 'Audio playback is blocked until you tap resume.'
      errorMessage.value = `Audio playback failed (${describeBlob(blob)}): ${detail}`
    }
  }

  async function pollJobUntilReady(job: VoiceAnswerJob, signal: AbortSignal, sequence: number, pollIntervalMs: number): Promise<VoiceAnswerJob | null> {
    let current = job
    activeJob.value = current

    while (isCurrent(sequence)) {
      if (current.state === 'ready') return current
      if (current.state === 'failed' || current.state === 'expired') {
        throw new Error(current.error || `Voice job ${current.state}.`)
      }

      state.value = mapJobStateToPlaybackState(current.state)
      await waitFor(pollIntervalMs, signal)
      if (!isCurrent(sequence)) return null
      current = await fetchVoiceJob(current.id, signal)
      activeJob.value = current
    }

    return null
  }

  async function playJob(input: PlayVoiceJobInput): Promise<VoiceAnswerJob | null> {
    if (!audio) {
      state.value = 'error'
      errorMessage.value = 'Audio playback is not supported in this browser.'
      return null
    }

    const { controller, sequence } = startOperation()
    activeMessageId.value = input.messageId ?? ''
    activeJob.value = null
    state.value = 'creating_job'

    try {
      await beginTransientWaitingSession(input.autoplay ?? true)
      const job = await createVoiceJob({
        threadId: input.threadId,
        text: input.text,
        messageId: input.messageId,
        afterMessageId: input.afterMessageId,
        profile: input.profile ?? DEFAULT_PROFILE,
        speed: input.speed ?? DEFAULT_SPEED,
        voice: input.voice ?? DEFAULT_VOICE,
        model: input.model ?? DEFAULT_TTS_MODEL,
        autoplay: input.autoplay ?? true,
        telegramFallback: input.telegramFallback ?? false,
      }, controller.signal)
      if (!isCurrent(sequence)) return null

      const readyJob = await pollJobUntilReady(job, controller.signal, sequence, clampPollIntervalMs(input.pollIntervalMs))
      if (!readyJob || !isCurrent(sequence)) return null

      state.value = 'fetching_audio'
      const messageId = readyJob.messageId ?? input.messageId
      const cacheKeys = uniqueCacheKeys([
        createMessageCacheKey({
          threadId: readyJob.threadId || input.threadId,
          messageId,
          profile: readyJob.profile ?? input.profile,
          speed: readyJob.speed ?? input.speed,
          voice: readyJob.voice ?? input.voice,
          model: readyJob.model ?? input.model,
        }),
        `job:${readyJob.id}`,
      ])
      const cached = await playCachedBlob(cacheKeys, messageId, sequence)
      if (cached || !isCurrent(sequence)) return readyJob

      const blob = await fetchVoiceJobAudio(readyJob.id, controller.signal)
      if (!isCurrent(sequence)) return readyJob
      await playBlobInternal(blob, cacheKeys, messageId, sequence)
      return readyJob
    } catch (error) {
      void endTransientWaitingSession()
      void endVoicePlaybackSession()
      if (!isCurrent(sequence) || isAbortError(error)) return null
      state.value = 'error'
      errorMessage.value = error instanceof Error ? error.message : 'Voice playback failed.'
      activeMessageId.value = ''
      return null
    }
  }

  async function playSpeech(input: PlayVoiceSpeechInput): Promise<void> {
    if (!audio) {
      state.value = 'error'
      errorMessage.value = 'Audio playback is not supported in this browser.'
      return
    }

    const { controller, sequence } = startOperation()
    const cacheKeys = uniqueCacheKeys([
      createMessageCacheKey(input),
      input.cacheKey ?? createSpeechCacheKey(input),
    ])
    activeMessageId.value = input.messageId ?? ''
    state.value = 'synthesizing'

    try {
      const cached = await playCachedBlob(cacheKeys, input.messageId, sequence)
      if (cached || !isCurrent(sequence)) return

      const blob = await createVoiceSpeech({
        text: input.text,
        threadId: input.threadId,
        messageId: input.messageId,
        profile: input.profile ?? DEFAULT_PROFILE,
        speed: input.speed ?? DEFAULT_SPEED,
        voice: input.voice ?? DEFAULT_VOICE,
        model: input.model ?? DEFAULT_TTS_MODEL,
        responseFormat: 'mp3',
      }, controller.signal)
      if (!isCurrent(sequence)) return
      await playBlobInternal(blob, cacheKeys, input.messageId, sequence)
    } catch (error) {
      if (!isCurrent(sequence) || isAbortError(error)) return
      state.value = 'error'
      errorMessage.value = error instanceof Error ? error.message : 'Voice playback failed.'
      activeMessageId.value = ''
    }
  }

  async function playBlob(input: PlayVoiceBlobInput): Promise<void> {
    if (!audio) {
      state.value = 'error'
      errorMessage.value = 'Audio playback is not supported in this browser.'
      return
    }

    const { sequence } = startOperation()
    state.value = 'fetching_audio'
    await playBlobInternal(input.blob, uniqueCacheKeys([input.cacheKey]), input.messageId, sequence)
  }

  async function pause(): Promise<void> {
    if (!audio || state.value !== 'playing') return
    if (shouldUseNativeAudioSession()) {
      clearNativePlaybackEndTimer()
      const result = await pauseVoicePlayback()
      if (!result.ok) {
        state.value = 'blocked'
        errorMessage.value = result.error || result.warning || 'Voice playback could not be paused.'
        return
      }
      state.value = 'paused'
      return
    }
    audio.pause()
    state.value = 'paused'
  }

  async function resume(): Promise<void> {
    if (!audio || (state.value !== 'paused' && state.value !== 'blocked')) return
    errorMessage.value = ''
    try {
      if (shouldUseNativeAudioSession()) {
        const result = await resumeVoicePlayback({ duckOthers: true, mixWithOthers: true })
        if (!result.ok) {
          throw new Error(result.error || result.warning || 'Native iOS audio playback did not resume.')
        }
        state.value = 'playing'
        scheduleNativePlaybackEndFromResult(result, playSequence)
        return
      }
      await beginVoicePlaybackSession({ duckOthers: true, mixWithOthers: true })
      await audio.play()
      state.value = 'playing'
    } catch (error) {
      state.value = 'blocked'
      errorMessage.value = error instanceof Error ? error.message : 'Audio playback is blocked until you tap resume.'
    }
  }

  async function seekBy(seconds: number): Promise<void> {
    if (!audio || state.value === 'idle') return
    const deltaSeconds = Number.isFinite(seconds) ? seconds : 0
    if (deltaSeconds === 0) return

    if (shouldUseNativeAudioSession()) {
      const result = await seekVoicePlaybackBy(deltaSeconds)
      if (!result.ok) {
        state.value = 'blocked'
        errorMessage.value = result.error || result.warning || 'Voice playback could not seek.'
        return
      }
      if (state.value === 'playing') {
        scheduleNativePlaybackEndFromResult(result, playSequence)
      }
      return
    }

    audio.currentTime = Math.min(
      Math.max(0, audio.currentTime + deltaSeconds),
      Number.isFinite(audio.duration) ? audio.duration : Number.MAX_SAFE_INTEGER,
    )
  }

  function clearCache(): void {
    cache.clear()
  }

  onBeforeUnmount(stop)
  onBeforeUnmount(() => {
    void setVoiceModeKeepAlive(false)
  })
  onBeforeUnmount(() => {
    void remoteCommandHandlePromise?.then((handle) => handle.remove()).catch(() => undefined)
  })

  return {
    state,
    errorMessage,
    activeMessageId,
    activeJob,
    isBusy,
    isPolling,
    canPause,
    canResume,
    unlockAudio,
    setVoiceModeKeepAlive,
    playJob,
    playSpeech,
    playBlob,
    pause,
    resume,
    seekBy,
    stop,
    clearCache,
  }
}
