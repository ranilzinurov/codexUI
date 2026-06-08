import { computed, onBeforeUnmount, ref } from 'vue'
import { createVoiceSpeech } from '../api/voiceMode'

export type VoicePlaybackState = 'idle' | 'synthesizing' | 'playing' | 'blocked' | 'error'

type PlayVoiceInput = {
  messageId: string
  text: string
  threadId: string
  speed: number
  autoplay?: boolean
}

const VOICE_CACHE_LIMIT = 8
const SILENT_WAV_DATA_URL = 'data:audio/wav;base64,UklGRjQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YRAAAAAAAAAAAAAAAAAAAAAA'
const KEEP_ALIVE_GAIN = 0.000001

function hashText(text: string): string {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

function createCacheKey(input: PlayVoiceInput): string {
  return `${input.messageId}:${input.speed.toFixed(2)}:${hashText(input.text)}`
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

export function useVoicePlayback() {
  const state = ref<VoicePlaybackState>('idle')
  const activeMessageId = ref('')
  const errorMessage = ref('')
  const pendingResume = ref<PlayVoiceInput | null>(null)

  const isBusy = computed(() => state.value === 'synthesizing' || state.value === 'playing')

  const audio = typeof Audio !== 'undefined' ? new Audio() : null
  const cache = new Map<string, Blob>()
  let abortController: AbortController | null = null
  let activeObjectUrl = ''
  let playSequence = 0
  let autoplaySessionActive = false
  let audioContext: AudioContext | null = null
  let keepAliveGain: GainNode | null = null
  let keepAliveSource: OscillatorNode | null = null
  let activeBufferSource: AudioBufferSourceNode | null = null

  if (audio) {
    audio.preload = 'auto'
    audio.addEventListener('ended', () => {
      if (state.value === 'playing') {
        state.value = 'idle'
        activeMessageId.value = ''
        if (autoplaySessionActive) {
          void primeAudioElement()
        }
      }
    })
    audio.addEventListener('pause', () => {
      if (state.value === 'playing' && audio.ended) {
        state.value = 'idle'
        activeMessageId.value = ''
      }
    })
  }

  async function unlockAudio(): Promise<void> {
    await ensureAudioContextRunning()
  }

  function getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null
    if (audioContext) return audioContext
    const fallbackAudioContext = (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    const AudioContextCtor = window.AudioContext ?? fallbackAudioContext
    if (!AudioContextCtor) return null
    try {
      audioContext = new AudioContextCtor()
      return audioContext
    } catch {
      return null
    }
  }

  async function ensureAudioContextRunning(): Promise<boolean> {
    const context = getAudioContext()
    if (!context) return false
    try {
      if (context.state === 'suspended') {
        await context.resume()
      }
      return context.state === 'running'
    } catch {
      return false
    }
  }

  function startAudioContextKeepAlive(): boolean {
    const context = getAudioContext()
    if (!context) return false
    if (keepAliveSource) return true
    try {
      const gain = context.createGain()
      gain.gain.value = KEEP_ALIVE_GAIN
      const source = context.createOscillator()
      source.frequency.value = 20
      source.connect(gain)
      gain.connect(context.destination)
      source.start()
      keepAliveGain = gain
      keepAliveSource = source
      return true
    } catch {
      keepAliveGain = null
      keepAliveSource = null
      return false
    }
  }

  function stopAudioContextKeepAlive(): void {
    const source = keepAliveSource
    const gain = keepAliveGain
    keepAliveSource = null
    keepAliveGain = null
    if (!source) return
    try {
      source.stop()
    } catch {
      // The source may already be stopped by the browser.
    }
    try {
      source.disconnect()
    } catch {
      // Ignore disconnect races during teardown.
    }
    try {
      gain?.disconnect()
    } catch {
      // Ignore disconnect races during teardown.
    }
  }

  function stopActiveBufferSource(): void {
    const source = activeBufferSource
    activeBufferSource = null
    if (!source) return
    try {
      source.onended = null
      source.stop()
    } catch {
      // The buffer may already have ended.
    }
    try {
      source.disconnect()
    } catch {
      // Ignore disconnect races during teardown.
    }
  }

  async function primeAudioElement(): Promise<boolean> {
    if (!audio) return false
    try {
      audio.pause()
      audio.loop = true
      audio.muted = true
      audio.src = SILENT_WAV_DATA_URL
      audio.currentTime = 0
      await audio.play()
      return true
    } catch {
      audio.loop = false
      audio.muted = false
      // The real TTS play attempt will surface a blocked state if needed.
      return false
    }
  }

  async function beginAutoplaySession(): Promise<void> {
    if (!audio) {
      state.value = 'error'
      errorMessage.value = 'Audio playback is not supported in this browser.'
      return
    }
    errorMessage.value = ''
    if (state.value === 'playing') {
      autoplaySessionActive = true
      return
    }
    const contextReady = await ensureAudioContextRunning()
    autoplaySessionActive = contextReady && startAudioContextKeepAlive()
    if (!autoplaySessionActive) {
      autoplaySessionActive = await primeAudioElement()
    }
  }

  function endAutoplaySession(): void {
    autoplaySessionActive = false
    stopAudioContextKeepAlive()
    if (!audio) return
    if (audio.src === SILENT_WAV_DATA_URL || audio.currentSrc === SILENT_WAV_DATA_URL) {
      audio.pause()
      audio.loop = false
      audio.muted = false
      audio.removeAttribute('src')
      audio.load()
    }
  }

  function revokeActiveObjectUrl(): void {
    if (!activeObjectUrl) return
    URL.revokeObjectURL(activeObjectUrl)
    activeObjectUrl = ''
  }

  function stop(): void {
    playSequence += 1
    autoplaySessionActive = false
    abortController?.abort()
    abortController = null
    stopActiveBufferSource()
    stopAudioContextKeepAlive()
    if (audio) {
      audio.pause()
      audio.loop = false
      audio.muted = false
      audio.removeAttribute('src')
      audio.load()
    }
    revokeActiveObjectUrl()
    pendingResume.value = null
    activeMessageId.value = ''
    errorMessage.value = ''
    state.value = 'idle'
  }

  async function playBlob(blob: Blob, input: PlayVoiceInput, sequence: number): Promise<void> {
    const playedWithWebAudio = await playBlobWithAudioContext(blob, input, sequence)
    if (playedWithWebAudio || sequence !== playSequence) return
    if (!audio) return
    revokeActiveObjectUrl()
    activeObjectUrl = URL.createObjectURL(blob)
    audio.loop = false
    audio.muted = false
    audio.src = activeObjectUrl
    audio.currentTime = 0
    activeMessageId.value = input.messageId
    pendingResume.value = input
    try {
      await audio.play()
      if (sequence !== playSequence) return
      pendingResume.value = null
      state.value = 'playing'
    } catch (error) {
      if (sequence !== playSequence) return
      pendingResume.value = input
      state.value = 'blocked'
      errorMessage.value = error instanceof Error ? error.message : 'Audio playback is blocked until you tap resume.'
    }
  }

  async function playBlobWithAudioContext(blob: Blob, input: PlayVoiceInput, sequence: number): Promise<boolean> {
    const context = getAudioContext()
    if (!context) return false
    const contextReady = await ensureAudioContextRunning()
    if (!contextReady || sequence !== playSequence) return false
    try {
      const audioBuffer = await context.decodeAudioData(await blob.arrayBuffer())
      if (sequence !== playSequence) return true
      stopActiveBufferSource()
      const source = context.createBufferSource()
      source.buffer = audioBuffer
      source.connect(context.destination)
      activeBufferSource = source
      activeMessageId.value = input.messageId
      pendingResume.value = input
      source.onended = () => {
        if (sequence !== playSequence || activeBufferSource !== source) return
        activeBufferSource = null
        if (state.value === 'playing') {
          state.value = 'idle'
          activeMessageId.value = ''
          pendingResume.value = null
        }
        if (autoplaySessionActive) {
          void ensureAudioContextRunning().then((ready) => {
            if (ready && autoplaySessionActive) startAudioContextKeepAlive()
          })
        }
      }
      source.start()
      if (!autoplaySessionActive) {
        stopAudioContextKeepAlive()
      }
      pendingResume.value = null
      state.value = 'playing'
      return true
    } catch {
      return false
    }
  }

  async function play(input: PlayVoiceInput): Promise<void> {
    if (!audio) {
      state.value = 'error'
      errorMessage.value = 'Audio playback is not supported in this browser.'
      return
    }

    const sequence = playSequence + 1
    playSequence = sequence
    abortController?.abort()
    abortController = new AbortController()
    errorMessage.value = ''
    activeMessageId.value = input.messageId
    state.value = 'synthesizing'

    const key = createCacheKey(input)
    try {
      if (!input.autoplay) {
        const contextReady = await ensureAudioContextRunning()
        if (contextReady) {
          startAudioContextKeepAlive()
        } else {
          await primeAudioElement()
        }
        if (sequence !== playSequence) return
      }
      const cached = cache.get(key)
      const blob = cached ?? await createVoiceSpeech({
        text: input.text,
        threadId: input.threadId,
        speed: input.speed,
        voice: 'nova',
      }, abortController.signal)
      if (sequence !== playSequence) return
      if (!cached) setBoundedCacheEntry(cache, key, blob, VOICE_CACHE_LIMIT)
      await playBlob(blob, input, sequence)
    } catch (error) {
      if (sequence !== playSequence) return
      if (error instanceof DOMException && error.name === 'AbortError') return
      state.value = 'error'
      errorMessage.value = error instanceof Error ? error.message : 'Voice playback failed.'
      activeMessageId.value = ''
    }
  }

  async function resumeBlocked(): Promise<void> {
    if (!pendingResume.value || !audio) return
    const resumeInput = pendingResume.value
    const sequence = playSequence + 1
    playSequence = sequence
    errorMessage.value = ''
    try {
      if (await playVoiceAudioFromPendingResume(resumeInput, sequence)) return
      audio.loop = false
      audio.muted = false
      await audio.play()
      if (sequence !== playSequence) return
      pendingResume.value = null
      state.value = 'playing'
      activeMessageId.value = activeMessageId.value || resumeInput.messageId
    } catch (error) {
      if (sequence !== playSequence) return
      state.value = 'blocked'
      errorMessage.value = error instanceof Error ? error.message : 'Audio playback is blocked until you tap resume.'
    }
  }

  async function playVoiceAudioFromPendingResume(input: PlayVoiceInput, sequence: number): Promise<boolean> {
    const key = createCacheKey(input)
    const blob = cache.get(key)
    if (!blob) return false
    const contextReady = await ensureAudioContextRunning()
    if (!contextReady || sequence !== playSequence) return false
    return playBlobWithAudioContext(blob, input, sequence)
  }

  onBeforeUnmount(stop)

  return {
    state,
    activeMessageId,
    errorMessage,
    isBusy,
    unlockAudio,
    beginAutoplaySession,
    endAutoplaySession,
    play,
    stop,
    resumeBlocked,
  }
}
