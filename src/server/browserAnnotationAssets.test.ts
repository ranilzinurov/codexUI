import { createServer, type Server } from 'node:http'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BrowserAnnotationListenStore,
  handleBrowserAnnotationListenRoutes,
  type BrowserAnnotationListenSessionResponse,
} from './browserAnnotationListen'
import {
  BROWSER_ANNOTATION_ASSET_UPLOAD_PATH,
  handleBrowserAnnotationAssetUploadRoute,
  type BrowserAnnotationUploadedAsset,
} from './browserAnnotationAssets'

const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64')
const webpBytes = Buffer.from('UklGRiIAAABXRUJQVlA4IC4AAAAwAQCdASoBAAEAAQAcJaQAA3AA/vuUAAA=', 'base64')
const webmBytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01])

type JsonResponse = {
  status: number
  body: Record<string, unknown>
}

const servers: Server[] = []
const uploadedPaths: string[] = []

async function listenWithStore(
  store: BrowserAnnotationListenStore,
  uploadOptions: { maxBytes?: number } = {},
): Promise<{ baseUrl: string }> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (await handleBrowserAnnotationListenRoutes(req, res, url, { store })) return
    if (await handleBrowserAnnotationAssetUploadRoute(req, res, url, { store, ...uploadOptions })) return
    res.statusCode = 404
    res.end()
  })
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address')
  return { baseUrl: `http://127.0.0.1:${address.port}` }
}

async function requestJson(baseUrl: string, path: string, init: RequestInit = {}): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })
  const body = await response.json() as Record<string, unknown>
  return { status: response.status, body }
}

async function startSession(baseUrl: string, threadId = 'thread-assets'): Promise<BrowserAnnotationListenSessionResponse> {
  const start = await requestJson(baseUrl, '/codex-api/extension/listen/start', {
    method: 'POST',
    body: JSON.stringify({ threadId }),
  })
  const session = start.body.session
  if (!session || typeof session !== 'object' || Array.isArray(session)) {
    throw new Error('Expected session response')
  }
  return session as BrowserAnnotationListenSessionResponse
}

async function uploadAsset(
  baseUrl: string,
  session: BrowserAnnotationListenSessionResponse,
  input: { fileName: string; mimeType: string; bytes: Buffer; kind?: string },
  options: { token?: string; includeSelector?: boolean } = {},
): Promise<JsonResponse> {
  const form = new FormData()
  if (input.kind) form.append('kind', input.kind)
  const blobBytes = new ArrayBuffer(input.bytes.byteLength)
  new Uint8Array(blobBytes).set(input.bytes)
  form.append('file', new Blob([blobBytes], { type: input.mimeType }), input.fileName)
  const path = options.includeSelector === false
    ? BROWSER_ANNOTATION_ASSET_UPLOAD_PATH
    : `${BROWSER_ANNOTATION_ASSET_UPLOAD_PATH}?sessionId=${encodeURIComponent(session.sessionId)}`
  return requestJson(baseUrl, path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${options.token ?? session.pairingToken}` },
    body: form,
  })
}

function assetFrom(body: Record<string, unknown>): BrowserAnnotationUploadedAsset {
  const asset = body.asset
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)) {
    throw new Error('Expected asset response')
  }
  const parsed = asset as BrowserAnnotationUploadedAsset
  uploadedPaths.push(parsed.absolutePath)
  return parsed
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve())
  })))
  await Promise.all(uploadedPaths.splice(0).map((path) => rm(path, { force: true })))
})

describe('browser annotation asset upload endpoint', () => {
  it('uploads PNG and returns a local image reference for the paired listen session', async () => {
    const store = new BrowserAnnotationListenStore({ nowMs: () => Date.UTC(2026, 0, 1), ttlMs: 60_000 })
    const { baseUrl } = await listenWithStore(store)
    const session = await startSession(baseUrl)

    const response = await uploadAsset(baseUrl, session, {
      fileName: 'screen.png',
      mimeType: 'image/png',
      bytes: pngBytes,
      kind: 'screenshot',
    })

    expect(response.status).toBe(200)
    const asset = assetFrom(response.body)
    expect(asset.kind).toBe('screenshot')
    expect(asset.mimeType).toBe('image/png')
    expect(asset.sizeBytes).toBe(pngBytes.length)
    expect(asset.fileName).toBe('screen.png')
    expect(asset.sessionId).toBe(session.sessionId)
    expect(asset.threadId).toBe(session.threadId)
    expect(asset.localImageUrl).toBe(`/codex-local-image?path=${encodeURIComponent(asset.absolutePath)}`)
    expect(existsSync(asset.absolutePath)).toBe(true)
  })

  it('uploads WebP crop fixtures with image-compatible local references', async () => {
    const store = new BrowserAnnotationListenStore({ nowMs: () => Date.UTC(2026, 0, 1), ttlMs: 60_000 })
    const { baseUrl } = await listenWithStore(store)
    const session = await startSession(baseUrl)

    const response = await uploadAsset(baseUrl, session, {
      fileName: 'crop.webp',
      mimeType: 'image/webp',
      bytes: webpBytes,
      kind: 'crop',
    })

    expect(response.status).toBe(200)
    const asset = assetFrom(response.body)
    expect(asset.kind).toBe('crop')
    expect(asset.mimeType).toBe('image/webp')
    expect(asset.localImageUrl).toContain('/codex-local-image?path=')
    expect(existsSync(asset.absolutePath)).toBe(true)
  })

  it('uploads WebM audio fixtures without a local image reference', async () => {
    const store = new BrowserAnnotationListenStore({ nowMs: () => Date.UTC(2026, 0, 1), ttlMs: 60_000 })
    const { baseUrl } = await listenWithStore(store)
    const session = await startSession(baseUrl)

    const response = await uploadAsset(baseUrl, session, {
      fileName: 'voice.webm',
      mimeType: 'audio/webm',
      bytes: webmBytes,
      kind: 'audio',
    })

    expect(response.status).toBe(200)
    const asset = assetFrom(response.body)
    expect(asset.kind).toBe('audio')
    expect(asset.mimeType).toBe('audio/webm')
    expect(asset.sizeBytes).toBe(webmBytes.length)
    expect(asset.localImageUrl).toBeUndefined()
    expect(existsSync(asset.absolutePath)).toBe(true)
  })

  it('rejects unsupported mime types', async () => {
    const store = new BrowserAnnotationListenStore({ nowMs: () => Date.UTC(2026, 0, 1), ttlMs: 60_000 })
    const { baseUrl } = await listenWithStore(store)
    const session = await startSession(baseUrl)

    const response = await uploadAsset(baseUrl, session, {
      fileName: 'note.txt',
      mimeType: 'text/plain',
      bytes: Buffer.from('not an upload type'),
    })

    expect(response.status).toBe(415)
    expect(response.body.error).toBe('Unsupported browser annotation asset type')
  })

  it('rejects uploads whose bytes do not match the declared mime type', async () => {
    const store = new BrowserAnnotationListenStore({ nowMs: () => Date.UTC(2026, 0, 1), ttlMs: 60_000 })
    const { baseUrl } = await listenWithStore(store)
    const session = await startSession(baseUrl)

    const response = await uploadAsset(baseUrl, session, {
      fileName: 'screen.png',
      mimeType: 'image/png',
      bytes: Buffer.from('not actually a png'),
    })

    expect(response.status).toBe(415)
    expect(response.body.error).toBe('Uploaded asset content does not match declared mime type')
  })

  it('rejects oversized upload bodies before persisting the asset', async () => {
    const store = new BrowserAnnotationListenStore({ nowMs: () => Date.UTC(2026, 0, 1), ttlMs: 60_000 })
    const { baseUrl } = await listenWithStore(store, { maxBytes: 64 })
    const session = await startSession(baseUrl)

    const response = await uploadAsset(baseUrl, session, {
      fileName: 'screen.png',
      mimeType: 'image/png',
      bytes: pngBytes,
      kind: 'screenshot',
    })

    expect(response.status).toBe(413)
    expect(response.body.error).toBe('Browser annotation asset upload is too large')
  })

  it('rejects missing and wrong upload bearer tokens before accepting assets', async () => {
    const store = new BrowserAnnotationListenStore({ nowMs: () => Date.UTC(2026, 0, 1), ttlMs: 60_000 })
    const { baseUrl } = await listenWithStore(store)
    const session = await startSession(baseUrl)
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(pngBytes)], { type: 'image/png' }), 'screen.png')

    const missing = await requestJson(baseUrl, `${BROWSER_ANNOTATION_ASSET_UPLOAD_PATH}?sessionId=${encodeURIComponent(session.sessionId)}`, {
      method: 'POST',
      body: form,
    })
    const wrong = await uploadAsset(baseUrl, session, {
      fileName: 'screen.png',
      mimeType: 'image/png',
      bytes: pngBytes,
    }, { token: 'wrong-token' })

    expect(missing.status).toBe(401)
    expect(missing.body.error).toBe('Missing extension bearer token')
    expect(wrong.status).toBe(401)
    expect(wrong.body.error).toBe('Invalid or expired extension bearer token')
  })

  it('rejects uploads without a query selector before reading multipart fields', async () => {
    const store = new BrowserAnnotationListenStore({ nowMs: () => Date.UTC(2026, 0, 1), ttlMs: 60_000 })
    const { baseUrl } = await listenWithStore(store)
    const session = await startSession(baseUrl)

    const response = await uploadAsset(baseUrl, session, {
      fileName: 'screen.png',
      mimeType: 'image/png',
      bytes: pngBytes,
    }, { includeSelector: false })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('Missing sessionId')
  })

  it('rejects revoked sessions on upload', async () => {
    const store = new BrowserAnnotationListenStore({ nowMs: () => Date.UTC(2026, 0, 1), ttlMs: 60_000 })
    const { baseUrl } = await listenWithStore(store)
    const session = await startSession(baseUrl)
    await requestJson(baseUrl, '/codex-api/extension/listen/stop', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.pairingToken}` },
      body: JSON.stringify({ sessionId: session.sessionId }),
    })

    const response = await uploadAsset(baseUrl, session, {
      fileName: 'screen.png',
      mimeType: 'image/png',
      bytes: pngBytes,
    })

    expect(response.status).toBe(401)
    expect(response.body.error).toBe('Invalid or expired extension bearer token')
  })

  it('returns a 400 for malformed multipart uploads', async () => {
    const store = new BrowserAnnotationListenStore({ nowMs: () => Date.UTC(2026, 0, 1), ttlMs: 60_000 })
    const { baseUrl } = await listenWithStore(store)
    const session = await startSession(baseUrl)

    const response = await requestJson(baseUrl, `${BROWSER_ANNOTATION_ASSET_UPLOAD_PATH}?sessionId=${encodeURIComponent(session.sessionId)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.pairingToken}`,
        'Content-Type': 'multipart/form-data; boundary=missing-file',
      },
      body: '--missing-file--\r\n',
    })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('Expected multipart form upload with a file field')
  })

  it('caps very long uploaded filenames before writing the asset', async () => {
    const store = new BrowserAnnotationListenStore({ nowMs: () => Date.UTC(2026, 0, 1), ttlMs: 60_000 })
    const { baseUrl } = await listenWithStore(store)
    const session = await startSession(baseUrl)

    const response = await uploadAsset(baseUrl, session, {
      fileName: `${'long-name-'.repeat(40)}.png`,
      mimeType: 'image/png',
      bytes: pngBytes,
    })

    expect(response.status).toBe(200)
    const asset = assetFrom(response.body)
    expect(asset.fileName.length).toBeLessThanOrEqual(120)
    expect(asset.fileName.endsWith('.png')).toBe(true)
    expect(existsSync(asset.absolutePath)).toBe(true)
  })
})
