import type { IncomingMessage, ServerResponse } from 'node:http'

export const VOICE_MODE_SPEECH_PATH = '/codex-api/voice/speech'

const DEFAULT_TTS_MODEL = 'gpt-4o-mini-tts'
const DEFAULT_TTS_VOICE = 'nova'
const DEFAULT_TTS_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_TTS_FORMAT = 'mp3'
const VOICE_SUMMARY_TIMEOUT_MS = 75_000
const VOICE_SUMMARY_POLL_MS = 1_000
const VOICE_SOURCE_TEXT_MAX_CHARS = 24_000
const VOICE_TTS_INPUT_MAX_CHARS = 1_800

type RpcExecutor = {
  rpc: (method: string, params: unknown) => Promise<unknown>
}

type VoiceSpeechRouteOptions = {
  appServer: RpcExecutor
  fetch?: typeof fetch
}

type VoiceSpeechRequest = {
  text: string
  threadId?: string
  speed: number
  voice: string
  format: string
}

type VoiceSummaryResult = {
  text: string
  source: 'app-server' | 'local'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
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

function normalizeFormat(value: unknown): string {
  const format = readNonEmptyString(value).toLowerCase()
  return ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'].includes(format) ? format : DEFAULT_TTS_FORMAT
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
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

async function readRequestBody(req: IncomingMessage, maxBytes = 512 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    size += buffer.byteLength
    if (size > maxBytes) {
      throw new Error('Voice speech request is too large')
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
    return null
  }
}

function normalizeVoiceSpeechRequest(body: Record<string, unknown> | null): VoiceSpeechRequest | null {
  const text = readNonEmptyString(body?.text)
  if (!text) return null
  const voice = readNonEmptyString(body?.voice) || DEFAULT_TTS_VOICE
  if (voice !== DEFAULT_TTS_VOICE) {
    return null
  }
  return {
    text,
    threadId: readNonEmptyString(body?.threadId) || undefined,
    speed: clampNumber(body?.speed, 1, 0.25, 4),
    voice,
    format: normalizeFormat(body?.format ?? body?.responseFormat),
  }
}

function stripMarkdownForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' В ответе есть блок кода, я кратко объясню его смысл. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
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

function localVoiceSummary(text: string): string {
  const normalized = stripMarkdownForSpeech(text)
  if (!normalized) return 'Ответ готов, но в нем нет текста для озвучки.'
  return takeSentences(normalized, VOICE_TTS_INPUT_MAX_CHARS)
}

function buildVoiceSummaryPrompt(text: string): string {
  const source = text.length > VOICE_SOURCE_TEXT_MAX_CHARS
    ? `${text.slice(0, VOICE_SOURCE_TEXT_MAX_CHARS)}\n\n[Source response truncated for voice summarization.]`
    : text

  return [
    'You are preparing a spoken voice-mode version of a Codex assistant response for a user walking outside.',
    '',
    'Rewrite the answer as natural, friendly, conversational speech. Keep only the main point and practical outcome.',
    'Do not use tools, run commands, inspect files, ask follow-up questions, or mention this instruction.',
    'Do not preserve markdown. Do not read code, diffs, stack traces, logs, or long lists verbatim.',
    'If the source contains code or diffs, explain what changed, which functions or UI controls matter, and what the user should know.',
    'Use the same language as the source answer. Output only the spoken text.',
    'Target 4 to 8 short sentences. Stay under 1200 characters.',
    '',
    'Source response:',
    source,
  ].join('\n')
}

function readThreadId(payload: unknown): string {
  const record = asRecord(payload)
  const thread = asRecord(record?.thread)
  return readNonEmptyString(thread?.id) || readNonEmptyString(record?.threadId) || readNonEmptyString(record?.thread_id)
}

function isThreadInProgress(payload: unknown): boolean {
  const record = asRecord(payload)
  const thread = asRecord(record?.thread)
  const turns = Array.isArray(thread?.turns) ? thread.turns : []
  const lastTurn = asRecord(turns.at(-1))
  return lastTurn?.status === 'inProgress' || thread?.inProgress === true || thread?.status === 'inProgress'
}

function extractAssistantText(payload: unknown): string {
  const record = asRecord(payload)
  const thread = asRecord(record?.thread)
  const turns = Array.isArray(thread?.turns) ? thread.turns : []
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = asRecord(turns[turnIndex])
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

async function summarizeWithAppServer(
  appServer: RpcExecutor,
  sourceThreadId: string,
  text: string,
): Promise<string> {
  const forkPayload = await appServer.rpc('thread/fork', {
    threadId: sourceThreadId,
    ephemeral: true,
    persistExtendedHistory: false,
  })
  const voiceThreadId = readThreadId(forkPayload)
  if (!voiceThreadId) {
    throw new Error('Voice summary fork did not return a thread id')
  }

  await appServer.rpc('turn/start', {
    threadId: voiceThreadId,
    input: [{ type: 'text', text: buildVoiceSummaryPrompt(text) }],
  })

  const startedAt = Date.now()
  let latestPayload: unknown = null
  while (Date.now() - startedAt < VOICE_SUMMARY_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, VOICE_SUMMARY_POLL_MS))
    latestPayload = await appServer.rpc('thread/read', {
      threadId: voiceThreadId,
      includeTurns: true,
    })
    if (!isThreadInProgress(latestPayload)) {
      const summary = extractAssistantText(latestPayload)
      if (summary) return summary
      break
    }
  }

  throw new Error('Voice summary did not complete in time')
}

async function summarizeVoiceText(
  appServer: RpcExecutor,
  request: VoiceSpeechRequest,
): Promise<VoiceSummaryResult> {
  if (request.threadId) {
    try {
      const text = await summarizeWithAppServer(appServer, request.threadId, request.text)
      const summary = localVoiceSummary(text)
      if (summary) return { text: summary, source: 'app-server' }
    } catch {
      // Fall back to deterministic cleanup so the play action still produces audio.
    }
  }

  return { text: localVoiceSummary(request.text), source: 'local' }
}

function getVoiceTtsApiKey(): string {
  return process.env.CODEXUI_VOICE_TTS_API_KEY?.trim()
    || process.env.OPENAI_API_KEY?.trim()
    || ''
}

function getVoiceTtsBaseUrl(): string {
  return (process.env.CODEXUI_VOICE_TTS_BASE_URL?.trim()
    || process.env.OPENAI_BASE_URL?.trim()
    || DEFAULT_TTS_BASE_URL).replace(/\/+$/u, '')
}

async function createSpeechAudio(
  fetchImpl: typeof fetch,
  request: VoiceSpeechRequest,
  summaryText: string,
): Promise<{ contentType: string; body: Buffer }> {
  const apiKey = getVoiceTtsApiKey()
  if (!apiKey) {
    throw new Error('Voice mode TTS is not configured. Set CODEXUI_VOICE_TTS_API_KEY or OPENAI_API_KEY on the server.')
  }

  const model = process.env.CODEXUI_VOICE_TTS_MODEL?.trim() || DEFAULT_TTS_MODEL
  const response = await fetchImpl(`${getVoiceTtsBaseUrl()}/audio/speech`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      voice: request.voice,
      input: summaryText,
      response_format: request.format,
      speed: request.speed,
    }),
  })

  if (!response.ok) {
    throw new Error(response.status >= 500 || response.status === 429
      ? 'OpenAI voice generation is temporarily unavailable. Please retry.'
      : 'OpenAI voice generation rejected the request. Check voice mode TTS configuration.')
  }

  return {
    contentType: response.headers.get('content-type') || contentTypeForFormat(request.format),
    body: Buffer.from(await response.arrayBuffer()),
  }
}

export async function handleVoiceModeSpeechRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  options: VoiceSpeechRouteOptions,
): Promise<boolean> {
  if (url.pathname !== VOICE_MODE_SPEECH_PATH) return false

  if (req.method !== 'POST') {
    writeJson(res, 405, { error: 'Voice speech requires POST' })
    return true
  }

  let request: VoiceSpeechRequest | null = null
  try {
    request = normalizeVoiceSpeechRequest(await readJsonBody(req))
  } catch (error) {
    writeJson(res, 413, { error: error instanceof Error ? error.message : 'Voice speech request is too large' })
    return true
  }

  if (!request) {
    writeJson(res, 400, { error: 'Voice speech requires non-empty text' })
    return true
  }

  try {
    const summary = await summarizeVoiceText(options.appServer, request)
    const speech = await createSpeechAudio(options.fetch ?? fetch, request, summary.text)
    res.statusCode = 200
    res.setHeader('Content-Type', speech.contentType)
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('X-Codex-Voice', request.voice)
    res.setHeader('X-Codex-Voice-Speed', String(request.speed))
    res.setHeader('X-Codex-Voice-Tts-Model', process.env.CODEXUI_VOICE_TTS_MODEL?.trim() || DEFAULT_TTS_MODEL)
    res.setHeader('X-Codex-Voice-Summary-Source', summary.source)
    res.setHeader('X-Codex-Voice-Input-Chars', String(summary.text.length))
    res.end(speech.body)
  } catch (error) {
    writeJson(res, 503, {
      error: error instanceof Error ? error.message : 'Voice speech failed',
      retryable: true,
    })
  }

  return true
}
