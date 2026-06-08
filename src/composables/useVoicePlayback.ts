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

  if (audio) {
    audio.preload = 'auto'
    audio.addEventListener('ended', () => {
      if (state.value === 'playing') {
        state.value = 'idle'
        activeMessageId.value = ''
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
      // iOS may still require a later explicit tap; playback handles that as blocked.
    }
  }

  async function primeAudioElement(): Promise<void> {
    if (!audio) return
    try {
      audio.pause()
      audio.loop = true
      audio.muted = true
      audio.src = SILENT_WAV_DATA_URL
      audio.currentTime = 0
      await audio.play()
    } catch {
      audio.loop = false
      audio.muted = false
      // The real TTS play attempt will surface a blocked state if needed.
    }
  }

  function revokeActiveObjectUrl(): void {
    if (!activeObjectUrl) return
    URL.revokeObjectURL(activeObjectUrl)
    activeObjectUrl = ''
  }

  function stop(): void {
    playSequence += 1
    abortController?.abort()
    abortController = null
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
        await primeAudioElement()
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

  onBeforeUnmount(stop)

  return {
    state,
    activeMessageId,
    errorMessage,
    isBusy,
    unlockAudio,
    play,
    stop,
    resumeBlocked,
  }
}
