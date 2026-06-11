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
export type VoiceTtsModel =
  | 'gpt-4o-mini-tts'
  | 'tts-1'
  | 'tts-1-hd'

export type VoiceAnswerJob = {
  id: string
  threadId: string | null
  state: VoiceJobState
  profile: VoiceProfile | string
  speed: number
  voice: string
  model: VoiceTtsModel | string
  autoplay: boolean
  telegramFallback: boolean
  messageId: string | null
  turnId: string | null
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
  profile?: VoiceProfile | string
  speed?: number
  voice?: string
  model?: VoiceTtsModel | string
  responseFormat?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm'
}

export type CreateVoiceJobInput = {
  threadId: string
  text?: string
  messageId?: string
  afterMessageId?: string
  profile: VoiceProfile | string
  speed: number
  voice: string
  model?: VoiceTtsModel | string
  autoplay: boolean
  telegramFallback: boolean
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
  const textFallback = response.clone().text().catch(() => null)
  try {
    return await response.json()
  } catch {
    return await textFallback
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
    model: readString(value.ttsModel) ?? readString(value.model) ?? 'gpt-4o-mini-tts',
    autoplay: readBoolean(value.autoplay) ?? false,
    telegramFallback: readBoolean(value.telegramFallback) ?? false,
    messageId: readString(value.messageId),
    turnId: readString(value.turnId),
    error: readString(value.error),
    createdAtIso: readString(value.createdAtIso) ?? readString(value.createdAt),
    updatedAtIso: readString(value.updatedAtIso) ?? readString(value.updatedAt),
    expiresAtIso: readString(value.expiresAtIso) ?? readString(value.expiresAt),
    audioContentType: readString(value.audioContentType),
    summaryText: readString(value.summaryText),
  }
}

function parseEmbeddedJson(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return null
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return null
  }
}

function pushTextCandidatesFromArray(candidates: unknown[], value: unknown): void {
  if (!Array.isArray(value)) return
  for (const item of value) {
    if (!isRecord(item)) continue
    candidates.push(item.text, item.value, item.content)
  }
}

function normalizeVoicePayload<T>(
  payload: unknown,
  normalize: (value: unknown) => T | null,
  seen = new Set<unknown>(),
): T | null {
  const direct = normalize(payload)
  if (direct) return direct

  if (typeof payload === 'string') {
    const parsed = parseEmbeddedJson(payload)
    if (parsed === null || seen.has(parsed)) return null
    return normalizeVoicePayload(parsed, normalize, seen)
  }

  if (!isRecord(payload) || seen.has(payload)) return null

  seen.add(payload)
  const candidates = [
    payload.data,
    payload.job,
    payload.result,
    payload.body,
    payload.response,
    payload.value,
    payload.output,
    payload.content,
  ]
  pushTextCandidatesFromArray(candidates, payload.content)
  pushTextCandidatesFromArray(candidates, payload.output)
  for (const candidate of candidates) {
    const normalized = normalizeVoicePayload(candidate, normalize, seen)
    if (normalized) return normalized
  }
  return null
}

function describePayloadShape(value: unknown, depth = 0): string {
  if (depth > 2) return '...'
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    const first = value.length > 0 ? ` first=${describePayloadShape(value[0], depth + 1)}` : ''
    return `array(${value.length})${first}`
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).slice(0, 8)
    const nested = keys
      .filter((key) => ['data', 'job', 'result', 'body', 'response', 'value', 'content', 'output'].includes(key))
      .map((key) => `${key}:${describePayloadShape(value[key], depth + 1)}`)
      .join(' ')
    return `object{${keys.join(',')}}${nested ? ` ${nested}` : ''}`
  }
  if (typeof value === 'string') return `string(${value.length}) ${value.slice(0, 80)}`
  return typeof value
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

  const normalized = normalizeVoicePayload(payload, normalize)
  if (!normalized) {
    throw new CodexApiError(`Request to ${path} returned malformed JSON: ${describePayloadShape(payload)}`, {
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

  const blob = await response.blob()
  const contentType = (response.headers.get('content-type') || blob.type || '').toLowerCase()
  if (!contentType.startsWith('audio/')) {
    const text = await blob.slice(0, 512).text().catch(() => '')
    const payload = parseEmbeddedJson(text) ?? text
    const message = extractErrorMessage(
      payload,
      `${fallback}: expected audio but received ${contentType || 'unknown content type'}`,
    )
    throw new CodexApiError(message, {
      code: 'invalid_response',
      method,
      status: response.status,
    })
  }

  return blob
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
        profile: input.profile ?? 'medium',
        speed: input.speed ?? 1,
        voice: input.voice ?? 'nova',
        model: input.model ?? 'gpt-4o-mini-tts',
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
        afterMessageId: input.afterMessageId,
        profile: input.profile,
        speed: input.speed,
        voice: input.voice,
        model: input.model ?? 'gpt-4o-mini-tts',
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
