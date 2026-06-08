import { extractErrorMessage } from './codexErrors'

export type VoiceSpeechInput = {
  text: string
  threadId?: string
  speed: number
  voice?: 'nova'
}

export async function createVoiceSpeech(input: VoiceSpeechInput, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch('/codex-api/voice/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: input.text,
      threadId: input.threadId,
      speed: input.speed,
      voice: input.voice ?? 'nova',
      responseFormat: 'mp3',
    }),
    signal,
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as unknown
    throw new Error(extractErrorMessage(payload, 'Voice playback failed'))
  }

  return await response.blob()
}
