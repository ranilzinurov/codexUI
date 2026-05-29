import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  type AnnotationTranscriptionConfig,
  resolveAnnotationTranscriptionConfig,
} from './annotationTranscriptionConfig.js'
import {
  BrowserAnnotationListenStore,
  readBrowserAnnotationBearerToken,
  readBrowserAnnotationSessionSelector,
  sharedBrowserAnnotationListenStore,
} from './browserAnnotationListen.js'

export const BROWSER_ANNOTATION_TRANSCRIBE_PATH = '/codex-api/extension/transcribe'
export const BROWSER_ANNOTATION_TRANSCRIBE_MAX_BYTES = 15 * 1024 * 1024
const OPENAI_TRANSCRIPTION_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions'

const ALLOWED_AUDIO_MIME_TYPES = new Set([
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/mpeg',
  'audio/mpga',
  'audio/wav',
  'audio/webm',
  'audio/x-m4a',
  'audio/x-wav',
  'video/mp4',
])

export type BrowserAnnotationTranscribeRouteOptions = {
  store?: BrowserAnnotationListenStore
  maxBytes?: number
  config?: AnnotationTranscriptionConfig
  fetch?: typeof fetch
}

type MultipartAudioUpload = {
  fileName: string
  fileData: Buffer
  fileContentType: string
  fields: Record<string, string>
}

type BodyReadResult =
  | { ok: true; body: Buffer }
  | { ok: false; statusCode: 413; error: string }

type OpenAiTranscriptionResult = {
  text: string
  language?: unknown
  duration?: unknown
  usage?: unknown
}

export async function handleBrowserAnnotationTranscribeRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  options: BrowserAnnotationTranscribeRouteOptions = {},
): Promise<boolean> {
  if (url.pathname !== BROWSER_ANNOTATION_TRANSCRIBE_PATH) return false

  if (req.method !== 'POST') {
    setJson(res, 405, { error: 'Browser annotation transcription requires POST' })
    return true
  }

  const token = readBrowserAnnotationBearerToken(req)
  if (!token) {
    setJson(res, 401, { error: 'Missing extension bearer token' })
    return true
  }

  const selector = readBrowserAnnotationSessionSelector(url)
  if (!selector.sessionId && !selector.threadId) {
    setJson(res, 400, { error: 'Missing sessionId' })
    return true
  }

  const store = options.store ?? sharedBrowserAnnotationListenStore
  const session = store.getAuthorizedSession(token, selector)
  if (!session) {
    setJson(res, 401, { error: 'Invalid or expired extension bearer token' })
    return true
  }

  const config = options.config ?? resolveAnnotationTranscriptionConfig()
  if (!config.openAiApiKey) {
    setJson(res, 503, {
      error: 'Audio transcription is not configured. Set OPENAI_API_KEY on the server and try again.',
      retryable: false,
    })
    return true
  }
  if (!config.model) {
    setJson(res, 503, {
      error: 'Audio transcription model is not configured. Set CODEXUI_ANNOTATION_TRANSCRIBE_MODEL on the server and try again.',
      retryable: false,
    })
    return true
  }

  const maxBytes = options.maxBytes ?? BROWSER_ANNOTATION_TRANSCRIBE_MAX_BYTES
  const contentLength = readContentLength(req)
  if (contentLength !== null && contentLength > maxBytes) {
    setJson(res, 413, { error: 'Browser annotation audio upload is too large', retryable: false })
    return true
  }

  const bodyResult = await readRequestBody(req, maxBytes)
  if (!bodyResult.ok) {
    setJson(res, bodyResult.statusCode, { error: bodyResult.error, retryable: false })
    return true
  }

  const contentType = singleHeader(req.headers['content-type']) ?? ''
  const parsed = parseMultipartForm(bodyResult.body, contentType)
  if (!parsed) {
    setJson(res, 400, { error: 'Expected multipart form upload with an audio file field', retryable: false })
    return true
  }

  const mimeType = normalizeMimeType(parsed.fileContentType)
  if (!ALLOWED_AUDIO_MIME_TYPES.has(mimeType)) {
    setJson(res, 415, { error: 'Unsupported audio type for transcription', retryable: false })
    return true
  }
  if (parsed.fileData.length === 0) {
    setJson(res, 400, { error: 'Uploaded audio is empty', retryable: false })
    return true
  }
  if (parsed.fileData.length > maxBytes) {
    setJson(res, 413, { error: 'Browser annotation audio upload is too large', retryable: false })
    return true
  }

  const fetchImpl = options.fetch ?? fetch
  const primary = await transcribeWithModel(fetchImpl, config, parsed, config.model)
  const fallbackModel = config.fallbackModel && config.fallbackModel !== config.model
    ? config.fallbackModel
    : ''
  const result = !primary.ok && primary.providerFailure && fallbackModel
    ? await transcribeWithModel(fetchImpl, config, parsed, fallbackModel)
    : primary

  if (!result.ok) {
    setJson(res, result.statusCode, {
      error: result.error,
      retryable: result.retryable,
    })
    return true
  }

  setJson(res, 200, {
    ok: true,
    text: result.data.text,
    model: result.model,
    session: {
      sessionId: session.sessionId,
      threadId: session.threadId,
    },
    ...(result.data.language !== undefined ? { language: result.data.language } : {}),
    ...(result.data.duration !== undefined ? { duration: result.data.duration } : {}),
    ...(result.data.usage !== undefined ? { usage: result.data.usage } : {}),
  })
  return true
}

type TranscriptionAttemptResult =
  | { ok: true; model: string; data: OpenAiTranscriptionResult }
  | {
      ok: false
      statusCode: number
      error: string
      retryable: boolean
      providerFailure: boolean
    }

async function transcribeWithModel(
  fetchImpl: typeof fetch,
  config: AnnotationTranscriptionConfig,
  upload: MultipartAudioUpload,
  model: string,
): Promise<TranscriptionAttemptResult> {
  const form = new FormData()
  form.append('model', model)
  appendOptionalField(form, 'language', upload.fields.language)
  appendOptionalField(form, 'prompt', upload.fields.prompt)
  appendOptionalField(form, 'response_format', upload.fields.response_format)
  appendOptionalField(form, 'temperature', upload.fields.temperature)
  const fileBytes = new ArrayBuffer(upload.fileData.byteLength)
  new Uint8Array(fileBytes).set(upload.fileData)
  form.append('file', new Blob([fileBytes], { type: upload.fileContentType }), upload.fileName)

  let response: Response
  try {
    response = await fetchImpl(OPENAI_TRANSCRIPTION_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.openAiApiKey}`,
      },
      body: form,
    })
  } catch {
    return {
      ok: false,
      statusCode: 502,
      error: 'OpenAI transcription request failed. Please retry.',
      retryable: true,
      providerFailure: true,
    }
  }

  if (!response.ok) {
    const retryable = response.status >= 500 || response.status === 429
    return {
      ok: false,
      statusCode: retryable ? 502 : 400,
      error: retryable
        ? 'OpenAI transcription is temporarily unavailable. Please retry.'
        : 'OpenAI transcription rejected the request. Check server transcription configuration.',
      retryable,
      providerFailure: response.status >= 500 || response.status === 429,
    }
  }

  const payload = await response.json().catch(() => null) as unknown
  if (!isRecord(payload) || typeof payload.text !== 'string') {
    return {
      ok: false,
      statusCode: 502,
      error: 'OpenAI transcription response was missing text. Please retry.',
      retryable: true,
      providerFailure: true,
    }
  }

  return {
    ok: true,
    model,
    data: {
      text: payload.text,
      language: payload.language,
      duration: payload.duration,
      usage: payload.usage,
    },
  }
}

function appendOptionalField(form: FormData, name: string, value: string | undefined): void {
  const trimmed = value?.trim()
  if (trimmed) form.append(name, trimmed)
}

async function readRequestBody(req: IncomingMessage, maxBytes: number): Promise<BodyReadResult> {
  const chunks: Buffer[] = []
  let byteLength = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    byteLength += buffer.byteLength
    if (byteLength > maxBytes) {
      return { ok: false, statusCode: 413, error: 'Browser annotation audio upload is too large' }
    }
    chunks.push(buffer)
  }
  return { ok: true, body: Buffer.concat(chunks) }
}

function parseMultipartForm(body: Buffer, contentType: string): MultipartAudioUpload | null {
  const boundary = readMultipartBoundary(contentType)
  if (!boundary) return null
  const boundaryBuf = Buffer.from(`--${boundary}`)
  const parts: Buffer[] = []
  let searchStart = 0

  while (searchStart < body.length) {
    const idx = body.indexOf(boundaryBuf, searchStart)
    if (idx < 0) break
    if (searchStart > 0) parts.push(body.subarray(searchStart, idx))
    searchStart = idx + boundaryBuf.length
    if (body[searchStart] === 0x0d && body[searchStart + 1] === 0x0a) searchStart += 2
  }

  const fields: Record<string, string> = {}
  let fileName = 'annotation-audio'
  let fileData: Buffer | null = null
  let fileContentType = 'application/octet-stream'
  const headerSep = Buffer.from('\r\n\r\n')

  for (const part of parts) {
    const headerEnd = part.indexOf(headerSep)
    if (headerEnd < 0) continue
    const headers = part.subarray(0, headerEnd).toString('utf8')
    let end = part.length
    if (end >= 2 && part[end - 2] === 0x0d && part[end - 1] === 0x0a) end -= 2
    const payload = part.subarray(headerEnd + headerSep.length, end)
    const fieldName = readContentDispositionParam(headers, 'name')
    if (!fieldName) continue
    const uploadFileName = readContentDispositionParam(headers, 'filename')
    if (uploadFileName) {
      fileName = uploadFileName.replace(/[/\\]/g, '_').trim() || fileName
      fileData = payload
      const contentTypeMatch = headers.match(/content-type:\s*([^\r\n]+)/i)
      fileContentType = contentTypeMatch?.[1]?.trim() || fileContentType
      continue
    }
    fields[fieldName] = payload.toString('utf8').trim()
  }

  if (!fileData) return null
  return { fileName, fileData, fileContentType, fields }
}

function readMultipartBoundary(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)
  const boundary = (match?.[1] ?? match?.[2] ?? '').trim()
  return boundary.length > 0 ? boundary : null
}

function readContentDispositionParam(headers: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`${escapedName}="([^"]*)"`, 'i').exec(headers)
  const value = match?.[1]?.trim() ?? ''
  return value.length > 0 ? value : null
}

function normalizeMimeType(value: string): string {
  return value.split(';', 1)[0]?.trim().toLowerCase() || 'application/octet-stream'
}

function readContentLength(req: IncomingMessage): number | null {
  const value = singleHeader(req.headers['content-length'])
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function singleHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function setJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', Buffer.byteLength(body))
  res.end(body)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
