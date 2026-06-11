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
} from '../api/voiceMode'
import {
  addVoicePlaybackRemoteCommandListener,
  beginVoicePlaybackSession,
  beginVoiceWaitingSession,
  endVoicePlaybackSession,
  endVoiceWaitingSession,
  playVoiceAudioBase64,
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

export type PlayVoiceJobInput = Partial<Pick<CreateVoiceJobInput, 'profile' | 'speed' | 'voice' | 'autoplay' | 'telegramFallback'>> & {
  threadId: string
  text?: string
  messageId?: string
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
const DEFAULT_SPEED = 1
const DEFAULT_POLL_INTERVAL_MS = 1500
const MIN_POLL_INTERVAL_MS = 500
const MAX_POLL_INTERVAL_MS = 10000
const VOICE_CACHE_LIMIT = 8

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
    input.voice ?? DEFAULT_VOICE,
    (input.speed ?? DEFAULT_SPEED).toFixed(2),
    hashText(input.text),
  ].join(':')
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
        pause()
        return
      }
      if (event.command === 'play') {
        void resume()
        return
      }
      if (event.command === 'toggle') {
        if (state.value === 'playing') {
          pause()
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
    void endVoiceWaitingSession()
    void endVoicePlaybackSession()
  }

  async function playCachedBlob(cacheKey: string, messageId: string | undefined, sequence: number): Promise<boolean> {
    const entry = cache.get(cacheKey)
    if (!entry) return false
    await playBlobInternal(entry.blob, cacheKey, messageId, sequence)
    return true
  }

  async function playBlobInternal(blob: Blob, cacheKey: string | undefined, messageId: string | undefined, sequence: number): Promise<void> {
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
      await endVoiceWaitingSession()
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
        if (cacheKey) {
          setBoundedCacheEntry(cache, cacheKey, { blob }, VOICE_CACHE_LIMIT)
        }
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
      if (cacheKey) {
        setBoundedCacheEntry(cache, cacheKey, { blob }, VOICE_CACHE_LIMIT)
      }
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
      await beginVoiceWaitingSession({ keepAlive: input.autoplay ?? true })
      const job = await createVoiceJob({
        threadId: input.threadId,
        text: input.text,
        messageId: input.messageId,
        profile: input.profile ?? DEFAULT_PROFILE,
        speed: input.speed ?? DEFAULT_SPEED,
        voice: input.voice ?? DEFAULT_VOICE,
        autoplay: input.autoplay ?? true,
        telegramFallback: input.telegramFallback ?? false,
      }, controller.signal)
      if (!isCurrent(sequence)) return null

      const readyJob = await pollJobUntilReady(job, controller.signal, sequence, clampPollIntervalMs(input.pollIntervalMs))
      if (!readyJob || !isCurrent(sequence)) return null

      state.value = 'fetching_audio'
      const cacheKey = `job:${readyJob.id}`
      const cached = await playCachedBlob(cacheKey, readyJob.messageId ?? input.messageId, sequence)
      if (cached || !isCurrent(sequence)) return readyJob

      const blob = await fetchVoiceJobAudio(readyJob.id, controller.signal)
      if (!isCurrent(sequence)) return readyJob
      await playBlobInternal(blob, cacheKey, readyJob.messageId ?? input.messageId, sequence)
      return readyJob
    } catch (error) {
      void endVoiceWaitingSession()
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
    const cacheKey = input.cacheKey ?? createSpeechCacheKey(input)
    activeMessageId.value = input.messageId ?? ''
    state.value = 'synthesizing'

    try {
      const cached = await playCachedBlob(cacheKey, input.messageId, sequence)
      if (cached || !isCurrent(sequence)) return

      const blob = await createVoiceSpeech({
        text: input.text,
        threadId: input.threadId,
        messageId: input.messageId,
        speed: input.speed ?? DEFAULT_SPEED,
        voice: input.voice ?? DEFAULT_VOICE,
        responseFormat: 'mp3',
      }, controller.signal)
      if (!isCurrent(sequence)) return
      await playBlobInternal(blob, cacheKey, input.messageId, sequence)
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
    await playBlobInternal(input.blob, input.cacheKey, input.messageId, sequence)
  }

  function pause(): void {
    if (!audio || state.value !== 'playing') return
    audio.pause()
    state.value = 'paused'
  }

  async function resume(): Promise<void> {
    if (!audio || (state.value !== 'paused' && state.value !== 'blocked')) return
    errorMessage.value = ''
    try {
      await beginVoicePlaybackSession({ duckOthers: true, mixWithOthers: true })
      await audio.play()
      state.value = 'playing'
    } catch (error) {
      state.value = 'blocked'
      errorMessage.value = error instanceof Error ? error.message : 'Audio playback is blocked until you tap resume.'
    }
  }

  function clearCache(): void {
    cache.clear()
  }

  onBeforeUnmount(stop)
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
    playJob,
    playSpeech,
    playBlob,
    pause,
    resume,
    stop,
    clearCache,
  }
}
