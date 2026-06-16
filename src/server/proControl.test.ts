import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BrowserAnnotationBindingStore,
  type BrowserAnnotationBindingResponse,
} from './browserAnnotationBinding'
import {
  handleProControlRoutes,
  ProControlStore,
} from './proControl'
import { handleBrowserAnnotationBindingRoutes } from './browserAnnotationBinding'

type JsonResponse = {
  status: number
  body: Record<string, unknown>
}

const servers: Server[] = []
const runtimeDirs: string[] = []

async function listenWithStores(input: {
  store: ProControlStore
  bindingStore: BrowserAnnotationBindingStore
}): Promise<{ baseUrl: string }> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (await handleBrowserAnnotationBindingRoutes(req, res, url, { store: input.bindingStore })) return
    if (await handleProControlRoutes(req, res, url, { store: input.store, bindingStore: input.bindingStore })) return
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

async function makeRuntimeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'codex-pro-control-test-'))
  runtimeDirs.push(dir)
  return dir
}

async function requestJson(baseUrl: string, path: string, init: RequestInit = {}): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })
  const body = await response.json() as Record<string, unknown>
  return { status: response.status, body }
}

async function createBinding(baseUrl: string): Promise<BrowserAnnotationBindingResponse> {
  const start = await requestJson(baseUrl, '/codex-api/extension/binding/start', { method: 'POST' })
  const pairing = start.body.pairing as Record<string, unknown>
  const complete = await requestJson(baseUrl, '/codex-api/extension/binding/complete', {
    method: 'POST',
    headers: { Authorization: `Bearer ${pairing.pairingCode}` },
    body: JSON.stringify({ pairingId: pairing.pairingId }),
  })
  return complete.body.binding as BrowserAnnotationBindingResponse
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve())
  })))
  await Promise.all(runtimeDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('Pro-control routes', () => {
  it('separates internal and browser-binding auth', async () => {
    const runtimeDir = await makeRuntimeDir()
    const store = new ProControlStore({ runtimeDir, nowMs: () => Date.UTC(2026, 0, 1) })
    const bindingStore = new BrowserAnnotationBindingStore({ nowMs: () => Date.UTC(2026, 0, 1) })
    const { baseUrl } = await listenWithStores({ store, bindingStore })
    const internalToken = store.ensureInternalToken()
    const binding = await createBinding(baseUrl)

    const createWithBinding = await requestJson(baseUrl, '/codex-api/extension/pro-control/tasks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${binding.bindingToken}` },
      body: JSON.stringify({ prompt: 'Can you review this?' }),
    })
    expect(createWithBinding.status).toBe(401)
    expect(createWithBinding.body.error).toBe('Missing or invalid Pro-control internal token')

    const pollWithInternal = await requestJson(baseUrl, '/codex-api/extension/pro-control/poll', {
      method: 'POST',
      headers: { Authorization: `Bearer ${internalToken}` },
    })
    expect(pollWithInternal.status).toBe(401)
    expect(pollWithInternal.body.error).toBe('Missing or invalid browser binding token')
  })

  it('round-trips a question-only task through extension polling and result posting', async () => {
    let now = Date.UTC(2026, 0, 1)
    const runtimeDir = await makeRuntimeDir()
    const store = new ProControlStore({ runtimeDir, nowMs: () => now })
    const bindingStore = new BrowserAnnotationBindingStore({ nowMs: () => now })
    const { baseUrl } = await listenWithStores({ store, bindingStore })
    const internalToken = store.ensureInternalToken()
    const binding = await createBinding(baseUrl)

    const created = await requestJson(baseUrl, '/codex-api/extension/pro-control/tasks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${internalToken}` },
      body: JSON.stringify({
        projectId: 'project-a',
        codexThreadId: 'thread-a',
        mode: 'question-only',
        prompt: 'Вопрос без файлов',
      }),
    })
    expect(created.status).toBe(200)
    const task = created.body.task as Record<string, unknown>
    expect(task.status).toBe('queued')
    expect(task.proSessionKey).toBe('project-a:thread-a')
    expect(String(task.prompt)).toContain(`[Codex Pro task: ${task.id}]`)

    const poll = await requestJson(baseUrl, '/codex-api/extension/pro-control/poll', {
      method: 'POST',
      headers: { Authorization: `Bearer ${binding.bindingToken}` },
    })
    expect(poll.status).toBe(200)
    const claimed = poll.body.task as Record<string, unknown>
    expect(claimed.id).toBe(task.id)
    expect(claimed.status).toBe('claimed')

    const secondPoll = await requestJson(baseUrl, '/codex-api/extension/pro-control/poll', {
      method: 'POST',
      headers: { Authorization: `Bearer ${binding.bindingToken}` },
    })
    expect((secondPoll.body.task as Record<string, unknown>).id).toBe(task.id)

    now += 1000
    const running = await requestJson(baseUrl, `/codex-api/extension/pro-control/tasks/${task.id}/status`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${binding.bindingToken}` },
      body: JSON.stringify({
        status: 'running',
        statusDetail: 'ChatGPT Pro is thinking.',
        conversationUrl: 'https://chatgpt.com/c/abc',
      }),
    })
    expect(running.status).toBe(200)
    expect((running.body.task as Record<string, unknown>).status).toBe('running')

    const completed = await requestJson(baseUrl, `/codex-api/extension/pro-control/tasks/${task.id}/result`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${binding.bindingToken}` },
      body: JSON.stringify({
        answerText: 'stubbed answer',
        readMethod: 'stub',
        clipboardRestored: true,
        executionModeRequested: 'foreground',
        executionModeUsed: 'foreground',
        conversationUrl: 'https://chatgpt.com/c/abc',
      }),
    })
    expect(completed.status).toBe(200)
    const completedTask = completed.body.task as Record<string, unknown>
    expect(completedTask.status).toBe('completed')
    expect(completedTask.conversationUrl).toBe('https://chatgpt.com/c/abc')
    expect((completedTask.result as Record<string, unknown>).answerText).toBe('stubbed answer')

    const status = await requestJson(baseUrl, `/codex-api/extension/pro-control/tasks/${task.id}`, {
      headers: { Authorization: `Bearer ${internalToken}` },
    })
    expect((status.body.task as Record<string, unknown>).status).toBe('completed')
  })

  it('reuses saved conversation URLs for the same project/thread session', async () => {
    let now = Date.UTC(2026, 0, 1)
    const runtimeDir = await makeRuntimeDir()
    const store = new ProControlStore({ runtimeDir, nowMs: () => now })
    const bindingStore = new BrowserAnnotationBindingStore({ nowMs: () => now })
    const { baseUrl } = await listenWithStores({ store, bindingStore })
    const internalToken = store.ensureInternalToken()
    const binding = await createBinding(baseUrl)

    const first = await requestJson(baseUrl, '/codex-api/extension/pro-control/tasks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${internalToken}` },
      body: JSON.stringify({ projectId: 'p', codexThreadId: 't', prompt: 'first' }),
    })
    const firstTask = first.body.task as Record<string, unknown>
    await requestJson(baseUrl, '/codex-api/extension/pro-control/poll', {
      method: 'POST',
      headers: { Authorization: `Bearer ${binding.bindingToken}` },
    })
    await requestJson(baseUrl, `/codex-api/extension/pro-control/tasks/${firstTask.id}/result`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${binding.bindingToken}` },
      body: JSON.stringify({
        answerText: 'first answer',
        readMethod: 'stub',
        executionModeRequested: 'foreground',
        executionModeUsed: 'foreground',
        conversationUrl: 'https://chatgpt.com/c/session-one',
      }),
    })

    now += 1000
    const second = await requestJson(baseUrl, '/codex-api/extension/pro-control/tasks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${internalToken}` },
      body: JSON.stringify({ projectId: 'p', codexThreadId: 't', prompt: 'second' }),
    })
    const secondTask = second.body.task as Record<string, unknown>
    expect(secondTask.proSessionKey).toBe('p:t')
    expect(secondTask.conversationUrl).toBe('https://chatgpt.com/c/session-one')

    const isolated = await requestJson(baseUrl, '/codex-api/extension/pro-control/tasks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${internalToken}` },
      body: JSON.stringify({ projectId: 'p', codexThreadId: 'other-thread', prompt: 'other' }),
    })
    expect((isolated.body.task as Record<string, unknown>).conversationUrl).toBeUndefined()
  })

  it('surfaces offline worker and stale claimed-task failures', async () => {
    let now = Date.UTC(2026, 0, 1)
    const runtimeDir = await makeRuntimeDir()
    const store = new ProControlStore({
      runtimeDir,
      nowMs: () => now,
      queuedTtlMs: 100,
      claimedTtlMs: 100,
      workerOfflineMs: 100,
    })
    const bindingStore = new BrowserAnnotationBindingStore({ nowMs: () => now })
    const { baseUrl } = await listenWithStores({ store, bindingStore })
    const internalToken = store.ensureInternalToken()
    const binding = await createBinding(baseUrl)

    const queued = await requestJson(baseUrl, '/codex-api/extension/pro-control/tasks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${internalToken}` },
      body: JSON.stringify({ prompt: 'will expire queued' }),
    })
    const queuedTask = queued.body.task as Record<string, unknown>
    now += 101
    const queuedStatus = await requestJson(baseUrl, `/codex-api/extension/pro-control/tasks/${queuedTask.id}`, {
      headers: { Authorization: `Bearer ${internalToken}` },
    })
    expect((queuedStatus.body.task as Record<string, unknown>).failureCode).toBe('pro_worker_offline')

    const claimed = await requestJson(baseUrl, '/codex-api/extension/pro-control/tasks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${internalToken}` },
      body: JSON.stringify({ prompt: 'will expire claimed' }),
    })
    const claimedTask = claimed.body.task as Record<string, unknown>
    await requestJson(baseUrl, '/codex-api/extension/pro-control/poll', {
      method: 'POST',
      headers: { Authorization: `Bearer ${binding.bindingToken}` },
    })
    now += 101
    const claimedStatus = await requestJson(baseUrl, `/codex-api/extension/pro-control/tasks/${claimedTask.id}`, {
      headers: { Authorization: `Bearer ${internalToken}` },
    })
    expect((claimedStatus.body.task as Record<string, unknown>).failureCode).toBe('pro_worker_offline')
  })
})
