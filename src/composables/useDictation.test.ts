import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useDictation } from './useDictation'
import type { StoredDictationRecording } from './dictationTranscription'

const transcriptionMock = vi.hoisted(() => ({
  createStoredDictationRecording: vi.fn(
    (key: string, blob: Blob, mimeType: string, language: string): StoredDictationRecording => ({
      key,
      id: 'recording-test',
      blob,
      mimeType,
      language,
      createdAt: 1,
    }),
  ),
  deleteStoredDictationRecording: vi.fn(async () => undefined),
  isDictationTranscriptionAbortError: vi.fn((error: unknown) => error instanceof DOMException && error.name === 'AbortError'),
  readStoredDictationRecording: vi.fn(async () => null),
  transcribeStoredDictationRecording: vi.fn(async () => 'transcript'),
  writeStoredDictationRecording: vi.fn(async () => true),
}))

const audioSessionMock = vi.hoisted(() => ({
  finishDictationAudioSession: vi.fn(async () => undefined),
  prepareDictationAudioSession: vi.fn(async () => undefined),
  shouldUseNativeAudioSession: vi.fn(() => false),
}))

vi.mock('./dictationTranscription', () => transcriptionMock)
vi.mock('../native/codexAudioSession', () => audioSessionMock)

class FakeMediaStreamTrack {
  stop = vi.fn()

  getSettings(): MediaTrackSettings {
    return {
      channelCount: 1,
      deviceId: 'device-test',
      groupId: 'group-test',
      sampleRate: 48000,
    }
  }

  get label(): string {
    return 'Test microphone'
  }
}

class FakeMediaStream {
  readonly track = new FakeMediaStreamTrack()

  getAudioTracks(): MediaStreamTrack[] {
    return [this.track as unknown as MediaStreamTrack]
  }

  getTracks(): MediaStreamTrack[] {
    return [this.track as unknown as MediaStreamTrack]
  }
}

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = []
  static isTypeSupported = vi.fn(() => true)

  mimeType = 'audio/webm'
  state: RecordingState = 'inactive'
  ondataavailable: ((event: BlobEvent) => void) | null = null
  onstop: ((event: Event) => void) | null = null
  readonly stop = vi.fn(() => {
    this.state = 'inactive'
    this.onstop?.({} as Event)
  })
  readonly requestData = vi.fn()

  constructor() {
    FakeMediaRecorder.instances.push(this)
  }

  start(): void {
    this.state = 'recording'
  }

  pause(): void {
    this.state = 'paused'
  }

  resume(): void {
    this.state = 'recording'
  }
}

describe('useDictation', () => {
  let originalNavigatorDescriptor: PropertyDescriptor | undefined
  let originalMediaRecorder: typeof MediaRecorder | undefined
  let originalMediaDevices: MediaDevices | undefined
  let stream: FakeMediaStream

  beforeEach(() => {
    FakeMediaRecorder.instances = []
    stream = new FakeMediaStream()
    originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    if (!originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: {},
      })
    }
    originalMediaRecorder = globalThis.MediaRecorder
    originalMediaDevices = navigator.mediaDevices
    Object.defineProperty(globalThis, 'MediaRecorder', {
      configurable: true,
      value: FakeMediaRecorder,
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => stream),
      },
    })
    for (const mock of Object.values(transcriptionMock)) {
      mock.mockClear()
    }
    for (const mock of Object.values(audioSessionMock)) {
      mock.mockClear()
    }
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'MediaRecorder', {
      configurable: true,
      value: originalMediaRecorder,
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: originalMediaDevices,
    })
    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor)
    } else {
      Reflect.deleteProperty(globalThis, 'navigator')
    }
  })

  it('cancels an active recording without storing or transcribing audio', async () => {
    const onRecordingReady = vi.fn()
    const onTranscript = vi.fn()
    const dictation = useDictation({
      getStorageKey: () => 'thread:test',
      onRecordingReady,
      onTranscript,
    })

    await dictation.startRecording()
    expect(dictation.state.value).toBe('recording')

    dictation.cancel()
    await nextTick()
    await Promise.resolve()

    expect(dictation.state.value).toBe('idle')
    expect(stream.track.stop).toHaveBeenCalledTimes(1)
    expect(FakeMediaRecorder.instances[0]?.stop).toHaveBeenCalledTimes(1)
    expect(transcriptionMock.writeStoredDictationRecording).not.toHaveBeenCalled()
    expect(transcriptionMock.transcribeStoredDictationRecording).not.toHaveBeenCalled()
    expect(transcriptionMock.createStoredDictationRecording).not.toHaveBeenCalled()
    expect(onRecordingReady).not.toHaveBeenCalled()
    expect(onTranscript).not.toHaveBeenCalled()
  })
})
