import { Capacitor, registerPlugin } from '@capacitor/core'

type CodexAudioSessionPlugin = {
  prepareDictationAudioSession: () => Promise<{ ok: boolean }>
  finishDictationAudioSession: () => Promise<{ ok: boolean }>
}

const codexAudioSession = registerPlugin<CodexAudioSessionPlugin>('CodexAudioSession')

export function shouldUseNativeAudioSession(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'
}

export async function prepareDictationAudioSession(): Promise<void> {
  if (!shouldUseNativeAudioSession()) return
  try {
    await codexAudioSession.prepareDictationAudioSession()
  } catch (error) {
    console.warn('Failed to prepare iOS dictation audio session.', error)
  }
}

export async function finishDictationAudioSession(): Promise<void> {
  if (!shouldUseNativeAudioSession()) return
  try {
    await codexAudioSession.finishDictationAudioSession()
  } catch (error) {
    console.warn('Failed to finish iOS dictation audio session.', error)
  }
}
