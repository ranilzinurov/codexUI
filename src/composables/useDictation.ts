import { onBeforeUnmount, ref } from 'vue'
import {
  createStoredDictationRecording,
  deleteStoredDictationRecording,
  isDictationTranscriptionAbortError,
  readStoredDictationRecording,
  transcribeStoredDictationRecording,
  writeStoredDictationRecording,
  type StoredDictationRecording,
} from './dictationTranscription'
import {
  finishDictationAudioSession,
  prepareDictationAudioSession,
  shouldUseNativeAudioSession,
} from '../native/codexAudioSession'

export type DictationState = 'idle' | 'recording' | 'paused' | 'transcribing'
const DICTATION_SILENCE_THRESHOLD = 0.0025
const DICTATION_BAR_WIDTH = 3
const DICTATION_BAR_GAP = 2
const MAX_WAVEFORM_SAMPLES = 256
const DICTATION_MEDIA_CONSTRAINTS: MediaStreamConstraints = { audio: { channelCount: 1 } }
const DICTATION_AUDIO_BITS_PER_SECOND = 64000
const DICTATION_STOP_GRACE_MS = 500
const DICTATION_MIME_TYPE_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
]

export type DictationAudioInputInfo = {
  label: string
  deviceId: string
  groupId: string
  sampleRate: number | null
  channelCount: number | null
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function resolveMediaRecorderOptions(): MediaRecorderOptions {
  const options: MediaRecorderOptions = {
    audioBitsPerSecond: DICTATION_AUDIO_BITS_PER_SECOND,
  }
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return options
  }

  const mimeType = DICTATION_MIME_TYPE_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate))
  return mimeType ? { ...options, mimeType } : options
}

function readAudioInputInfo(stream: MediaStream): DictationAudioInputInfo | null {
  const track = stream.getAudioTracks()[0]
  if (!track) return null
  const settings = track.getSettings()
  return {
    label: track.label.trim(),
    deviceId: readTrimmedString(settings.deviceId),
    groupId: readTrimmedString(settings.groupId),
    sampleRate: typeof settings.sampleRate === 'number' ? settings.sampleRate : null,
    channelCount: typeof settings.channelCount === 'number' ? settings.channelCount : null,
  }
}

function createDictationMediaRecorder(stream: MediaStream): MediaRecorder {
  const preferredOptions = resolveMediaRecorderOptions()
  const candidateOptions = [
    preferredOptions,
    preferredOptions.mimeType ? { mimeType: preferredOptions.mimeType } : null,
    { audioBitsPerSecond: DICTATION_AUDIO_BITS_PER_SECOND },
  ].filter((options): options is MediaRecorderOptions => Boolean(options))

  for (const options of candidateOptions) {
    try {
      return new MediaRecorder(stream, options)
    } catch {
      // Try the next compatible option set.
    }
  }

  return new MediaRecorder(stream)
}

function hasPauseControls(recorder: MediaRecorder): boolean {
  return typeof recorder.pause === 'function' && typeof recorder.resume === 'function'
}

export function useDictation(options: {
  onTranscript: (text: string) => void
  getStorageKey?: () => string
  getLanguage?: () => string
  onAudioInput?: (info: DictationAudioInputInfo) => void
  onRetry?: (attempt: number, maxAttempts: number) => void
  onRecordingReady?: (recording: StoredDictationRecording) => void | Promise<void>
  onEmpty?: () => void
  onError?: (error: unknown) => void
}) {
  const state = ref<DictationState>('idle')
  const isSupported = ref(typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia)
  const hasPendingTranscription = ref(false)
  const isPauseSupported = ref(false)
  const recordingDurationMs = ref(0)
  const waveformCanvasRef = ref<HTMLCanvasElement | null>(null)

  let mediaRecorder: MediaRecorder | null = null
  let mediaStream: MediaStream | null = null
  let chunks: Blob[] = []
  let audioContext: AudioContext | null = null
  let mediaStreamSource: MediaStreamAudioSourceNode | null = null
  let processorNode: ScriptProcessorNode | null = null
  let recordingStartedAt: number | null = null
  let accumulatedRecordingDurationMs = 0
  let waveformSamples: number[] = []
  let isStartingRecording = false
  let stopRequestedBeforeStart = false
  let isStoppingRecording = false
  let stopGraceTimeout: number | null = null
  let transcribeAbortController: AbortController | null = null
  let pendingTranscription: StoredDictationRecording | null = null
  let didPrepareNativeAudioSession = false

  function getCurrentStorageKey(): string {
    return readTrimmedString(options.getStorageKey?.()) || 'default'
  }

  async function refreshPendingTranscription(): Promise<StoredDictationRecording | null> {
    const storageKey = getCurrentStorageKey()
    const recording = await readStoredDictationRecording(storageKey)
    if (storageKey !== getCurrentStorageKey()) {
      return getPendingTranscriptionForCurrentStorageKey()
    }
    pendingTranscription = recording
    hasPendingTranscription.value = Boolean(recording)
    return recording
  }

  async function getPendingTranscriptionForCurrentStorageKey(): Promise<StoredDictationRecording | null> {
    if (pendingTranscription?.key === getCurrentStorageKey()) {
      return pendingTranscription
    }
    return refreshPendingTranscription()
  }

  function cancelTranscription(): void {
    if (transcribeAbortController) {
      transcribeAbortController.abort()
      transcribeAbortController = null
    }
    if (state.value === 'transcribing') {
      state.value = 'idle'
    }
  }

  function drawWaveform(): void {
    const canvas = waveformCanvasRef.value
    if (!canvas || typeof window === 'undefined') return
    const context = canvas.getContext('2d')
    if (!context) return

    const cssWidth = Math.max(1, Math.floor(canvas.clientWidth))
    const cssHeight = Math.max(1, Math.floor(canvas.clientHeight || 36))
    const dpr = window.devicePixelRatio || 1
    const pixelWidth = Math.max(1, Math.floor(cssWidth * dpr))
    const pixelHeight = Math.max(1, Math.floor(cssHeight * dpr))

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth
      canvas.height = pixelHeight
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, cssWidth, cssHeight)

    const maxBars = Math.max(12, Math.floor(cssWidth / (DICTATION_BAR_WIDTH + DICTATION_BAR_GAP)))
    const recentSamples = waveformSamples.slice(-maxBars)
    const leadingBars = Math.max(0, maxBars - recentSamples.length)
    const centerY = cssHeight / 2
    const fill = getComputedStyle(canvas).color || '#000000'

    for (let index = 0; index < maxBars; index += 1) {
      const value = recentSamples[index - leadingBars] ?? 0
      const heightRatio = Math.max(0.08, Math.min(1, value * 18))
      const barHeight = heightRatio * centerY
      const x = index * (DICTATION_BAR_WIDTH + DICTATION_BAR_GAP)

      context.globalAlpha = value <= DICTATION_SILENCE_THRESHOLD ? 0.35 : 1
      context.fillStyle = fill
      context.fillRect(x, centerY - barHeight, DICTATION_BAR_WIDTH, barHeight * 2)
    }

    context.globalAlpha = 1
  }

  function updateRecordingDuration(now = performance.now()): void {
    if (recordingStartedAt !== null) {
      recordingDurationMs.value = Math.max(0, accumulatedRecordingDurationMs + now - recordingStartedAt)
      return
    }
    recordingDurationMs.value = Math.max(0, accumulatedRecordingDurationMs)
  }

  function resetWaveformDisplay(): void {
    waveformSamples = []
    accumulatedRecordingDurationMs = 0
    recordingStartedAt = null
    recordingDurationMs.value = 0
    drawWaveform()
  }

  function pauseWaveformCapture(): void {
    updateRecordingDuration()
    accumulatedRecordingDurationMs = recordingDurationMs.value
    recordingStartedAt = null
    if (audioContext?.state === 'running') {
      void audioContext.suspend()
    }
    drawWaveform()
  }

  function resumeWaveformCapture(): void {
    if (recordingStartedAt === null) {
      recordingStartedAt = performance.now()
    }
    if (audioContext?.state === 'suspended') {
      void audioContext.resume()
    }
    drawWaveform()
  }

  function stopWaveformCapture(): void {
    if (processorNode) {
      processorNode.disconnect()
      processorNode.onaudioprocess = null
      processorNode = null
    }
    if (mediaStreamSource) {
      mediaStreamSource.disconnect()
      mediaStreamSource = null
    }
    if (audioContext) {
      void audioContext.close()
      audioContext = null
    }
    recordingStartedAt = null
  }

  function startWaveformCapture(stream: MediaStream): void {
    if (typeof window === 'undefined') return

    const fallbackAudioContext = (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    const AudioContextCtor = window.AudioContext ?? fallbackAudioContext
    if (!AudioContextCtor) return

    stopWaveformCapture()
    resetWaveformDisplay()

    audioContext = new AudioContextCtor()
    mediaStreamSource = audioContext.createMediaStreamSource(stream)
    processorNode = audioContext.createScriptProcessor(2048, 1, 1)
    recordingStartedAt = performance.now()

    processorNode.onaudioprocess = (event) => {
      if (state.value === 'paused') {
        drawWaveform()
        return
      }

      const channelData = event.inputBuffer.getChannelData(0)
      let total = 0
      for (let index = 0; index < channelData.length; index += 1) {
        const amplitude = Math.abs(channelData[index] ?? 0)
        total += amplitude < DICTATION_SILENCE_THRESHOLD ? 0 : amplitude
      }

      waveformSamples.push(total / channelData.length)
      if (waveformSamples.length > MAX_WAVEFORM_SAMPLES) {
        waveformSamples.shift()
      }

      updateRecordingDuration()

      drawWaveform()
    }

    mediaStreamSource.connect(processorNode)
    processorNode.connect(audioContext.destination)
    drawWaveform()
  }

  async function startRecording() {
    if (state.value === 'transcribing') return
    if (state.value !== 'idle' || !isSupported.value || isStartingRecording) return
    isStartingRecording = true
    stopRequestedBeforeStart = false

    try {
      if (hasPendingTranscription.value) {
        const pending = await getPendingTranscriptionForCurrentStorageKey()
        if (pending) {
          if (options.onRecordingReady) {
            await handOffStoredRecording(pending)
          } else {
            await transcribeStoredRecording(pending)
          }
          return
        }
      }

      if (shouldUseNativeAudioSession()) {
        await prepareDictationAudioSession()
        didPrepareNativeAudioSession = true
      }
      mediaStream = await navigator.mediaDevices.getUserMedia(DICTATION_MEDIA_CONSTRAINTS)
      const audioInputInfo = readAudioInputInfo(mediaStream)
      if (audioInputInfo) options.onAudioInput?.(audioInputInfo)
      chunks = []
      mediaRecorder = createDictationMediaRecorder(mediaStream)
      isPauseSupported.value = hasPauseControls(mediaRecorder)
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }
      mediaRecorder.onstop = () => {
        const recordedChunks = chunks
        const recordedMimeType = mediaRecorder?.mimeType || recordedChunks[0]?.type || 'audio/webm'
        cleanup()
        void transcribeRecordedChunks(recordedChunks, recordedMimeType)
      }
      startWaveformCapture(mediaStream)
      mediaRecorder.start(250)
      state.value = 'recording'
      isStoppingRecording = false
      if (stopRequestedBeforeStart) {
        stopRecording()
      }
    } catch (error) {
      cleanup()
      state.value = 'idle'
      options.onError?.(error)
    } finally {
      isStartingRecording = false
    }
  }

  function finishMediaRecorderStop(): void {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return
    try {
      mediaRecorder.requestData()
    } catch {
      // Some browsers do not allow requestData in every recorder state.
    }
    mediaRecorder.stop()
  }

  function stopRecording() {
    if (isStartingRecording && state.value === 'idle') {
      stopRequestedBeforeStart = true
      return
    }
    if ((state.value !== 'recording' && state.value !== 'paused') || !mediaRecorder) return
    if (mediaRecorder.state === 'inactive' || isStoppingRecording) return

    isStoppingRecording = true
    const wasPaused = state.value === 'paused' || mediaRecorder.state === 'paused'
    pauseWaveformCapture()
    state.value = 'transcribing'
    if (wasPaused) {
      finishMediaRecorderStop()
      return
    }

    stopGraceTimeout = window.setTimeout(() => {
      stopGraceTimeout = null
      finishMediaRecorderStop()
    }, DICTATION_STOP_GRACE_MS)
  }

  function pauseRecording() {
    if (state.value !== 'recording' || !mediaRecorder) return
    if (mediaRecorder.state !== 'recording') return
    if (!hasPauseControls(mediaRecorder)) {
      options.onError?.(new Error('Dictation pause is not supported in this browser.'))
      return
    }

    try {
      mediaRecorder.requestData()
    } catch {
      // Some browsers do not allow requestData in every recorder state.
    }

    try {
      mediaRecorder.pause()
      pauseWaveformCapture()
      state.value = 'paused'
    } catch (error) {
      options.onError?.(error)
    }
  }

  function resumeRecording() {
    if (state.value !== 'paused' || !mediaRecorder) return
    if (mediaRecorder.state === 'inactive') return
    if (!hasPauseControls(mediaRecorder)) {
      options.onError?.(new Error('Dictation pause is not supported in this browser.'))
      return
    }

    try {
      if (mediaRecorder.state === 'paused') {
        mediaRecorder.resume()
      }
      resumeWaveformCapture()
      state.value = 'recording'
    } catch (error) {
      options.onError?.(error)
    }
  }

  function togglePauseRecording() {
    if (state.value === 'paused') {
      resumeRecording()
      return
    }
    pauseRecording()
  }

  function clearStopGraceTimeout(): void {
    if (stopGraceTimeout) {
      window.clearTimeout(stopGraceTimeout)
      stopGraceTimeout = null
    }
  }

  function cancel() {
    stopRequestedBeforeStart = false
    cancelTranscription()
    cleanup()
    state.value = 'idle'
  }

  async function transcribeStoredRecording(recording: StoredDictationRecording) {
    state.value = 'transcribing'
    hasPendingTranscription.value = true
    pendingTranscription = recording
    let requestAbortController: AbortController | null = null

    try {
      requestAbortController = new AbortController()
      transcribeAbortController = requestAbortController

      const text = await transcribeStoredDictationRecording(recording, requestAbortController.signal, options.onRetry)
      await deleteStoredDictationRecording(recording.key, recording.id)
      if (pendingTranscription?.id === recording.id) {
        pendingTranscription = null
        hasPendingTranscription.value = false
      }

      if (text.length > 0) {
        options.onTranscript(text)
      } else {
        options.onEmpty?.()
      }
    } catch (error) {
      if (isDictationTranscriptionAbortError(error)) {
        return
      }
      options.onError?.(new Error(`${error instanceof Error ? error.message : 'Dictation failed.'} Recording was saved; click the mic to retry transcription.`))
    } finally {
      if (requestAbortController && transcribeAbortController === requestAbortController) {
        transcribeAbortController = null
      }
      if (state.value === 'transcribing') {
        state.value = 'idle'
      }
    }
  }

  async function handOffStoredRecording(recording: StoredDictationRecording): Promise<void> {
    state.value = 'transcribing'
    pendingTranscription = recording
    hasPendingTranscription.value = true
    try {
      await options.onRecordingReady?.(recording)
      if (pendingTranscription?.id === recording.id) {
        pendingTranscription = null
      }
      hasPendingTranscription.value = false
    } catch (error) {
      options.onError?.(error)
    } finally {
      if (state.value === 'transcribing') {
        state.value = 'idle'
      }
    }
  }

  async function transcribeRecordedChunks(recordedChunks: Blob[], mimeType: string) {
    if (recordedChunks.length === 0) {
      options.onEmpty?.()
      state.value = 'idle'
      return
    }

    const blob = new Blob(recordedChunks, { type: mimeType })
    const recording = createStoredDictationRecording(
      getCurrentStorageKey(),
      blob,
      mimeType,
      readTrimmedString(options.getLanguage?.()),
    )
    pendingTranscription = recording
    hasPendingTranscription.value = true
    await writeStoredDictationRecording(recording)
    if (options.onRecordingReady) {
      await handOffStoredRecording(recording)
      return
    }
    await transcribeStoredRecording(recording)
  }

  function cleanup() {
    clearStopGraceTimeout()
    isStoppingRecording = false
    stopWaveformCapture()
    resetWaveformDisplay()
    if (mediaRecorder) {
      const recorder = mediaRecorder
      mediaRecorder = null
      recorder.ondataavailable = null
      recorder.onstop = null
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop()
        } catch {
          // Ignore recorder shutdown errors during cancellation cleanup.
        }
      }
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop())
      mediaStream = null
    }
    if (didPrepareNativeAudioSession) {
      didPrepareNativeAudioSession = false
      void finishDictationAudioSession()
    }
    isPauseSupported.value = false
    chunks = []
  }

  onBeforeUnmount(() => {
    cancel()
  })

  void refreshPendingTranscription()

  function toggleRecording() {
    if (state.value === 'recording' || state.value === 'paused') {
      stopRecording()
      return
    }
    if (state.value === 'idle' || state.value === 'transcribing') {
      void startRecording()
    }
  }

  return {
    state,
    isSupported,
    hasPendingTranscription,
    isPauseSupported,
    recordingDurationMs,
    waveformCanvasRef,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    togglePauseRecording,
    toggleRecording,
    cancel,
    refreshPendingTranscription,
  }
}
