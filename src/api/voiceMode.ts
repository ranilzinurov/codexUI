import { resolveBackendHttpUrl } from '../backendUrl'
import { CodexApiError, extractErrorMessage } from './codexErrors'

export const VOICE_JOB_STATES = [
  'queued',
  'waiting_for_answer',
  'summarizing',
  'synthesizing',
  'ready',
  'failed',
  'expired',
] as const

export type VoiceJobState = typeof VOICE_JOB_STATES[number]
export type VoiceProfile = 'economy' | 'medium' | 'forte'

export type VoiceAnswerJob = {
  id: string
  threadId: string | null
  state: VoiceJobState
  profile: VoiceProfile | string
  speed: number
  voice: string
  autoplay: boolean
  telegramFallback: boolean
  messageId: string | null
  error: string | null
  createdAtIso: string | null
  updatedAtIso: string | null
  expiresAtIso: string | null
  audioContentType: string | null
  summaryText: string | null
}

export type CreateVoiceSpeechInput = {
  text: string
  threadId?: string
  messageId?: string
  speed?: number
  voice?: string
  responseFormat?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm'
}

export type CreateVoiceJobInput = {
  threadId: string
  text?: string
  messageId?: string
  profile: VoiceProfile | string
  speed: number
  voice: string
  autoplay: boolean
  telegramFallback: boolean
}

type JsonEnvelope<T> = {
  data: T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeVoiceJobState(value: unknown): VoiceJobState | null {
  if (typeof value !== 'string') return null
  return VOICE_JOB_STATES.includes(value as VoiceJobState) ? (value as VoiceJobState) : null
}

function resolveVoiceApiUrl(path: string): string {
  return resolveBackendHttpUrl(path)
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

async function parseErrorResponse(response: Response, fallback: string, method: string): Promise<CodexApiError> {
  const contentType = response.headers.get('content-type') ?? ''
  let payload: unknown = null
  if (contentType.includes('application/json')) {
    payload = await parseJsonResponse(response)
  } else {
    payload = await response.text().catch(() => null)
  }
  return new CodexApiError(extractErrorMessage(payload, fallback), {
    code: 'http_error',
    method,
    status: response.status,
  })
}

function normalizeVoiceJob(value: unknown): VoiceAnswerJob | null {
  if (!isRecord(value)) return null
  const id = readString(value.id)
  const state = normalizeVoiceJobState(value.state) ?? normalizeVoiceJobState(value.status)
  if (!id || !state) return null

  return {
    id,
    threadId: readString(value.threadId),
    state,
    profile: readString(value.profile) ?? 'medium',
    speed: readNumber(value.speed) ?? 1,
    voice: readString(value.voice) ?? 'nova',
    autoplay: readBoolean(value.autoplay) ?? false,
    telegramFallback: readBoolean(value.telegramFallback) ?? false,
    messageId: readString(value.messageId),
    error: readString(value.error),
    createdAtIso: readString(value.createdAtIso) ?? readString(value.createdAt),
    updatedAtIso: readString(value.updatedAtIso) ?? readString(value.updatedAt),
    expiresAtIso: readString(value.expiresAtIso) ?? readString(value.expiresAt),
    audioContentType: readString(value.audioContentType),
    summaryText: readString(value.summaryText),
  }
}

async function fetchVoiceJson<T>(
  path: string,
  init: RequestInit | undefined,
  normalize: (value: unknown) => T | null,
  fallback: string,
): Promise<T> {
  let response: Response
  const method = path
  try {
    response = await fetch(resolveVoiceApiUrl(path), {
      ...init,
      credentials: init?.credentials ?? 'include',
    })
  } catch (error) {
    throw new CodexApiError(
      error instanceof Error ? error.message : `Request to ${path} failed before it was sent`,
      { code: 'network_error', method },
    )
  }

  const payload = await parseJsonResponse(response)
  if (!response.ok) {
    throw new CodexApiError(extractErrorMessage(payload, fallback), {
      code: 'http_error',
      method,
      status: response.status,
    })
  }

  const envelope = isRecord(payload) ? (payload as JsonEnvelope<unknown> & { job?: unknown }) : null
  const normalized = normalize(envelope?.data) ?? normalize(envelope?.job) ?? normalize(payload)
  if (!normalized) {
    throw new CodexApiError(`Request to ${path} returned malformed JSON`, {
      code: 'invalid_response',
      method,
      status: response.status,
    })
  }
  return normalized
}

async function fetchVoiceBlob(path: string, init: RequestInit | undefined, fallback: string): Promise<Blob> {
  let response: Response
  const method = path
  try {
    response = await fetch(resolveVoiceApiUrl(path), {
      ...init,
      credentials: init?.credentials ?? 'include',
    })
  } catch (error) {
    throw new CodexApiError(
      error instanceof Error ? error.message : `Request to ${path} failed before it was sent`,
      { code: 'network_error', method },
    )
  }

  if (!response.ok) {
    throw await parseErrorResponse(response, fallback, method)
  }

  return await response.blob()
}

export function isVoiceJobTerminal(state: VoiceJobState): boolean {
  return state === 'ready' || state === 'failed' || state === 'expired'
}

export function createVoiceSpeech(input: CreateVoiceSpeechInput, signal?: AbortSignal): Promise<Blob> {
  return fetchVoiceBlob(
    '/codex-api/voice/speech',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: input.text,
        threadId: input.threadId,
        messageId: input.messageId,
        speed: input.speed ?? 1,
        voice: input.voice ?? 'nova',
        responseFormat: input.responseFormat ?? 'mp3',
      }),
      signal,
    },
    'Voice speech request failed',
  )
}

export function createVoiceJob(input: CreateVoiceJobInput, signal?: AbortSignal): Promise<VoiceAnswerJob> {
  return fetchVoiceJson(
    '/codex-api/voice/jobs',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threadId: input.threadId,
        text: input.text,
        messageId: input.messageId,
        profile: input.profile,
        speed: input.speed,
        voice: input.voice,
        autoplay: input.autoplay,
        telegramFallback: input.telegramFallback,
      }),
      signal,
    },
    normalizeVoiceJob,
    'Voice job request failed',
  )
}

export function fetchVoiceJob(id: string, signal?: AbortSignal): Promise<VoiceAnswerJob> {
  return fetchVoiceJson(
    `/codex-api/voice/jobs/${encodeURIComponent(id)}`,
    { signal },
    normalizeVoiceJob,
    'Voice job status request failed',
  )
}

export function fetchVoiceJobAudio(id: string, signal?: AbortSignal): Promise<Blob> {
  return fetchVoiceBlob(
    `/codex-api/voice/jobs/${encodeURIComponent(id)}/audio`,
    { signal },
    'Voice job audio request failed',
  )
}
