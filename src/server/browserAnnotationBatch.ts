import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'
import {
  ANNOTATION_REDACTED_VALUE,
  isSensitiveAnnotationHeaderName,
  validateAnnotationBatchPayload,
  type AnnotationBatch,
  type AnnotationElementTarget,
  type DevToolsCapturedBody,
  type DevToolsHeaderRecord,
  type DevToolsNetworkRecord,
} from '../api/browserAnnotationContracts.js'
import type { StoredQueuedMessage } from './codexAppServerBridge.js'
import { isBrowserAnnotationUploadedImageRefForSession } from './browserAnnotationAssets.js'
import {
  BrowserAnnotationListenStore,
  readBrowserAnnotationBearerToken,
  readBrowserAnnotationSessionSelector,
  sharedBrowserAnnotationListenStore,
} from './browserAnnotationListen.js'

export const BROWSER_ANNOTATION_BATCH_PATH = '/codex-api/extension/annotation-batch'
export const BROWSER_ANNOTATION_BATCH_MAX_BYTES = 1024 * 1024

const MAX_PROMPT_ANNOTATIONS = 50
const MAX_PROMPT_CONSOLE_ROWS = 100
const MAX_PROMPT_NETWORK_ROWS = 100
const BROWSER_ANNOTATION_UPLOAD_ROOT = resolve(tmpdir(), 'codex-web-uploads')
const SENSITIVE_QUERY_NAMES = new Set([
  'access_token',
  'apikey',
  'api_key',
  'auth',
  'authorization',
  'client_secret',
  'code',
  'cookie',
  'id_token',
  'password',
  'refresh_token',
  'secret',
  'session',
  'token',
])

export type BrowserAnnotationBatchRouteOptions = {
  store?: BrowserAnnotationListenStore
  maxBytes?: number
  appendQueuedMessage?: (threadId: string, message: StoredQueuedMessage) => Promise<void>
  scheduleThreadQueueDrain?: (threadId: string, delayMs?: number) => void
  idFactory?: () => string
  nowIso?: () => string
}

type JsonBodyReadResult =
  | { ok: true; body: unknown }
  | { ok: false; statusCode: 400 | 413; error: string }

export async function handleBrowserAnnotationBatchRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  options: BrowserAnnotationBatchRouteOptions = {},
): Promise<boolean> {
  if (url.pathname !== BROWSER_ANNOTATION_BATCH_PATH) return false

  if (req.method !== 'POST') {
    setJson(res, 405, { error: 'Browser annotation batch requires POST' })
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

  const appendQueuedMessage = options.appendQueuedMessage
  if (!appendQueuedMessage) {
    setJson(res, 503, { error: 'Browser annotation queue is not available' })
    return true
  }

  const maxBytes = options.maxBytes ?? BROWSER_ANNOTATION_BATCH_MAX_BYTES
  const contentLength = readContentLength(req)
  if (contentLength !== null && contentLength > maxBytes) {
    setJson(res, 413, { error: 'Browser annotation batch body is too large' })
    return true
  }

  const bodyResult = await readJsonBody(req, maxBytes)
  if (!bodyResult.ok) {
    setJson(res, bodyResult.statusCode, { error: bodyResult.error })
    return true
  }

  const validation = validateAnnotationBatchPayload(bodyResult.body)
  if (!validation.ok) {
    setJson(res, 400, { error: 'Invalid browser annotation batch', details: validation.errors })
    return true
  }

  const batch = bodyResult.body as AnnotationBatch
  const activeSession = store.getAuthorizedSession(token, selector)
  if (!activeSession) {
    setJson(res, 401, { error: 'Invalid, expired, or revoked extension bearer token' })
    return true
  }
  if (batch.targetThreadId && batch.targetThreadId !== activeSession.threadId) {
    setJson(res, 400, { error: 'Batch targetThreadId does not match the authorized listen session' })
    return true
  }

  const queuedAtIso = options.nowIso?.() ?? new Date().toISOString()
  const assembled = buildBrowserAnnotationQueuedMessage(batch, {
    id: options.idFactory?.() ?? `annotation-batch-${Date.now()}-${randomBytes(3).toString('hex')}`,
    nowIso: queuedAtIso,
    sessionId: activeSession.sessionId,
    threadId: activeSession.threadId,
  })

  const recordedSession = store.recordReceivedBatch(activeSession.sessionId, {
    batchId: batch.batchId,
    queuedMessageId: assembled.message.id,
    receivedAtIso: queuedAtIso,
    annotationCount: batch.items.length,
    imageCount: assembled.imageCount,
    consoleCount: batch.devTools?.console.length ?? 0,
    networkCount: batch.devTools?.network.length ?? 0,
  })
  if (!recordedSession) {
    setJson(res, 401, { error: 'Invalid, expired, or revoked extension bearer token' })
    return true
  }
  await appendQueuedMessage(activeSession.threadId, assembled.message)
  options.scheduleThreadQueueDrain?.(activeSession.threadId, 0)

  setJson(res, 200, {
    ok: true,
    result: {
      status: 'queued',
      threadId: activeSession.threadId,
      batchId: batch.batchId,
      annotationCount: batch.items.length,
      imageCount: assembled.imageCount,
      consoleCount: batch.devTools?.console.length ?? 0,
      networkCount: batch.devTools?.network.length ?? 0,
      queuedMessageId: assembled.message.id,
    },
  })
  return true
}

export function buildBrowserAnnotationQueuedMessage(
  batch: AnnotationBatch,
  input: { id: string; nowIso: string; sessionId?: string; threadId?: string },
): { message: StoredQueuedMessage; imageCount: number } {
  const imageUrls = extractLocalImageUrls(batch, input)
  return {
    imageCount: imageUrls.length,
    message: {
      id: input.id,
      text: buildBrowserAnnotationPrompt(batch, input.nowIso, imageUrls.length),
      imageUrls,
      skills: [],
      fileAttachments: [],
      collaborationMode: 'default',
      reasoningEffort: '',
    },
  }
}

function buildBrowserAnnotationPrompt(batch: AnnotationBatch, queuedAtIso: string, imageCount: number): string {
  const lines: string[] = [
    '# Browser annotation batch',
    '',
    `Batch ID: ${batch.batchId}`,
    `Queued at: ${queuedAtIso}`,
    `Created at: ${batch.createdAtIso}`,
    `Source: ${batch.source.kind}${batch.source.extensionVersion ? ` ${batch.source.extensionVersion}` : ''}${batch.source.browserName ? ` on ${batch.source.browserName}` : ''}`,
    `Primary page: ${formatPage(batch.page)}`,
    `Annotations: ${batch.items.length}`,
    `Uploaded images attached: ${imageCount}`,
    '',
    'Privacy handling: sensitive headers and body fields are expected to be redacted by the extension contract. This prompt also redacts sensitive URL query parameters and omits body text for not-captured/redacted body states.',
    '',
    '## Request for Codex',
    'Use the annotated browser context below to understand the user-visible issue. Correlate each annotation with its DOM target, selector, note, voice transcript, attached screenshot image, and DevTools console/network evidence when present. Implement the appropriate fix in the repository when the cause is actionable, then run focused verification and report what changed.',
    '',
    '## Annotation notes',
  ]

  for (const [index, item] of batch.items.slice(0, MAX_PROMPT_ANNOTATIONS).entries()) {
    lines.push('', `### ${index + 1}. ${item.kind} annotation (${item.id})`)
    lines.push(`Created: ${item.createdAtIso}`)
    lines.push(`Page: ${formatPage(item.page)}`)
    if (item.viewport) {
      lines.push(`Viewport: ${item.viewport.width}x${item.viewport.height} @${item.viewport.devicePixelRatio}, scroll ${item.viewport.scrollX},${item.viewport.scrollY}`)
    }
    appendOptionalText(lines, 'Note', item.noteText)
    appendOptionalText(lines, 'Selected text', item.selectedText)
    appendTarget(lines, item.target)
    if (item.screenshotAssetId) lines.push(`Screenshot asset: ${item.screenshotAssetId}`)
    if (item.voiceNote) {
      lines.push(`Voice note: ${item.voiceNote.id} (${item.voiceNote.transcriptStatus}, ${item.voiceNote.durationMs}ms)`)
      appendOptionalText(lines, 'Voice transcript', item.voiceNote.transcriptText)
      appendOptionalText(lines, 'Voice error', item.voiceNote.errorMessage)
    }
    if (item.devToolsContext) {
      lines.push(`DevTools context: ${item.devToolsContext.requestIds.length} request(s), ${item.devToolsContext.consoleEntryIds.length} console entr(y/ies) from ${item.devToolsContext.startedAtIso} to ${item.devToolsContext.endedAtIso}`)
    }
  }
  if (batch.items.length > MAX_PROMPT_ANNOTATIONS) {
    lines.push('', `Omitted ${batch.items.length - MAX_PROMPT_ANNOTATIONS} additional annotation(s) from this prompt for size.`)
  }

  if (batch.devTools) {
    lines.push('', '## DevTools summary')
    lines.push(`Captured: ${batch.devTools.captureStartedAtIso} to ${batch.devTools.captureEndedAtIso}`)
    lines.push(`Summary: ${batch.devTools.summary.consoleCount} console, ${batch.devTools.summary.networkCount} network, ${batch.devTools.summary.errorCount} errors, ${batch.devTools.summary.redactedHeaderCount} redacted headers, ${batch.devTools.summary.capturedBodyCount} captured bodies, ${batch.devTools.summary.trimmedBodyCount} trimmed bodies, ${batch.devTools.summary.omittedBodyCount} omitted bodies`)

    lines.push('', '### Console')
    for (const entry of batch.devTools.console.slice(0, MAX_PROMPT_CONSOLE_ROWS)) {
      const location = entry.url ? ` (${redactSensitiveUrl(entry.url)}${entry.lineNumber !== undefined ? `:${entry.lineNumber}` : ''})` : ''
      lines.push(`- [${entry.level}] ${entry.timestampIso}${location}: ${truncateText(entry.text, 700)}`)
    }
    if (batch.devTools.console.length > MAX_PROMPT_CONSOLE_ROWS) {
      lines.push(`- Omitted ${batch.devTools.console.length - MAX_PROMPT_CONSOLE_ROWS} additional console entr(y/ies).`)
    }

    lines.push('', '### Network')
    for (const request of batch.devTools.network.slice(0, MAX_PROMPT_NETWORK_ROWS)) {
      appendNetworkRecord(lines, request)
    }
    if (batch.devTools.network.length > MAX_PROMPT_NETWORK_ROWS) {
      lines.push('', `Omitted ${batch.devTools.network.length - MAX_PROMPT_NETWORK_ROWS} additional network request(s).`)
    }
  }

  return lines.join('\n')
}

function appendNetworkRecord(lines: string[], request: DevToolsNetworkRecord): void {
  const status = request.status !== undefined ? `${request.status}${request.statusText ? ` ${request.statusText}` : ''}` : 'pending'
  lines.push('', `- ${request.method} ${redactSensitiveUrl(request.url)} -> ${status}${request.errorText ? ` (${request.errorText})` : ''}`)
  if (request.resourceType) lines.push(`  Type: ${request.resourceType}`)
  appendHeaders(lines, 'Request headers', request.requestHeaders)
  appendHeaders(lines, 'Response headers', request.responseHeaders)
  appendCapturedBody(lines, 'Request body', request.requestBody)
  appendCapturedBody(lines, 'Response body', request.responseBody)
}

function appendHeaders(lines: string[], label: string, headers: DevToolsHeaderRecord[]): void {
  if (headers.length === 0) return
  const formatted = headers
    .slice(0, 12)
    .map((header) => `${header.name}: ${isSensitiveAnnotationHeaderName(header.name) ? ANNOTATION_REDACTED_VALUE : truncateText(header.value, 180)}`)
    .join('; ')
  lines.push(`  ${label}: ${formatted}${headers.length > 12 ? `; +${headers.length - 12} more` : ''}`)
}

function appendCapturedBody(lines: string[], label: string, body: DevToolsCapturedBody | undefined): void {
  if (!body) return
  if (body.state === 'captured' || body.state === 'trimmed') {
    lines.push(`  ${label} (${body.state}, ${body.byteLength}/${body.originalByteLength ?? body.byteLength} bytes, redactionApplied=${body.redactionApplied}): ${truncateText(body.text, 1200)}`)
    return
  }
  const reason = 'reason' in body ? body.reason : 'unknown'
  lines.push(`  ${label}: ${body.state} (${reason})`)
}

function appendTarget(lines: string[], target: AnnotationElementTarget | undefined): void {
  if (!target) return
  lines.push('Target element:')
  if (target.tagName) lines.push(`- Tag: ${target.tagName}`)
  if (target.selector) lines.push(`- Selector: ${target.selector}`)
  if (target.xpath) lines.push(`- XPath: ${target.xpath}`)
  if (target.ariaLabel) lines.push(`- ARIA label: ${target.ariaLabel}`)
  if (target.textSnippet) lines.push(`- Text snippet: ${truncateText(target.textSnippet, 500)}`)
  if (target.rect) lines.push(`- Rect: x=${target.rect.x}, y=${target.rect.y}, w=${target.rect.width}, h=${target.rect.height}`)
}

function appendOptionalText(lines: string[], label: string, value: string | undefined): void {
  const trimmed = value?.trim()
  if (trimmed) lines.push(`${label}: ${truncateText(trimmed, 1000)}`)
}

function formatPage(page: AnnotationBatch['page']): string {
  const title = page.title?.trim()
  const origin = page.origin?.trim()
  return `${title ? `${title} - ` : ''}${redactSensitiveUrl(page.url)}${origin ? ` (${origin})` : ''}`
}

function extractLocalImageUrls(
  batch: AnnotationBatch,
  selector: { sessionId?: string; threadId?: string },
): string[] {
  const urls: string[] = []
  if (!selector.sessionId || !selector.threadId) return urls
  for (const asset of batch.assets) {
    if (asset.kind !== 'page-screenshot' && asset.kind !== 'annotation-screenshot') continue
    const record = asset as typeof asset & { localImageUrl?: unknown; absolutePath?: unknown }
    const storageKey = typeof record.storageKey === 'string' ? record.storageKey.trim() : ''
    const localImageUrl = normalizeServerIssuedLocalImageRef(storageKey)
    if (localImageUrl && !isBrowserAnnotationUploadedImageRefForSession(localImageUrl, {
      sessionId: selector.sessionId,
      threadId: selector.threadId,
    })) {
      continue
    }
    if (localImageUrl) urls.push(localImageUrl)
  }
  return Array.from(new Set(urls))
}

function normalizeServerIssuedLocalImageRef(value: string): string | null {
  if (!value) return null
  let parsed: URL
  try {
    parsed = new URL(value, 'http://localhost')
  } catch {
    return null
  }
  if (parsed.pathname !== '/codex-local-image') return null
  const rawPath = parsed.searchParams.get('path')?.trim() ?? ''
  if (!rawPath) return null
  const resolvedPath = resolve(rawPath)
  const uploadRootWithSep = BROWSER_ANNOTATION_UPLOAD_ROOT.endsWith(sep)
    ? BROWSER_ANNOTATION_UPLOAD_ROOT
    : `${BROWSER_ANNOTATION_UPLOAD_ROOT}${sep}`
  if (resolvedPath !== BROWSER_ANNOTATION_UPLOAD_ROOT && !resolvedPath.startsWith(uploadRootWithSep)) {
    return null
  }
  return `/codex-local-image?path=${encodeURIComponent(resolvedPath)}`
}

function redactSensitiveUrl(value: string): string {
  try {
    const parsed = new URL(value)
    for (const name of Array.from(parsed.searchParams.keys())) {
      if (SENSITIVE_QUERY_NAMES.has(name.trim().toLowerCase().replace(/-/g, '_'))) {
        parsed.searchParams.set(name, ANNOTATION_REDACTED_VALUE)
      }
    }
    if (parsed.username) parsed.username = ANNOTATION_REDACTED_VALUE
    if (parsed.password) parsed.password = ANNOTATION_REDACTED_VALUE
    return parsed.toString()
  } catch {
    return truncateText(value, 1000)
  }
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 16))}... [truncated]`
}

async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<JsonBodyReadResult> {
  const chunks: Buffer[] = []
  let byteLength = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    byteLength += buffer.byteLength
    if (byteLength > maxBytes) {
      return { ok: false, statusCode: 413, error: 'Browser annotation batch body is too large' }
    }
    chunks.push(buffer)
  }
  const raw = Buffer.concat(chunks)
  if (raw.length === 0) return { ok: false, statusCode: 400, error: 'Malformed JSON body' }
  try {
    return { ok: true, body: JSON.parse(raw.toString('utf8')) as unknown }
  } catch {
    return { ok: false, statusCode: 400, error: 'Malformed JSON body' }
  }
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
