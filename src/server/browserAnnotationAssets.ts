import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import {
  BrowserAnnotationListenStore,
  readBrowserAnnotationBearerToken,
  readBrowserAnnotationSessionSelector,
  sharedBrowserAnnotationListenStore,
} from './browserAnnotationListen.js'

export const BROWSER_ANNOTATION_ASSET_UPLOAD_PATH = '/codex-api/extension/assets/upload'
export const BROWSER_ANNOTATION_ASSET_UPLOAD_MAX_BYTES = 15 * 1024 * 1024

const BROWSER_ANNOTATION_UPLOAD_DIR_NAME = 'codex-web-uploads'
const BROWSER_ANNOTATION_MAX_FILE_NAME_LENGTH = 120

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/webp', 'image/jpeg'])
const AUDIO_MIME_TYPES = new Set(['audio/webm', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/mpeg'])
const MIME_EXTENSIONS: Record<string, string> = {
  'audio/mp4': '.mp4',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/webm': '.webm',
  'audio/x-wav': '.wav',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}

type BrowserAnnotationAssetKind = 'screenshot' | 'crop' | 'audio'

export type BrowserAnnotationUploadedAsset = {
  id: string
  kind: BrowserAnnotationAssetKind
  mimeType: string
  sizeBytes: number
  fileName: string
  absolutePath: string
  localImageUrl?: string
  sessionId: string
  threadId: string
}

export type BrowserAnnotationAssetRouteOptions = {
  store?: BrowserAnnotationListenStore
  maxBytes?: number
}

type MultipartForm = {
  fileName: string
  fileData: Buffer
  fileContentType: string
  fields: Record<string, string>
}

type BodyReadResult =
  | { ok: true; body: Buffer }
  | { ok: false; statusCode: 413; error: string }

export async function handleBrowserAnnotationAssetUploadRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  options: BrowserAnnotationAssetRouteOptions = {},
): Promise<boolean> {
  if (url.pathname !== BROWSER_ANNOTATION_ASSET_UPLOAD_PATH) return false

  if (req.method !== 'POST') {
    setJson(res, 405, { error: 'Browser annotation asset upload requires POST' })
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

  const maxBytes = options.maxBytes ?? BROWSER_ANNOTATION_ASSET_UPLOAD_MAX_BYTES
  const contentLength = readContentLength(req)
  if (contentLength !== null && contentLength > maxBytes) {
    setJson(res, 413, { error: 'Browser annotation asset upload is too large' })
    return true
  }

  const bodyResult = await readRequestBody(req, maxBytes)
  if (!bodyResult.ok) {
    setJson(res, bodyResult.statusCode, { error: bodyResult.error })
    return true
  }

  const contentType = singleHeader(req.headers['content-type']) ?? ''
  const parsed = parseMultipartForm(bodyResult.body, contentType)
  if (!parsed) {
    setJson(res, 400, { error: 'Expected multipart form upload with a file field' })
    return true
  }

  const mimeType = normalizeMimeType(parsed.fileContentType)
  if (!isAllowedMimeType(mimeType)) {
    setJson(res, 415, { error: 'Unsupported browser annotation asset type' })
    return true
  }
  if (parsed.fileData.length === 0) {
    setJson(res, 400, { error: 'Uploaded asset is empty' })
    return true
  }
  if (parsed.fileData.length > maxBytes) {
    setJson(res, 413, { error: 'Browser annotation asset upload is too large' })
    return true
  }

  const kind = normalizeAssetKind(parsed.fields.kind, mimeType)
  if (kind === 'audio' && !AUDIO_MIME_TYPES.has(mimeType)) {
    setJson(res, 400, { error: 'Audio uploads require an audio mime type' })
    return true
  }
  if (kind !== 'audio' && !IMAGE_MIME_TYPES.has(mimeType)) {
    setJson(res, 400, { error: 'Screenshot and crop uploads require an image mime type' })
    return true
  }

  try {
    const asset = await persistUploadedAsset({
      data: parsed.fileData,
      fileName: parsed.fileName,
      kind,
      mimeType,
      sessionId: session.sessionId,
      threadId: session.threadId,
    })
    setJson(res, 200, { ok: true, asset })
  } catch (error) {
    setJson(res, 500, { error: getErrorMessage(error, 'Browser annotation asset upload failed') })
  }
  return true
}

async function persistUploadedAsset(input: {
  data: Buffer
  fileName: string
  kind: BrowserAnnotationAssetKind
  mimeType: string
  sessionId: string
  threadId: string
}): Promise<BrowserAnnotationUploadedAsset> {
  const uploadDir = join(tmpdir(), BROWSER_ANNOTATION_UPLOAD_DIR_NAME)
  await mkdir(uploadDir, { recursive: true })
  const destDir = await mkdtemp(join(uploadDir, 'annotation-'))
  const id = randomBytes(16).toString('hex')
  const fileName = normalizeUploadedFileName(input.fileName, input.mimeType, id)
  const absolutePath = join(destDir, fileName)
  await writeFile(absolutePath, input.data, { mode: 0o600 })
  const written = await stat(absolutePath)
  const asset: BrowserAnnotationUploadedAsset = {
    id,
    kind: input.kind,
    mimeType: input.mimeType,
    sizeBytes: written.size,
    fileName,
    absolutePath,
    sessionId: input.sessionId,
    threadId: input.threadId,
  }
  if (IMAGE_MIME_TYPES.has(input.mimeType)) {
    asset.localImageUrl = `/codex-local-image?path=${encodeURIComponent(absolutePath)}`
  }
  return asset
}

async function readRequestBody(req: IncomingMessage, maxBytes: number): Promise<BodyReadResult> {
  const chunks: Buffer[] = []
  let byteLength = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    byteLength += buffer.byteLength
    if (byteLength > maxBytes) {
      return { ok: false, statusCode: 413, error: 'Browser annotation asset upload is too large' }
    }
    chunks.push(buffer)
  }
  return { ok: true, body: Buffer.concat(chunks) }
}

function parseMultipartForm(body: Buffer, contentType: string): MultipartForm | null {
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
  let fileName = 'uploaded-asset'
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
      fileName = uploadFileName
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

function normalizeUploadedFileName(fileName: string, mimeType: string, fallbackId: string): string {
  const baseName = fileName
    .replace(/[/\\]/g, '_')
    .replace(/[^\w.\-() ]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  const fallbackName = `annotation-${fallbackId}${MIME_EXTENSIONS[mimeType] ?? ''}`
  const candidate = truncateFileName(baseName || fallbackName, MIME_EXTENSIONS[mimeType] ?? '')
  const ext = extname(candidate)
  if (ext) return candidate
  return `${candidate}${MIME_EXTENSIONS[mimeType] ?? ''}`
}

function truncateFileName(fileName: string, preferredExt: string): string {
  if (fileName.length <= BROWSER_ANNOTATION_MAX_FILE_NAME_LENGTH) return fileName
  const ext = extname(fileName) || preferredExt
  const extLength = ext.length
  const maxBaseLength = Math.max(1, BROWSER_ANNOTATION_MAX_FILE_NAME_LENGTH - extLength)
  const base = extname(fileName) ? fileName.slice(0, -extLength) : fileName
  return `${base.slice(0, maxBaseLength)}${ext}`
}

function normalizeMimeType(value: string): string {
  return value.split(';', 1)[0]?.trim().toLowerCase() || 'application/octet-stream'
}

function isAllowedMimeType(value: string): boolean {
  return IMAGE_MIME_TYPES.has(value) || AUDIO_MIME_TYPES.has(value)
}

function normalizeAssetKind(value: string | undefined, mimeType: string): BrowserAnnotationAssetKind {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'crop') return 'crop'
  if (normalized === 'audio') return 'audio'
  if (normalized === 'screenshot') return 'screenshot'
  return AUDIO_MIME_TYPES.has(mimeType) ? 'audio' : 'screenshot'
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

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}
