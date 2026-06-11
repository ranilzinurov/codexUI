import { createHash, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

export const VOICE_MODE_SPEECH_PATH = '/codex-api/voice/speech'
export const VOICE_MODE_JOBS_PATH = '/codex-api/voice/jobs'

export const DEFAULT_VOICE_TTS_MODEL = 'gpt-4o-mini-tts'
export const DEFAULT_VOICE_TTS_VOICE = 'nova'
export const DEFAULT_VOICE_TTS_FORMAT = 'mp3'
export const DEFAULT_VOICE_SUMMARY_MODEL = 'gpt-5.5'

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
const REQUEST_BODY_MAX_BYTES = 256 * 1024
const SOURCE_TEXT_MAX_CHARS = 24_000
const TTS_INPUT_MAX_CHARS = 4_000
const TTS_AUDIO_MAX_BYTES = 8 * 1024 * 1024
const JOB_TTL_MS = 15 * 60_000
const JOB_EXPIRY_GRACE_MS = 60_000
const JOB_WAIT_TIMEOUT_MS = 10 * 60_000
const JOB_POLL_INTERVAL_MS = 2_000
const MAX_JOBS = 64
const SPEECH_CACHE_TTL_MS = 60 * 60_000
const SPEECH_CACHE_EXPIRY_GRACE_MS = 60_000
const MAX_SPEECH_CACHE_ENTRIES = 64

const VOICE_JOB_ROUTE_RE = /^\/codex-api\/voice\/jobs\/([^/]+)(?:\/(audio))?$/

const ALLOWED_TTS_VOICES = new Set([
  'alloy',
  'ash',
  'ballad',
  'cedar',
  'coral',
  'echo',
  'fable',
  'marin',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
])

const ALLOWED_TTS_FORMATS = new Set([
  'aac',
  'flac',
  'mp3',
  'opus',
  'pcm',
  'wav',
])

export type VoiceProfile = 'economy' | 'medium' | 'forte'

export type VoiceJobStatus =
  | 'queued'
  | 'waiting_for_answer'
  | 'summarizing'
  | 'synthesizing'
  | 'ready'
  | 'failed'
  | 'expired'

type RpcExecutor = {
  rpc: (method: string, params: unknown) => Promise<unknown>
}

export type VoiceModeRouteOptions = {
  appServer: RpcExecutor
  fetch?: typeof fetch
  jobStore?: VoiceJobStore
  speechCache?: VoiceSpeechCache
  nowMs?: () => number
  pollIntervalMs?: number
  waitTimeoutMs?: number
  notify?: (event: VoiceModeNotificationEvent) => Promise<void> | void
}

type VoiceProfileConfig = {
  maxChars: number
  maxOutputTokens: number
  reasoningEffort: 'low' | 'medium' | 'high'
  guidance: string
}

type VoiceSpeechRequest = {
  text: string
  threadId?: string
  messageId?: string
  profile: VoiceProfile
  speed: number
  voice: string
  format: string
}

type NormalizedVoiceJobRequest = {
  threadId?: string
  turnId?: string
  messageId?: string
  sourceText?: string
  profile: VoiceProfile
  speed: number
  voice: string
  format: string
  autoplay: boolean
  telegramFallback: boolean
  fingerprint: string
}

type VoiceSummaryResult = {
  text: string
  source: 'model' | 'local' | 'local_fallback'
}

type SpeechAudio = {
  contentType: string
  body: Buffer
}

type VoiceSpeechCacheEntry = SpeechAudio & {
  cacheKey: string
  createdAtMs: number
  updatedAtMs: number
  expiresAtMs: number
  summarySource: VoiceSummaryResult['source']
  inputChars: number
}

export type VoiceAnswerJob = {
  id: string
  status: VoiceJobStatus
  createdAtMs: number
  updatedAtMs: number
  expiresAtMs: number
  fingerprint: string
  threadId?: string
  turnId?: string
  messageId?: string
  profile: VoiceProfile
  voice: string
  format: string
  speed: number
  autoplay: boolean
  telegramFallback: boolean
  sourceTextChars: number
  spokenTextChars: number
  summarySource?: VoiceSummaryResult['source']
  summaryText?: string
  audioContentType?: string
  audioBytes?: number
  audioBody?: Buffer
  error?: string
}

export type VoiceModeNotificationEvent = {
  type: 'ready' | 'failed'
  job: VoiceAnswerJob
}

class VoiceClientError extends Error {
  readonly statusCode: number
  readonly retryable: boolean

  constructor(message: string, statusCode: number, retryable: boolean) {
    super(message)
    this.statusCode = statusCode
    this.retryable = retryable
  }
}

const VOICE_PROFILES: Record<VoiceProfile, VoiceProfileConfig> = {
  economy: {
    maxChars: 700,
    maxOutputTokens: 320,
    reasoningEffort: 'low',
    guidance: 'Очень коротко: 2-4 живые фразы, как быстрое голосовое другу. Примерно 20-40 секунд речи.',
  },
  medium: {
    maxChars: 1_400,
    maxOutputTokens: 650,
    reasoningEffort: 'low',
    guidance: 'Нормально подробно, но без лишних деталей: спокойное голосовое на 1-2 минуты.',
  },
  forte: {
    maxChars: 2_400,
    maxOutputTokens: 1_000,
    reasoningEffort: 'medium',
    guidance: 'Можно подробнее объяснить ход и важные нюансы, но все равно говори естественно и не читай код, диффы или логи.',
  },
}

export class VoiceJobStore {
  private readonly jobs = new Map<string, VoiceAnswerJob>()
  private readonly ttlMs: number
  private readonly maxJobs: number
  private readonly nowMs: () => number

  constructor(options: { ttlMs?: number; maxJobs?: number; nowMs?: () => number } = {}) {
    this.ttlMs = options.ttlMs ?? JOB_TTL_MS
    this.maxJobs = options.maxJobs ?? MAX_JOBS
    this.nowMs = options.nowMs ?? Date.now
  }

  create(request: NormalizedVoiceJobRequest): { job: VoiceAnswerJob; deduplicated: boolean } {
    this.cleanup()
    const existing = this.findReusableJob(request.fingerprint)
    if (existing) return { job: existing, deduplicated: true }

    this.enforceMaxJobs()
    const now = this.nowMs()
    const job: VoiceAnswerJob = {
      id: randomUUID(),
      status: 'queued',
      createdAtMs: now,
      updatedAtMs: now,
      expiresAtMs: now + this.ttlMs,
      fingerprint: request.fingerprint,
      threadId: request.threadId,
      turnId: request.turnId,
      messageId: request.messageId,
      profile: request.profile,
      voice: request.voice,
      format: request.format,
      speed: request.speed,
      autoplay: request.autoplay,
      telegramFallback: request.telegramFallback,
      sourceTextChars: request.sourceText?.length ?? 0,
      spokenTextChars: 0,
    }
    this.jobs.set(job.id, job)
    return { job, deduplicated: false }
  }

  get(id: string): VoiceAnswerJob | null {
    const job = this.jobs.get(id) ?? null
    if (!job) return null
    this.markExpired(job)
    return job
  }

  update(id: string, patch: Partial<VoiceAnswerJob>): VoiceAnswerJob | null {
    const job = this.jobs.get(id) ?? null
    if (!job) return null
    Object.assign(job, patch, { updatedAtMs: this.nowMs() })
    this.markExpired(job)
    return job
  }

  private findReusableJob(fingerprint: string): VoiceAnswerJob | null {
    for (const job of this.jobs.values()) {
      this.markExpired(job)
      if (job.fingerprint !== fingerprint) continue
      if (job.status === 'failed' || job.status === 'expired') continue
      return job
    }
    return null
  }

  private markExpired(job: VoiceAnswerJob): void {
    if (job.status === 'expired') return
    if (this.nowMs() <= job.expiresAtMs) return
    job.status = 'expired'
    job.updatedAtMs = this.nowMs()
    job.error = 'Voice answer audio expired'
    job.audioBody = undefined
    job.audioBytes = undefined
    job.audioContentType = undefined
  }

  private cleanup(): void {
    const now = this.nowMs()
    for (const [id, job] of this.jobs) {
      this.markExpired(job)
      if (job.status === 'expired' && now > job.expiresAtMs + JOB_EXPIRY_GRACE_MS) {
        this.jobs.delete(id)
      }
    }
  }

  private enforceMaxJobs(): void {
    if (this.jobs.size < this.maxJobs) return

    const sorted = Array.from(this.jobs.values()).sort((a, b) => a.createdAtMs - b.createdAtMs)
    const removable = sorted.find((job) => ['ready', 'failed', 'expired'].includes(job.status)) ?? sorted[0]
    if (removable) {
      this.jobs.delete(removable.id)
    }
  }
}

const sharedVoiceJobStore = new VoiceJobStore()

export class VoiceSpeechCache {
  private readonly entries = new Map<string, VoiceSpeechCacheEntry>()
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly nowMs: () => number

  constructor(options: { ttlMs?: number; maxEntries?: number; nowMs?: () => number } = {}) {
    this.ttlMs = options.ttlMs ?? SPEECH_CACHE_TTL_MS
    this.maxEntries = options.maxEntries ?? MAX_SPEECH_CACHE_ENTRIES
    this.nowMs = options.nowMs ?? Date.now
  }

  get(cacheKey: string): VoiceSpeechCacheEntry | null {
    this.cleanup()
    const entry = this.entries.get(cacheKey) ?? null
    if (!entry) return null
    if (this.nowMs() > entry.expiresAtMs) {
      this.entries.delete(cacheKey)
      return null
    }
    return entry
  }

  set(
    cacheKey: string,
    speech: SpeechAudio,
    meta: { summarySource: VoiceSummaryResult['source']; inputChars: number },
  ): VoiceSpeechCacheEntry {
    this.cleanup()
    this.enforceMaxEntries()
    const now = this.nowMs()
    const entry: VoiceSpeechCacheEntry = {
      cacheKey,
      contentType: speech.contentType,
      body: speech.body,
      createdAtMs: now,
      updatedAtMs: now,
      expiresAtMs: now + this.ttlMs,
      summarySource: meta.summarySource,
      inputChars: meta.inputChars,
    }
    this.entries.set(cacheKey, entry)
    return entry
  }

  private cleanup(): void {
    const now = this.nowMs()
    for (const [cacheKey, entry] of this.entries) {
      if (now > entry.expiresAtMs + SPEECH_CACHE_EXPIRY_GRACE_MS) {
        this.entries.delete(cacheKey)
      }
    }
  }

  private enforceMaxEntries(): void {
    if (this.entries.size < this.maxEntries) return
    const oldest = Array.from(this.entries.values()).sort((a, b) => a.updatedAtMs - b.updatedAtMs)[0]
    if (oldest) this.entries.delete(oldest.cacheKey)
  }
}

const sharedVoiceSpeechCache = new VoiceSpeechCache()

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, numeric))
}

function normalizeProfile(value: unknown): VoiceProfile {
  const normalized = readNonEmptyString(value).toLowerCase()
  return normalized === 'economy' || normalized === 'forte' ? normalized : 'medium'
}

function normalizeVoice(value: unknown): string | null {
  const voice = readNonEmptyString(value || DEFAULT_VOICE_TTS_VOICE).toLowerCase()
  return ALLOWED_TTS_VOICES.has(voice) ? voice : null
}

function normalizeFormat(value: unknown): string | null {
  const format = readNonEmptyString(value || DEFAULT_VOICE_TTS_FORMAT).toLowerCase()
  return ALLOWED_TTS_FORMATS.has(format) ? format : null
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return value.slice(0, maxChars).trim()
}

function contentTypeForFormat(format: string): string {
  switch (format) {
    case 'aac':
      return 'audio/aac'
    case 'flac':
      return 'audio/flac'
    case 'opus':
      return 'audio/opus'
    case 'pcm':
      return 'audio/L16'
    case 'wav':
      return 'audio/wav'
    default:
      return 'audio/mpeg'
  }
}

function writeJson(res: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  const payload = JSON.stringify(body)
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', Buffer.byteLength(payload))
  res.end(payload)
}

async function readRequestBody(req: IncomingMessage, maxBytes = REQUEST_BODY_MAX_BYTES): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    size += buffer.byteLength
    if (size > maxBytes) {
      throw new VoiceClientError('Voice request is too large', 413, false)
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const body = await readRequestBody(req)
  if (body.byteLength === 0) return null
  try {
    return asRecord(JSON.parse(body.toString('utf8')))
  } catch {
    throw new VoiceClientError('Voice request must be valid JSON', 400, false)
  }
}

function normalizeVoiceSpeechRequest(body: Record<string, unknown> | null): VoiceSpeechRequest {
  const text = readNonEmptyString(body?.text)
  if (!text) {
    throw new VoiceClientError('Voice speech requires non-empty text', 400, false)
  }

  const voice = normalizeVoice(body?.voice)
  if (!voice) {
    throw new VoiceClientError('Unsupported voice for voice speech', 400, false)
  }

  const format = normalizeFormat(body?.format ?? body?.responseFormat)
  if (!format) {
    throw new VoiceClientError('Unsupported audio format for voice speech', 400, false)
  }

  return {
    text: truncateText(text, SOURCE_TEXT_MAX_CHARS),
    threadId: readNonEmptyString(body?.threadId) || undefined,
    messageId: readNonEmptyString(body?.messageId) || undefined,
    profile: normalizeProfile(body?.profile),
    speed: clampNumber(body?.speed, 1, 0.25, 4),
    voice,
    format,
  }
}

function hashVoiceText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

function createVoiceSpeechCacheKey(request: VoiceSpeechRequest): string {
  return [
    request.threadId || 'direct',
    request.messageId || 'no-message',
    request.profile,
    request.voice,
    request.format,
    String(request.speed),
    hashVoiceText(request.text),
  ].join(':')
}

function normalizeVoiceJobRequest(body: Record<string, unknown> | null): NormalizedVoiceJobRequest {
  const sourceText = readNonEmptyString(body?.text)
  const threadId = readNonEmptyString(body?.threadId)
  if (!sourceText && !threadId) {
    throw new VoiceClientError('Voice job requires text or threadId', 400, false)
  }

  const voice = normalizeVoice(body?.voice)
  if (!voice) {
    throw new VoiceClientError('Unsupported voice for voice job', 400, false)
  }

  const format = normalizeFormat(body?.format ?? body?.responseFormat)
  if (!format) {
    throw new VoiceClientError('Unsupported audio format for voice job', 400, false)
  }

  const profile = normalizeProfile(body?.profile)
  const speed = clampNumber(body?.speed, 1, 0.25, 4)
  const turnId = readNonEmptyString(body?.turnId) || undefined
  const messageId = readNonEmptyString(body?.messageId) || undefined
  const autoplay = body?.autoplay === false ? false : true
  const telegramFallback = body?.telegramFallback === true
  const boundedSourceText = sourceText ? truncateText(sourceText, SOURCE_TEXT_MAX_CHARS) : undefined
  const hash = boundedSourceText ? hashVoiceText(boundedSourceText) : 'latest'
  const fingerprint = [
    threadId || 'direct',
    turnId || messageId || hash,
    profile,
    voice,
    format,
    String(speed),
    telegramFallback ? 'tg' : 'notg',
  ].join(':')

  return {
    threadId: threadId || undefined,
    turnId,
    messageId,
    sourceText: boundedSourceText,
    profile,
    speed,
    voice,
    format,
    autoplay,
    telegramFallback,
    fingerprint,
  }
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function stripMarkdownForSpeech(text: string): string {
  const withoutFencedCode = text
    .replace(/```[\s\S]*?```/g, ' В ответе есть блок кода; я не буду читать его вслух, а скажу только смысл. ')
    .replace(/~~~[\s\S]*?~~~/g, ' В ответе есть технический блок; я не буду читать его вслух. ')

  const cleanedLines = withoutFencedCode
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      if (!trimmed) return true
      if (/^(diff --git|index [0-9a-f]+\.\.|@@|[+-]{3}\s|commit [0-9a-f]{7,})/iu.test(trimmed)) return false
      if (/^[+-]\s*(import|export|const|let|var|function|class|return|if|for|while|\{|\}|\/\/)/u.test(trimmed)) return false
      if (/^\s{4,}\S/u.test(line)) return false
      if (/^(at\s+\S+\s+\(|\w*Error:|\[[^\]]+\]\s+(error|warn|info))/iu.test(trimmed)) return false
      return true
    })
    .join('\n')

  return compactWhitespace(cleanedLines
    .replace(/`[^`]+`/g, 'техническая деталь')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1'))
}

function takeSentences(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const chunks = text.match(/[^.!?。！？]+[.!?。！？]+|\S.+$/g) ?? [text]
  const picked: string[] = []
  let length = 0
  for (const chunk of chunks) {
    const trimmed = chunk.trim()
    if (!trimmed) continue
    if (length + trimmed.length > maxChars && picked.length > 0) break
    picked.push(trimmed)
    length += trimmed.length + 1
    if (length >= maxChars) break
  }
  const joined = picked.join(' ').trim()
  return joined.length > 0 ? joined : text.slice(0, maxChars).trim()
}

export function summarizeVoiceTextLocally(text: string, profile: VoiceProfile = 'medium'): string {
  const normalized = stripMarkdownForSpeech(text)
  if (!normalized) return 'Ответ готов, но в нем нет текста, который стоит озвучивать.'

  const profileConfig = VOICE_PROFILES[profile]
  const clipped = takeSentences(normalized, Math.min(profileConfig.maxChars, TTS_INPUT_MAX_CHARS))
  if (/^(сделал|готово|исправил|добавил|проверил|нашел|ошибка|ответ)/iu.test(clipped)) {
    return clipped
  }
  return `Коротко: ${clipped}`
}

function resolveEnv(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value) return value
  }
  return ''
}

export function resolveVoiceTtsApiKey(): string {
  return resolveEnv('CODEXUI_VOICE_TTS_API_KEY', 'CODEXUI_TRANSCRIBE_API_KEY', 'OPENAI_API_KEY')
}

function resolveVoiceTtsBaseUrl(): string {
  return (resolveEnv('CODEXUI_VOICE_TTS_BASE_URL', 'OPENAI_BASE_URL') || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/u, '')
}

function resolveVoiceSummaryApiKey(): string {
  return resolveEnv('CODEXUI_VOICE_SUMMARY_API_KEY', 'CODEXUI_VOICE_TTS_API_KEY', 'CODEXUI_TRANSCRIBE_API_KEY', 'OPENAI_API_KEY')
}

function resolveVoiceSummaryBaseUrl(): string {
  return (resolveEnv('CODEXUI_VOICE_SUMMARY_BASE_URL', 'CODEXUI_VOICE_TTS_BASE_URL', 'OPENAI_BASE_URL') || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/u, '')
}

function resolveVoiceSummaryModel(profile: VoiceProfile): string {
  const profileKey = `CODEXUI_VOICE_SUMMARY_MODEL_${profile.toUpperCase()}`
  return resolveEnv(profileKey, 'CODEXUI_VOICE_SUMMARY_MODEL') || DEFAULT_VOICE_SUMMARY_MODEL
}

function isLocalSummaryForced(): boolean {
  const model = process.env.CODEXUI_VOICE_SUMMARY_MODEL?.trim().toLowerCase()
  return model === 'local' || process.env.CODEXUI_VOICE_SUMMARY_DISABLED?.trim() === '1'
}

function buildVoiceSummaryInstructions(profile: VoiceProfile): string {
  const profileConfig = VOICE_PROFILES[profile]
  return [
    'Ты готовишь русскую голосовую версию ответа Codex для пользователя, который слушает тебя в наушниках.',
    'Говори по-русски простым разговорным языком, как друг по телефону: тепло, быстро, без канцелярита.',
    'Не используй markdown, списки с разметкой, таблицы, ссылки в markdown или заголовки.',
    'Не читай код, диффы, stack trace, логи, JSON и длинные команды дословно.',
    'Если исходный ответ содержит код, диффы или логи, коротко объясни человеческим языком, что изменилось или что важно понять.',
    'Не добавляй обязательный блок про риски, проверки, ошибки или источники.',
    'Говори про риск только если в исходном ответе есть реальный конкретный риск, который пользователю важно услышать.',
    'Говори про ошибку только если исходный ответ сообщает, что ошибка была или что что-то не получилось.',
    'Если риска или ошибки нет, просто не упоминай их.',
    profileConfig.guidance,
    'Выводи только готовый текст для озвучки.',
  ].join('\n')
}

function buildVoiceSummaryInput(text: string): string {
  return [
    'Исходный ответ Codex:',
    truncateText(text, SOURCE_TEXT_MAX_CHARS),
  ].join('\n\n')
}

function extractResponseText(payload: unknown): string {
  const record = asRecord(payload)
  if (!record) return ''
  if (typeof record.output_text === 'string') return record.output_text.trim()
  const output = Array.isArray(record.output) ? record.output : []
  const parts: string[] = []
  for (const item of output) {
    const itemRecord = asRecord(item)
    const content = Array.isArray(itemRecord?.content) ? itemRecord.content : []
    for (const part of content) {
      const partRecord = asRecord(part)
      const text = readNonEmptyString(partRecord?.text)
      if (text) parts.push(text)
    }
  }
  return parts.join(' ').trim()
}

async function summarizeVoiceTextWithModel(
  fetchImpl: typeof fetch,
  text: string,
  profile: VoiceProfile,
): Promise<string> {
  const apiKey = resolveVoiceSummaryApiKey()
  const model = resolveVoiceSummaryModel(profile)
  if (!apiKey || !model || model.toLowerCase() === 'local') {
    throw new Error('Voice summary model is not configured')
  }

  const profileConfig = VOICE_PROFILES[profile]
  const response = await fetchImpl(`${resolveVoiceSummaryBaseUrl()}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      reasoning: { effort: profileConfig.reasoningEffort },
      text: { verbosity: 'low' },
      instructions: buildVoiceSummaryInstructions(profile),
      input: buildVoiceSummaryInput(text),
      max_output_tokens: profileConfig.maxOutputTokens,
      store: false,
    }),
    signal: AbortSignal.timeout(60_000),
  })

  if (!response.ok) {
    throw new Error('Voice summary model rejected the request')
  }

  const summary = extractResponseText(await response.json().catch(() => null))
  if (!summary) {
    throw new Error('Voice summary model returned no text')
  }
  return takeSentences(stripMarkdownForSpeech(summary), Math.min(profileConfig.maxChars, TTS_INPUT_MAX_CHARS))
}

async function summarizeVoiceText(
  fetchImpl: typeof fetch,
  text: string,
  profile: VoiceProfile,
): Promise<VoiceSummaryResult> {
  if (!isLocalSummaryForced()) {
    try {
      const modelSummary = await summarizeVoiceTextWithModel(fetchImpl, text, profile)
      if (modelSummary) return { text: modelSummary, source: 'model' }
    } catch {
      return { text: summarizeVoiceTextLocally(text, profile), source: 'local_fallback' }
    }
  }

  return { text: summarizeVoiceTextLocally(text, profile), source: 'local' }
}

async function createSpeechAudio(
  fetchImpl: typeof fetch,
  request: Pick<VoiceSpeechRequest, 'format' | 'speed' | 'voice'>,
  summaryText: string,
): Promise<SpeechAudio> {
  const apiKey = resolveVoiceTtsApiKey()
  if (!apiKey) {
    throw new VoiceClientError(
      'Voice mode TTS is not configured. Set CODEXUI_VOICE_TTS_API_KEY, CODEXUI_TRANSCRIBE_API_KEY, or OPENAI_API_KEY on the server.',
      503,
      false,
    )
  }

  const model = process.env.CODEXUI_VOICE_TTS_MODEL?.trim() || DEFAULT_VOICE_TTS_MODEL
  let response: Response
  try {
    response = await fetchImpl(`${resolveVoiceTtsBaseUrl()}/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        voice: request.voice,
        input: truncateText(summaryText, TTS_INPUT_MAX_CHARS),
        instructions: 'Говори по-русски спокойно, естественно и разборчиво. Не изображай чтение кода или логов.',
        response_format: request.format,
        speed: request.speed,
      }),
      signal: AbortSignal.timeout(90_000),
    })
  } catch {
    throw new VoiceClientError('OpenAI voice generation request failed. Please retry.', 502, true)
  }

  if (!response.ok) {
    const retryable = response.status >= 500 || response.status === 429
    throw new VoiceClientError(
      retryable
        ? 'OpenAI voice generation is temporarily unavailable. Please retry.'
        : 'OpenAI voice generation rejected the request. Check voice mode TTS configuration.',
      retryable ? 502 : 400,
      retryable,
    )
  }

  const contentLength = Number.parseInt(response.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(contentLength) && contentLength > TTS_AUDIO_MAX_BYTES) {
    throw new VoiceClientError('Generated voice audio is too large.', 502, true)
  }

  const body = Buffer.from(await response.arrayBuffer())
  if (body.byteLength > TTS_AUDIO_MAX_BYTES) {
    throw new VoiceClientError('Generated voice audio is too large.', 502, true)
  }

  return {
    contentType: response.headers.get('content-type') || contentTypeForFormat(request.format),
    body,
  }
}

function readThreadTurns(payload: unknown): unknown[] {
  const record = asRecord(payload)
  const thread = asRecord(record?.thread)
  return Array.isArray(thread?.turns) ? thread.turns : []
}

function isThreadInProgress(payload: unknown): boolean {
  const record = asRecord(payload)
  const thread = asRecord(record?.thread)
  const turns = readThreadTurns(payload)
  const lastTurn = asRecord(turns.at(-1))
  return lastTurn?.status === 'inProgress' || thread?.inProgress === true || thread?.status === 'inProgress'
}

export function extractLatestAssistantText(payload: unknown): string {
  const turns = readThreadTurns(payload)
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = asRecord(turns[turnIndex])
    if (turn?.status === 'inProgress') continue
    const items = Array.isArray(turn?.items) ? turn.items : []
    for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = asRecord(items[itemIndex])
      if (item?.type !== 'agentMessage') continue
      const text = readNonEmptyString(item.text)
      if (text) return text
    }
  }
  return ''
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForAssistantAnswer(
  appServer: RpcExecutor,
  threadId: string,
  options: { pollIntervalMs: number; timeoutMs: number },
): Promise<string> {
  const startedAt = Date.now()

  while (Date.now() - startedAt <= options.timeoutMs) {
    const payload = await appServer.rpc('thread/read', { threadId, includeTurns: true })
    const assistantText = extractLatestAssistantText(payload)
    if (assistantText && !isThreadInProgress(payload)) {
      return truncateText(assistantText, SOURCE_TEXT_MAX_CHARS)
    }
    await sleep(options.pollIntervalMs)
  }

  throw new VoiceClientError('Timed out waiting for an assistant answer to voice.', 504, true)
}

function getClientError(error: unknown): { statusCode: number; message: string; retryable: boolean } {
  if (error instanceof VoiceClientError) {
    return {
      statusCode: error.statusCode,
      message: error.message,
      retryable: error.retryable,
    }
  }
  return {
    statusCode: 503,
    message: 'Voice mode request failed. Please retry.',
    retryable: true,
  }
}

function serializeJob(job: VoiceAnswerJob, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const createdAtIso = new Date(job.createdAtMs).toISOString()
  const updatedAtIso = new Date(job.updatedAtMs).toISOString()
  const expiresAtIso = new Date(job.expiresAtMs).toISOString()
  return {
    id: job.id,
    status: job.status,
    state: job.status,
    threadId: job.threadId ?? null,
    turnId: job.turnId ?? null,
    messageId: job.messageId ?? null,
    profile: job.profile,
    voice: job.voice,
    format: job.format,
    speed: job.speed,
    autoplay: job.autoplay,
    telegramFallback: job.telegramFallback,
    createdAt: createdAtIso,
    updatedAt: updatedAtIso,
    expiresAt: expiresAtIso,
    createdAtIso,
    updatedAtIso,
    expiresAtIso,
    sourceTextChars: job.sourceTextChars,
    spokenTextChars: job.spokenTextChars,
    summarySource: job.summarySource ?? null,
    summaryText: job.summaryText ?? null,
    audioReady: job.status === 'ready' && Boolean(job.audioBody),
    audioBytes: job.audioBytes ?? null,
    audioContentType: job.audioContentType ?? null,
    error: job.error ?? null,
    ...extra,
  }
}

function writeVoiceSpeechAudioResponse(
  res: ServerResponse,
  request: VoiceSpeechRequest,
  speech: SpeechAudio,
  meta: { summarySource: VoiceSummaryResult['source']; inputChars: number; cacheStatus: 'hit' | 'miss' },
): void {
  res.statusCode = 200
  res.setHeader('Content-Type', speech.contentType)
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Codex-Voice', request.voice)
  res.setHeader('X-Codex-Voice-Speed', String(request.speed))
  res.setHeader('X-Codex-Voice-Tts-Model', process.env.CODEXUI_VOICE_TTS_MODEL?.trim() || DEFAULT_VOICE_TTS_MODEL)
  res.setHeader('X-Codex-Voice-Summary-Source', meta.summarySource)
  res.setHeader('X-Codex-Voice-Input-Chars', String(meta.inputChars))
  res.setHeader('X-Codex-Voice-Cache', meta.cacheStatus)
  res.end(speech.body)
}

async function notifyVoiceModeJob(
  notify: VoiceModeRouteOptions['notify'],
  event: VoiceModeNotificationEvent,
): Promise<void> {
  if (!notify) return
  try {
    await notify(event)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[voice-mode]', 'Voice mode fallback notification failed', {
      jobId: event.job.id,
      type: event.type,
      error: message,
    })
  }
}

async function runVoiceJob(
  jobId: string,
  request: NormalizedVoiceJobRequest,
  options: Required<Pick<VoiceModeRouteOptions, 'appServer'>> & {
    fetchImpl: typeof fetch
    jobStore: VoiceJobStore
    pollIntervalMs: number
    waitTimeoutMs: number
    notify?: VoiceModeRouteOptions['notify']
  },
): Promise<void> {
  const { jobStore } = options
  try {
    let sourceText = request.sourceText
    if (!sourceText) {
      if (!request.threadId) {
        throw new VoiceClientError('Voice job requires a threadId when text is not provided.', 400, false)
      }
      jobStore.update(jobId, { status: 'waiting_for_answer' })
      sourceText = await waitForAssistantAnswer(options.appServer, request.threadId, {
        pollIntervalMs: options.pollIntervalMs,
        timeoutMs: options.waitTimeoutMs,
      })
    }

    jobStore.update(jobId, {
      status: 'summarizing',
      sourceTextChars: sourceText.length,
    })
    const summary = await summarizeVoiceText(options.fetchImpl, sourceText, request.profile)
    jobStore.update(jobId, {
      status: 'synthesizing',
      summarySource: summary.source,
      spokenTextChars: summary.text.length,
      summaryText: summary.text,
    })

    const speech = await createSpeechAudio(options.fetchImpl, request, summary.text)
    jobStore.update(jobId, {
      status: 'ready',
      audioContentType: speech.contentType,
      audioBytes: speech.body.byteLength,
      audioBody: speech.body,
      error: undefined,
    })
    const readyJob = jobStore.get(jobId)
    if (readyJob && readyJob.telegramFallback) {
      await notifyVoiceModeJob(options.notify, { type: 'ready', job: readyJob })
    }
  } catch (error) {
    const clientError = getClientError(error)
    jobStore.update(jobId, {
      status: 'failed',
      error: clientError.message,
      audioBody: undefined,
      audioBytes: undefined,
      audioContentType: undefined,
    })
    const failedJob = jobStore.get(jobId)
    if (failedJob?.telegramFallback) {
      await notifyVoiceModeJob(options.notify, { type: 'failed', job: failedJob })
    }
  }
}

export async function handleVoiceModeSpeechRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  options: VoiceModeRouteOptions,
): Promise<boolean> {
  if (url.pathname !== VOICE_MODE_SPEECH_PATH) return false

  if (req.method !== 'POST') {
    writeJson(res, 405, { error: 'Voice speech requires POST', retryable: false })
    return true
  }

  try {
    const request = normalizeVoiceSpeechRequest(await readJsonBody(req))
    const fetchImpl = options.fetch ?? fetch
    const speechCache = options.speechCache ?? sharedVoiceSpeechCache
    const cacheKey = createVoiceSpeechCacheKey(request)
    const cached = speechCache.get(cacheKey)
    if (cached) {
      writeVoiceSpeechAudioResponse(res, request, cached, {
        summarySource: cached.summarySource,
        inputChars: cached.inputChars,
        cacheStatus: 'hit',
      })
      return true
    }

    const summary = await summarizeVoiceText(fetchImpl, request.text, request.profile)
    const speech = await createSpeechAudio(fetchImpl, request, summary.text)
    const cachedSpeech = speechCache.set(cacheKey, speech, {
      summarySource: summary.source,
      inputChars: summary.text.length,
    })
    writeVoiceSpeechAudioResponse(res, request, cachedSpeech, {
      summarySource: summary.source,
      inputChars: summary.text.length,
      cacheStatus: 'miss',
    })
  } catch (error) {
    const clientError = getClientError(error)
    writeJson(res, clientError.statusCode, {
      error: clientError.message,
      retryable: clientError.retryable,
    })
  }

  return true
}

async function handleCreateVoiceJob(
  req: IncomingMessage,
  res: ServerResponse,
  options: VoiceModeRouteOptions,
): Promise<void> {
  const request = normalizeVoiceJobRequest(await readJsonBody(req))
  const jobStore = options.jobStore ?? sharedVoiceJobStore
  const { job, deduplicated } = jobStore.create(request)

  if (!deduplicated) {
    const pollIntervalMs = Math.max(250, Math.min(10_000, options.pollIntervalMs ?? JOB_POLL_INTERVAL_MS))
    const waitTimeoutMs = Math.max(1_000, Math.min(30 * 60_000, options.waitTimeoutMs ?? JOB_WAIT_TIMEOUT_MS))
    void runVoiceJob(job.id, request, {
      appServer: options.appServer,
      fetchImpl: options.fetch ?? fetch,
      jobStore,
      pollIntervalMs,
      waitTimeoutMs,
      notify: options.notify,
    })
  }

  const data = serializeJob(job, { deduplicated })
  writeJson(res, deduplicated ? 200 : 202, { data, job: data })
}

function handleReadVoiceJob(
  res: ServerResponse,
  jobId: string,
  jobStore: VoiceJobStore,
): void {
  const job = jobStore.get(jobId)
  if (!job) {
    writeJson(res, 404, { error: 'Voice job not found', retryable: false })
    return
  }
  const data = serializeJob(job)
  writeJson(res, 200, { data, job: data })
}

function handleReadVoiceJobAudio(
  res: ServerResponse,
  jobId: string,
  jobStore: VoiceJobStore,
): void {
  const job = jobStore.get(jobId)
  if (!job) {
    writeJson(res, 404, { error: 'Voice job not found', retryable: false })
    return
  }
  if (job.status === 'expired') {
    writeJson(res, 410, { error: 'Voice job audio expired', retryable: false })
    return
  }
  if (job.status !== 'ready' || !job.audioBody) {
    writeJson(res, 409, { error: 'Voice job audio is not ready', status: job.status, retryable: job.status !== 'failed' })
    return
  }

  res.statusCode = 200
  res.setHeader('Content-Type', job.audioContentType || contentTypeForFormat(job.format))
  res.setHeader('Cache-Control', 'private, max-age=60')
  res.setHeader('Content-Length', job.audioBody.byteLength)
  res.end(job.audioBody)
}

export async function handleVoiceModeRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  options: VoiceModeRouteOptions,
): Promise<boolean> {
  if (await handleVoiceModeSpeechRoute(req, res, url, options)) return true

  if (url.pathname === VOICE_MODE_JOBS_PATH) {
    if (req.method !== 'POST') {
      writeJson(res, 405, { error: 'Voice jobs require POST', retryable: false })
      return true
    }
    try {
      await handleCreateVoiceJob(req, res, options)
    } catch (error) {
      const clientError = getClientError(error)
      writeJson(res, clientError.statusCode, {
        error: clientError.message,
        retryable: clientError.retryable,
      })
    }
    return true
  }

  const match = url.pathname.match(VOICE_JOB_ROUTE_RE)
  if (!match) return false

  const jobId = decodeURIComponent(match[1] ?? '')
  if (!jobId) {
    writeJson(res, 400, { error: 'Missing voice job id', retryable: false })
    return true
  }

  const jobStore = options.jobStore ?? sharedVoiceJobStore
  const isAudioRequest = match[2] === 'audio'
  if (req.method !== 'GET') {
    writeJson(res, 405, { error: 'Voice job lookup requires GET', retryable: false })
    return true
  }

  if (isAudioRequest) {
    handleReadVoiceJobAudio(res, jobId, jobStore)
  } else {
    handleReadVoiceJob(res, jobId, jobStore)
  }
  return true
}
