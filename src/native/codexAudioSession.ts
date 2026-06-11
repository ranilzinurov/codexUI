import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export type CodexAudioPortDiagnostics = {
  portName?: string
  portType?: string
  uid?: string
  selectedDataSource?: Record<string, unknown>
  dataSources?: Array<Record<string, unknown>>
}

export type CodexAudioRouteDiagnostics = {
  phase?: string
  category?: string
  mode?: string
  isOtherAudioPlaying?: boolean
  secondaryAudioShouldBeSilencedHint?: boolean
  sampleRate?: number
  preferredSampleRate?: number
  ioBufferDuration?: number
  preferredIOBufferDuration?: number
  preferredInput?: CodexAudioPortDiagnostics
  availableInputs?: CodexAudioPortDiagnostics[]
  currentInputs?: CodexAudioPortDiagnostics[]
  currentOutputs?: CodexAudioPortDiagnostics[]
  waitingSessionActive?: boolean
  playbackSessionActive?: boolean
  silentKeepAliveActive?: boolean
  remoteCommandsActive?: boolean
  backgroundAudioEnabled?: boolean
  platform?: string
  native?: boolean
}

export type CodexAudioSessionResult = {
  ok: boolean
  diagnostics?: CodexAudioRouteDiagnostics
  error?: string
  warning?: string
  skipped?: boolean
  duration?: number
  currentTime?: number
  isPlaying?: boolean
}

export type VoiceWaitingSessionOptions = {
  keepAlive?: boolean
}

export type VoicePlaybackSessionOptions = {
  duckOthers?: boolean
  mixWithOthers?: boolean
}

export type NativeVoiceAudioPlaybackOptions = VoicePlaybackSessionOptions & {
  base64: string
  contentType?: string
}

export type VoicePlaybackRemoteCommand = 'play' | 'pause' | 'toggle'

export type VoicePlaybackRemoteCommandEvent = {
  command: VoicePlaybackRemoteCommand
  timestamp?: number
}

type CodexAudioSessionPlugin = {
  prepareDictationAudioSession: () => Promise<CodexAudioSessionResult>
  finishDictationAudioSession: () => Promise<CodexAudioSessionResult>
  beginVoiceWaitingSession: (options?: VoiceWaitingSessionOptions) => Promise<CodexAudioSessionResult>
  endVoiceWaitingSession: () => Promise<CodexAudioSessionResult>
  beginVoicePlaybackSession: (options?: VoicePlaybackSessionOptions) => Promise<CodexAudioSessionResult>
  endVoicePlaybackSession: () => Promise<CodexAudioSessionResult>
  playVoiceAudioBase64: (options: NativeVoiceAudioPlaybackOptions) => Promise<CodexAudioSessionResult & {
    duration?: number
    audioBytes?: number
  }>
  pauseVoicePlayback: () => Promise<CodexAudioSessionResult>
  resumeVoicePlayback: (options?: VoicePlaybackSessionOptions) => Promise<CodexAudioSessionResult>
  seekVoicePlaybackBy: (options: { seconds: number }) => Promise<CodexAudioSessionResult>
  getAudioRouteDiagnostics: () => Promise<CodexAudioSessionResult>
  preferBuiltInMicrophone: () => Promise<CodexAudioSessionResult>
  addListener: (
    eventName: 'voicePlaybackRemoteCommand',
    listenerFunc: (event: VoicePlaybackRemoteCommandEvent) => void,
  ) => Promise<PluginListenerHandle>
}

const codexAudioSession = registerPlugin<CodexAudioSessionPlugin>('CodexAudioSession')

export function shouldUseNativeAudioSession(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'
}

export async function prepareDictationAudioSession(): Promise<void> {
  if (!shouldUseNativeAudioSession()) return
  try {
    const result = await codexAudioSession.prepareDictationAudioSession()
    if (!result.ok) {
      console.warn('Failed to prepare iOS dictation audio session.', result)
    }
  } catch (error) {
    console.warn('Failed to prepare iOS dictation audio session.', error)
  }
}

export async function finishDictationAudioSession(): Promise<void> {
  if (!shouldUseNativeAudioSession()) return
  try {
    const result = await codexAudioSession.finishDictationAudioSession()
    if (!result.ok) {
      console.warn('Failed to finish iOS dictation audio session.', result)
    }
  } catch (error) {
    console.warn('Failed to finish iOS dictation audio session.', error)
  }
}

export async function beginVoiceWaitingSession(
  options: VoiceWaitingSessionOptions = {},
): Promise<CodexAudioSessionResult> {
  return callNativeAudioSession('beginVoiceWaitingSession', () =>
    codexAudioSession.beginVoiceWaitingSession(options),
  )
}

export async function endVoiceWaitingSession(): Promise<CodexAudioSessionResult> {
  return callNativeAudioSession('endVoiceWaitingSession', () => codexAudioSession.endVoiceWaitingSession())
}

export async function beginVoicePlaybackSession(
  options: VoicePlaybackSessionOptions = {},
): Promise<CodexAudioSessionResult> {
  return callNativeAudioSession('beginVoicePlaybackSession', () =>
    codexAudioSession.beginVoicePlaybackSession(options),
  )
}

export async function endVoicePlaybackSession(): Promise<CodexAudioSessionResult> {
  return callNativeAudioSession('endVoicePlaybackSession', () => codexAudioSession.endVoicePlaybackSession())
}

export async function playVoiceAudioBase64(
  options: NativeVoiceAudioPlaybackOptions,
): Promise<CodexAudioSessionResult & { duration?: number; audioBytes?: number }> {
  return callNativeAudioSession('playVoiceAudioBase64', () => codexAudioSession.playVoiceAudioBase64(options))
}

export async function pauseVoicePlayback(): Promise<CodexAudioSessionResult> {
  return callNativeAudioSession('pauseVoicePlayback', () => codexAudioSession.pauseVoicePlayback())
}

export async function resumeVoicePlayback(
  options: VoicePlaybackSessionOptions = {},
): Promise<CodexAudioSessionResult> {
  return callNativeAudioSession('resumeVoicePlayback', () => codexAudioSession.resumeVoicePlayback(options))
}

export async function seekVoicePlaybackBy(seconds: number): Promise<CodexAudioSessionResult> {
  return callNativeAudioSession('seekVoicePlaybackBy', () => codexAudioSession.seekVoicePlaybackBy({ seconds }))
}

export async function getAudioRouteDiagnostics(): Promise<CodexAudioSessionResult> {
  return callNativeAudioSession('getAudioRouteDiagnostics', () => codexAudioSession.getAudioRouteDiagnostics())
}

export async function preferBuiltInMicrophone(): Promise<CodexAudioSessionResult> {
  return callNativeAudioSession('preferBuiltInMicrophone', () => codexAudioSession.preferBuiltInMicrophone())
}

export async function addVoicePlaybackRemoteCommandListener(
  listener: (event: VoicePlaybackRemoteCommandEvent) => void,
): Promise<PluginListenerHandle> {
  if (!shouldUseNativeAudioSession()) {
    return {
      remove: async () => undefined,
    }
  }

  return codexAudioSession.addListener('voicePlaybackRemoteCommand', listener)
}

async function callNativeAudioSession(
  phase: string,
  callNative: () => Promise<CodexAudioSessionResult>,
): Promise<CodexAudioSessionResult> {
  if (!shouldUseNativeAudioSession()) {
    return skippedResult(phase)
  }

  try {
    return await callNative()
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      diagnostics: {
        phase,
        platform: Capacitor.getPlatform(),
        native: true,
      },
    }
  }
}

function skippedResult(phase: string): CodexAudioSessionResult {
  return {
    ok: false,
    skipped: true,
    diagnostics: {
      phase,
      platform: Capacitor.getPlatform(),
      native: false,
    },
  }
}
