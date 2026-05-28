import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ANNOTATION_BATCH_SCHEMA_VERSION,
  ANNOTATION_REDACTED_VALUE,
  DEFAULT_ANNOTATION_PRIVACY_RULES,
  trimAnnotationBodyText,
  type AnnotationBatch,
} from '../api/browserAnnotationContracts'
import type { StoredQueuedMessage } from './codexAppServerBridge'
import { registerBrowserAnnotationUploadedAsset } from './browserAnnotationAssets'
import {
  BrowserAnnotationListenStore,
  handleBrowserAnnotationListenRoutes,
  type BrowserAnnotationListenSessionResponse,
} from './browserAnnotationListen'
import {
  BROWSER_ANNOTATION_BATCH_PATH,
  buildBrowserAnnotationQueuedMessage,
  handleBrowserAnnotationBatchRoute,
} from './browserAnnotationBatch'

type JsonResponse = {
  status: number
  body: Record<string, unknown>
}

const servers: Server[] = []

async function listenWithStore(
  store: BrowserAnnotationListenStore,
  queue: {
    messages: Array<{ threadId: string; message: StoredQueuedMessage }>
    scheduled: Array<{ threadId: string; delayMs?: number }>
  },
  options: { maxBytes?: number } = {},
): Promise<{ baseUrl: string }> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (await handleBrowserAnnotationListenRoutes(req, res, url, { store })) return
    if (await handleBrowserAnnotationBatchRoute(req, res, url, {
      store,
      maxBytes: options.maxBytes,
      appendQueuedMessage: async (threadId, message) => {
        queue.messages.push({ threadId, message })
      },
      scheduleThreadQueueDrain: (threadId, delayMs) => {
        queue.scheduled.push({ threadId, delayMs })
      },
      idFactory: () => 'queued-batch-message',
      nowIso: () => '2026-05-28T12:00:00.000Z',
    })) return
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

async function startSession(baseUrl: string, threadId = 'thread-batch'): Promise<BrowserAnnotationListenSessionResponse> {
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

async function postBatch(
  baseUrl: string,
  session: BrowserAnnotationListenSessionResponse,
  batch: unknown,
  options: { token?: string; includeSelector?: boolean } = {},
): Promise<JsonResponse> {
  const path = options.includeSelector === false
    ? BROWSER_ANNOTATION_BATCH_PATH
    : `${BROWSER_ANNOTATION_BATCH_PATH}?sessionId=${encodeURIComponent(session.sessionId)}&threadId=${encodeURIComponent(session.threadId)}`
  return requestJson(baseUrl, path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${options.token ?? session.pairingToken}` },
    body: JSON.stringify(batch),
  })
}

function createBatch(overrides: Partial<AnnotationBatch> = {}): AnnotationBatch {
  return {
    schemaVersion: ANNOTATION_BATCH_SCHEMA_VERSION,
    batchId: 'batch-1',
    createdAtIso: '2026-05-28T11:59:00.000Z',
    source: {
      kind: 'chrome-extension',
      extensionVersion: '0.0.1',
      browserName: 'Chrome',
    },
    targetThreadId: 'thread-batch',
    page: {
      url: 'https://app.example.test/dashboard?token=secret-token&view=main',
      title: 'Dashboard',
      origin: 'https://app.example.test',
    },
    privacy: DEFAULT_ANNOTATION_PRIVACY_RULES,
    assets: [
      {
        id: 'asset-audio',
        kind: 'voice-note-audio',
        mimeType: 'audio/webm',
        byteLength: 256,
        uploadedAtIso: '2026-05-28T11:59:01.000Z',
      },
    ],
    items: [
      {
        id: 'annotation-1',
        kind: 'text',
        createdAtIso: '2026-05-28T11:59:01.000Z',
        page: {
          url: 'https://app.example.test/dashboard?token=secret-token',
          title: 'Dashboard',
        },
        noteText: 'The save button never becomes enabled.',
        selectedText: 'Save',
        target: {
          selector: 'button[data-testid="save"]',
          tagName: 'button',
          textSnippet: 'Save',
          rect: { x: 10, y: 20, width: 80, height: 32 },
        },
      },
      {
        id: 'annotation-2',
        kind: 'voice',
        createdAtIso: '2026-05-28T11:59:02.000Z',
        page: {
          url: 'https://app.example.test/dashboard',
          title: 'Dashboard',
        },
        voiceNote: {
          id: 'voice-1',
          assetId: 'asset-audio',
          mimeType: 'audio/webm',
          durationMs: 2_000,
          transcriptStatus: 'complete',
          transcriptText: 'Please inspect the failed save request.',
        },
      },
    ],
    devTools: {
      id: 'snapshot-1',
      capturedAtIso: '2026-05-28T11:59:03.000Z',
      attachMode: 'explicit-user-enabled',
      captureStartedAtIso: '2026-05-28T11:58:30.000Z',
      captureEndedAtIso: '2026-05-28T11:59:03.000Z',
      privacy: DEFAULT_ANNOTATION_PRIVACY_RULES,
      summary: {
        consoleCount: 1,
        networkCount: 1,
        errorCount: 1,
        redactedHeaderCount: 1,
        capturedBodyCount: 1,
        trimmedBodyCount: 0,
        omittedBodyCount: 1,
      },
      console: [
        {
          id: 'console-1',
          level: 'error',
          timestampIso: '2026-05-28T11:59:01.500Z',
          text: 'Save failed with 500',
          url: 'https://app.example.test/dashboard?password=secret',
          lineNumber: 42,
        },
      ],
      network: [
        {
          id: 'request-1',
          startedAtIso: '2026-05-28T11:59:01.000Z',
          finishedAtIso: '2026-05-28T11:59:01.400Z',
          method: 'POST',
          url: 'https://api.example.test/save?access_token=secret-token&id=123',
          status: 500,
          statusText: 'Internal Server Error',
          resourceType: 'fetch',
          requestHeaders: [
            { name: 'authorization', value: ANNOTATION_REDACTED_VALUE, redacted: true },
            { name: 'content-type', value: 'application/json' },
          ],
          responseHeaders: [],
          requestBody: trimAnnotationBodyText(`{"password":"${ANNOTATION_REDACTED_VALUE}","name":"Alice"}`, {
            capBytes: 256,
            redactionApplied: true,
          }),
          responseBody: {
            state: 'not-captured',
            reason: 'default-privacy',
            userOptIn: false,
            capBytes: 256,
          },
        },
      ],
    },
    ...overrides,
  }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve())
  })))
})

describe('browser annotation batch endpoint', () => {
  it('queues a valid two-annotation batch and schedules immediate backend draining', async () => {
    const store = new BrowserAnnotationListenStore({ nowMs: () => Date.UTC(2026, 4, 28), ttlMs: 60_000 })
    const queue = { messages: [] as Array<{ threadId: string; message: StoredQueuedMessage }>, scheduled: [] as Array<{ threadId: string; delayMs?: number }> }
    const { baseUrl } = await listenWithStore(store, queue)
    const session = await startSession(baseUrl)

    const response = await postBatch(baseUrl, session, createBatch())

    expect(response.status).toBe(200)
    expect(response.body.result).toMatchObject({
      status: 'queued',
      threadId: 'thread-batch',
      batchId: 'batch-1',
      annotationCount: 2,
      consoleCount: 1,
      networkCount: 1,
      queuedMessageId: 'queued-batch-message',
    })
    expect(queue.messages).toHaveLength(1)
    expect(queue.messages[0]?.threadId).toBe('thread-batch')
    expect(queue.messages[0]?.message.text).toContain('## Request for Codex')
    expect(queue.messages[0]?.message.text).toContain('Implement the appropriate fix in the repository')
    expect(queue.messages[0]?.message.text).toContain('DOM target, selector, note, voice transcript, attached screenshot image, and DevTools console/network evidence')
    expect(queue.messages[0]?.message.text).toContain('The save button never becomes enabled.')
    expect(queue.messages[0]?.message.text).toContain('Voice note: voice-1 (complete, 2000ms)')
    expect(queue.messages[0]?.message.text).toContain('Please inspect the failed save request.')
    expect(queue.scheduled).toEqual([{ threadId: 'thread-batch', delayMs: 0 }])
  })

  it('uses the same backend queue path when the processor will later find a busy thread', async () => {
    const store = new BrowserAnnotationListenStore({ nowMs: () => Date.UTC(2026, 4, 28), ttlMs: 60_000 })
    const queue = { messages: [] as Array<{ threadId: string; message: StoredQueuedMessage }>, scheduled: [] as Array<{ threadId: string; delayMs?: number }> }
    const { baseUrl } = await listenWithStore(store, queue)
    const session = await startSession(baseUrl)

    const response = await postBatch(baseUrl, session, createBatch({ batchId: 'busy-thread-batch' }))

    expect(response.status).toBe(200)
    expect(response.body.result).toMatchObject({ status: 'queued', threadId: 'thread-batch' })
    expect(queue.messages).toHaveLength(1)
    expect(queue.scheduled[0]).toEqual({ threadId: 'thread-batch', delayMs: 0 })
  })

  it('rejects missing or invalid extension authorization before accepting malformed JSON', async () => {
    const store = new BrowserAnnotationListenStore({ nowMs: () => Date.UTC(2026, 4, 28), ttlMs: 60_000 })
    const queue = { messages: [] as Array<{ threadId: string; message: StoredQueuedMessage }>, scheduled: [] as Array<{ threadId: string; delayMs?: number }> }
    const { baseUrl } = await listenWithStore(store, queue)
    const session = await startSession(baseUrl)
    const path = `${BROWSER_ANNOTATION_BATCH_PATH}?sessionId=${encodeURIComponent(session.sessionId)}`

    const missing = await requestJson(baseUrl, path, { method: 'POST', body: '{' })
    const wrong = await requestJson(baseUrl, path, {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-token' },
      body: '{',
    })

    expect(missing.status).toBe(401)
    expect(missing.body.error).toBe('Missing extension bearer token')
    expect(wrong.status).toBe(401)
    expect(wrong.body.error).toBe('Invalid or expired extension bearer token')
    expect(queue.messages).toHaveLength(0)
  })

  it('rejects invalid or malformed batches without queueing', async () => {
    const store = new BrowserAnnotationListenStore({ nowMs: () => Date.UTC(2026, 4, 28), ttlMs: 60_000 })
    const queue = { messages: [] as Array<{ threadId: string; message: StoredQueuedMessage }>, scheduled: [] as Array<{ threadId: string; delayMs?: number }> }
    const { baseUrl } = await listenWithStore(store, queue)
    const session = await startSession(baseUrl)

    const malformedJson = await requestJson(baseUrl, `${BROWSER_ANNOTATION_BATCH_PATH}?sessionId=${encodeURIComponent(session.sessionId)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.pairingToken}` },
      body: '{',
    })
    const invalidBatch = await postBatch(baseUrl, session, { schemaVersion: 1, items: [] })

    expect(malformedJson.status).toBe(400)
    expect(malformedJson.body.error).toBe('Malformed JSON body')
    expect(invalidBatch.status).toBe(400)
    expect(invalidBatch.body.error).toBe('Invalid browser annotation batch')
    expect(queue.messages).toHaveLength(0)
  })

  it('includes uploaded screenshot asset refs as localImage-compatible queue image URLs', async () => {
    const uploadedPath = join(tmpdir(), 'codex-web-uploads', 'annotation-session', 'shot.png')
    const localImageUrl = `/codex-local-image?path=${encodeURIComponent(uploadedPath)}`
    registerBrowserAnnotationUploadedAsset({
      id: 'asset-shot',
      kind: 'screenshot',
      mimeType: 'image/png',
      sizeBytes: 128,
      fileName: 'shot.png',
      absolutePath: uploadedPath,
      localImageUrl,
      sessionId: 'session-image',
      threadId: 'thread-batch',
    })
    const batch = createBatch({
      assets: [
        {
          id: 'asset-shot',
          kind: 'annotation-screenshot',
          mimeType: 'image/png',
          byteLength: 128,
          uploadedAtIso: '2026-05-28T11:59:01.000Z',
          storageKey: localImageUrl,
        },
        {
          id: 'asset-audio',
          kind: 'voice-note-audio',
          mimeType: 'audio/webm',
          byteLength: 256,
          uploadedAtIso: '2026-05-28T11:59:01.000Z',
          storageKey: '/tmp/codex-web-uploads/voice.webm',
        },
      ],
    })

    const assembled = buildBrowserAnnotationQueuedMessage(batch, {
      id: 'queued-with-image',
      nowIso: '2026-05-28T12:00:00.000Z',
      sessionId: 'session-image',
      threadId: 'thread-batch',
    })

    expect(assembled.imageCount).toBe(1)
    expect(assembled.message.imageUrls).toEqual([localImageUrl])
  })

  it('rejects upload-root image refs that were not issued for the same session', async () => {
    const otherSessionPath = join(tmpdir(), 'codex-web-uploads', 'annotation-other', 'shot.png')
    const otherSessionUrl = `/codex-local-image?path=${encodeURIComponent(otherSessionPath)}`
    registerBrowserAnnotationUploadedAsset({
      id: 'other-shot',
      kind: 'screenshot',
      mimeType: 'image/png',
      sizeBytes: 128,
      fileName: 'shot.png',
      absolutePath: otherSessionPath,
      localImageUrl: otherSessionUrl,
      sessionId: 'other-session',
      threadId: 'thread-batch',
    })
    const batch = createBatch({
      assets: [
        {
          id: 'other-shot',
          kind: 'annotation-screenshot',
          mimeType: 'image/png',
          byteLength: 128,
          uploadedAtIso: '2026-05-28T11:59:01.000Z',
          storageKey: otherSessionUrl,
        },
      ],
    })

    const assembled = buildBrowserAnnotationQueuedMessage(batch, {
      id: 'reject-other-session',
      nowIso: '2026-05-28T12:00:00.000Z',
      sessionId: 'current-session',
      threadId: 'thread-batch',
    })

    expect(assembled.imageCount).toBe(0)
    expect(assembled.message.imageUrls).toEqual([])
  })

  it('rejects arbitrary local image paths from batch asset refs', async () => {
    const batch = createBatch({
      assets: [
        {
          id: 'private-shot',
          kind: 'annotation-screenshot',
          mimeType: 'image/png',
          byteLength: 128,
          uploadedAtIso: '2026-05-28T11:59:01.000Z',
          storageKey: '/codex-local-image?path=%2Fhome%2Fuser%2Fprivate.png',
        },
        {
          id: 'direct-absolute-path',
          kind: 'page-screenshot',
          mimeType: 'image/png',
          byteLength: 128,
          uploadedAtIso: '2026-05-28T11:59:01.000Z',
          storageKey: '/tmp/not-codex-web-uploads/shot.png',
        },
      ],
    })

    const assembled = buildBrowserAnnotationQueuedMessage(batch, {
      id: 'reject-private-paths',
      nowIso: '2026-05-28T12:00:00.000Z',
      sessionId: 'session-private',
      threadId: 'thread-batch',
    })

    expect(assembled.imageCount).toBe(0)
    expect(assembled.message.imageUrls).toEqual([])
  })

  it('redacts sensitive URL query values and respects captured-body privacy states in the prompt', async () => {
    const assembled = buildBrowserAnnotationQueuedMessage(createBatch(), {
      id: 'privacy-check',
      nowIso: '2026-05-28T12:00:00.000Z',
    })

    expect(assembled.message.text).toContain(`token=${encodeURIComponent(ANNOTATION_REDACTED_VALUE)}`)
    expect(assembled.message.text).toContain(`access_token=${encodeURIComponent(ANNOTATION_REDACTED_VALUE)}`)
    expect(assembled.message.text).toContain(`password=${encodeURIComponent(ANNOTATION_REDACTED_VALUE)}`)
    expect(assembled.message.text).toContain(`"password":"${ANNOTATION_REDACTED_VALUE}"`)
    expect(assembled.message.text).toContain('Response body: not-captured (default-privacy)')
    expect(assembled.message.text).not.toContain('secret-token')
    expect(assembled.message.text).not.toContain('password=secret')
  })
})
