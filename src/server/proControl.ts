import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, dirname, join, normalize, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import {
  BrowserAnnotationBindingStore,
  readBrowserAnnotationBearerToken,
  sharedBrowserAnnotationBindingStore,
} from './browserAnnotationBinding.js'

export const PRO_CONTROL_BASE_PATH = '/codex-api/extension/pro-control'
export const PRO_CONTROL_RUNTIME_DIR = '.codex/pro-control'
export const PRO_CONTROL_FAILURE_CODES = [
  'login_required',
  'chatgpt_permission_missing',
  'pro_worker_offline',
  'chatgpt_tab_interrupted',
  'copy_response_unavailable',
  'clipboard_read_failed',
  'bundle_too_large',
  'file_blocked_by_policy',
  'attachment_blocked',
] as const

export type ProControlFailureCode = typeof PRO_CONTROL_FAILURE_CODES[number]
export type ProControlTaskStatus = 'queued' | 'claimed' | 'running' | 'completed' | 'failed' | 'expired'
export type ProControlTaskMode = 'question-only' | 'repo-bundle' | 'follow-up'
export type ProControlExecutionMode = 'background' | 'foreground'

export type ProControlFileRef = {
  fileId: string
  name: string
  mime: string
  size: number
  sha256: string
  purpose: 'prompt-attachment' | 'result-attachment'
}

export type ProControlAttachment = ProControlFileRef & {
  blocked?: boolean
  warning?: string
}

export type ProControlResult = {
  answerText: string
  readMethod: 'copy-response' | 'dom-fallback' | 'stub'
  clipboardRestored: boolean | null
  executionModeRequested: ProControlExecutionMode
  executionModeUsed: ProControlExecutionMode
  fallbackReason?: string
  conversationUrl?: string
  warnings: string[]
  attachments: ProControlAttachment[]
}

export type ProControlTaskResponse = {
  id: string
  projectId: string
  codexThreadId: string
  proSessionKey: string
  mode: ProControlTaskMode
  prompt: string
  promptMarker: string
  files: ProControlFileRef[]
  status: ProControlTaskStatus
  statusDetail: string
  failureCode?: ProControlFailureCode
  createdAtIso: string
  claimedAtIso?: string
  heartbeatAtIso?: string
  completedAtIso?: string
  claimedByBindingId?: string
  conversationUrl?: string
  result?: ProControlResult
}

export type ProControlWorkerStatus = {
  bindingId: string
  state: 'online' | 'idle' | 'running' | 'error' | 'offline'
  detail: string
  updatedAtIso: string
  currentTaskId?: string
  lastError?: {
    code: ProControlFailureCode | 'unknown'
    detail: string
    atIso: string
  }
}

type ProControlTaskRecord = {
  id: string
  projectId: string
  codexThreadId: string
  proSessionKey: string
  mode: ProControlTaskMode
  prompt: string
  promptMarker: string
  files: ProControlFileRef[]
  status: ProControlTaskStatus
  statusDetail: string
  failureCode?: ProControlFailureCode
  createdAtMs: number
  claimedAtMs?: number
  heartbeatAtMs?: number
  completedAtMs?: number
  claimedByBindingId?: string
  result?: ProControlResult
}

type ProControlFileRecord = ProControlFileRef & {
  path: string
  taskId: string | null
  createdAtMs: number
}

type ProSessionRecord = {
  sessionKey: string
  projectId: string
  codexThreadId: string
  conversationUrl: string
  createdAtMs: number
  lastUsedAtMs: number
  model: 'pro'
  reasoning: 'extended'
}

type ProControlStoreOptions = {
  nowMs?: () => number
  runtimeDir?: string
  tokenBytes?: number
  queuedTtlMs?: number
  claimedTtlMs?: number
  completedTtlMs?: number
  workerOfflineMs?: number
  maxJsonBytes?: number
  maxUploadBytes?: number
}

type JsonBodyReadResult =
  | { ok: true; body: unknown }
  | { ok: false; statusCode: 400 | 413; error: string }

export class ProControlStore {
  private readonly tasks = new Map<string, ProControlTaskRecord>()
  private readonly files = new Map<string, ProControlFileRecord>()
  private readonly workers = new Map<string, ProControlWorkerStatus>()
  private readonly nowMs: () => number
  private readonly runtimeDir: string
  private readonly tokenBytes: number
  private readonly queuedTtlMs: number
  private readonly claimedTtlMs: number
  private readonly completedTtlMs: number
  private readonly workerOfflineMs: number
  readonly maxJsonBytes: number
  readonly maxUploadBytes: number

  constructor(options: ProControlStoreOptions = {}) {
    this.nowMs = options.nowMs ?? Date.now
    this.runtimeDir = options.runtimeDir ?? resolve(process.cwd(), PRO_CONTROL_RUNTIME_DIR)
    this.tokenBytes = options.tokenBytes ?? 16
    this.queuedTtlMs = options.queuedTtlMs ?? 2 * 60 * 1000
    this.claimedTtlMs = options.claimedTtlMs ?? 90 * 60 * 1000
    this.completedTtlMs = options.completedTtlMs ?? 30 * 60 * 1000
    this.workerOfflineMs = options.workerOfflineMs ?? 45 * 1000
    this.maxJsonBytes = options.maxJsonBytes ?? 1024 * 1024
    this.maxUploadBytes = options.maxUploadBytes ?? 50 * 1024 * 1024
  }

  getRuntimeDir(): string {
    return this.runtimeDir
  }

  ensureInternalToken(): string {
    mkdirSync(this.runtimeDir, { recursive: true })
    const tokenPath = join(this.runtimeDir, 'server-token')
    if (existsSync(tokenPath)) {
      const existing = readFileSync(tokenPath, 'utf8').trim()
      if (existing) return existing
    }
    const token = randomBytes(this.tokenBytes * 2).toString('base64url')
    writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 })
    return token
  }

  isInternalToken(token: string): boolean {
    const expected = process.env.CODEXUI_PRO_CONTROL_TOKEN || this.ensureInternalToken()
    return doesTokenMatch(token, expected)
  }

  async uploadFile(input: {
    taskId?: string | null
    name: string
    mime?: string
    contentBase64: string
    purpose?: ProControlFileRef['purpose']
  }): Promise<ProControlFileRef> {
    const fileName = sanitizeFileName(input.name)
    const buffer = Buffer.from(input.contentBase64, 'base64')
    if (buffer.byteLength > this.maxUploadBytes) {
      throw new ProControlHttpError(413, 'Uploaded Pro-control file is too large', 'attachment_blocked')
    }
    const sha256 = createHash('sha256').update(buffer).digest('hex')
    const fileId = `pro-file-${randomBytes(8).toString('hex')}`
    const storageDir = join(this.runtimeDir, 'files')
    await mkdir(storageDir, { recursive: true })
    const storagePath = join(storageDir, `${fileId}-${fileName}`)
    await writeFile(storagePath, buffer)
    const ref: ProControlFileRef = {
      fileId,
      name: fileName,
      mime: input.mime || 'application/octet-stream',
      size: buffer.byteLength,
      sha256,
      purpose: input.purpose ?? 'prompt-attachment',
    }
    this.files.set(fileId, {
      ...ref,
      path: storagePath,
      taskId: input.taskId || null,
      createdAtMs: this.nowMs(),
    })
    return ref
  }

  getFile(fileId: string): ProControlFileRecord | null {
    this.prune()
    return this.files.get(fileId) ?? null
  }

  createTask(input: {
    projectId?: string
    codexThreadId?: string
    mode?: ProControlTaskMode
    prompt: string
    fileIds?: string[]
    sessionKey?: string
    executionModeRequested?: ProControlExecutionMode
  }): ProControlTaskResponse {
    this.prune()
    const now = this.nowMs()
    const projectId = readNonEmptyString(input.projectId) || 'projectless'
    const codexThreadId = readNonEmptyString(input.codexThreadId) || 'threadless'
    const proSessionKey = readNonEmptyString(input.sessionKey) || deriveProSessionKey(projectId, codexThreadId)
    const id = `pro-task-${randomBytes(8).toString('hex')}`
    const promptMarker = `[Codex Pro task: ${id}]`
    const files = (input.fileIds ?? [])
      .map((fileId) => this.files.get(fileId))
      .filter((file): file is ProControlFileRecord => Boolean(file))
      .map((file) => {
        file.taskId = id
        return publicFileRef(file)
      })
    const task: ProControlTaskRecord = {
      id,
      projectId,
      codexThreadId,
      proSessionKey,
      mode: input.mode ?? 'question-only',
      prompt: ensurePromptMarker(input.prompt, promptMarker),
      promptMarker,
      files,
      status: 'queued',
      statusDetail: 'Queued for a ChatGPT Pro browser worker.',
      createdAtMs: now,
    }
    this.tasks.set(task.id, task)
    return this.toTaskResponse(task)
  }

  getTask(taskId: string): ProControlTaskResponse | null {
    this.prune()
    const task = this.tasks.get(taskId)
    return task ? this.toTaskResponse(task) : null
  }

  poll(bindingId: string): { worker: ProControlWorkerStatus; task: ProControlTaskResponse | null } {
    this.prune()
    const now = this.nowMs()
    const existing = Array.from(this.tasks.values()).find((task) => (
      task.claimedByBindingId === bindingId && task.status !== 'completed' && task.status !== 'failed' && task.status !== 'expired'
    ))
    const task = existing ?? Array.from(this.tasks.values())
      .filter((candidate) => candidate.status === 'queued')
      .sort((left, right) => left.createdAtMs - right.createdAtMs)[0]
    if (task) {
      task.status = existing ? task.status : 'claimed'
      task.statusDetail = existing ? task.statusDetail : 'Claimed by ChatGPT Pro browser worker.'
      task.claimedByBindingId = bindingId
      task.claimedAtMs = task.claimedAtMs ?? now
      task.heartbeatAtMs = now
      const worker = this.writeWorker(bindingId, task.status === 'running' ? 'running' : 'idle', 'Worker claimed a Pro-control task.', task.id)
      return { worker, task: this.toTaskResponse(task) }
    }
    const worker = this.writeWorker(bindingId, 'idle', 'Worker is online and idle.')
    return { worker, task: null }
  }

  updateTaskStatus(bindingId: string, taskId: string, input: {
    status?: ProControlTaskStatus
    statusDetail?: string
    failureCode?: ProControlFailureCode
    conversationUrl?: string
  }): ProControlTaskResponse | null {
    this.prune()
    const task = this.tasks.get(taskId)
    if (!task || task.claimedByBindingId !== bindingId) return null
    const nextStatus = input.status ?? task.status
    task.status = nextStatus
    task.statusDetail = input.statusDetail || statusDetailFor(nextStatus)
    task.heartbeatAtMs = this.nowMs()
    if (input.failureCode) task.failureCode = input.failureCode
    if (input.conversationUrl) this.upsertSessionUrl(task, input.conversationUrl)
    if (nextStatus === 'failed' || nextStatus === 'completed' || nextStatus === 'expired') {
      task.completedAtMs = task.completedAtMs ?? this.nowMs()
    }
    this.writeWorker(
      bindingId,
      nextStatus === 'failed' ? 'error' : nextStatus === 'running' ? 'running' : 'idle',
      task.statusDetail,
      nextStatus === 'completed' || nextStatus === 'failed' ? undefined : task.id,
      input.failureCode ? { code: input.failureCode, detail: task.statusDetail, atIso: new Date(this.nowMs()).toISOString() } : undefined,
    )
    return this.toTaskResponse(task)
  }

  completeTask(bindingId: string, taskId: string, result: ProControlResult): ProControlTaskResponse | null {
    this.prune()
    const task = this.tasks.get(taskId)
    if (!task || task.claimedByBindingId !== bindingId) return null
    const normalizedResult = normalizeResult(result)
    task.status = 'completed'
    task.statusDetail = normalizedResult.warnings.length > 0
      ? 'Completed with warnings.'
      : 'Completed by ChatGPT Pro browser worker.'
    task.result = normalizedResult
    task.heartbeatAtMs = this.nowMs()
    task.completedAtMs = this.nowMs()
    if (normalizedResult.conversationUrl) this.upsertSessionUrl(task, normalizedResult.conversationUrl)
    for (const attachment of normalizedResult.attachments) {
      const file = this.files.get(attachment.fileId)
      if (file) file.taskId = task.id
    }
    this.writeWorker(bindingId, 'idle', task.statusDetail)
    return this.toTaskResponse(task)
  }

  failTask(taskId: string, failureCode: ProControlFailureCode, detail: string): ProControlTaskResponse | null {
    const task = this.tasks.get(taskId)
    if (!task) return null
    task.status = 'failed'
    task.failureCode = failureCode
    task.statusDetail = detail
    task.completedAtMs = this.nowMs()
    if (task.claimedByBindingId) {
      this.writeWorker(task.claimedByBindingId, 'error', detail, undefined, {
        code: failureCode,
        detail,
        atIso: new Date(this.nowMs()).toISOString(),
      })
    }
    return this.toTaskResponse(task)
  }

  listWorkers(): ProControlWorkerStatus[] {
    this.prune()
    return Array.from(this.workers.values())
  }

  readSession(sessionKey: string): ProSessionRecord | null {
    const sessions = this.readSessions()
    return sessions[sessionKey] ?? null
  }

  private upsertSessionUrl(task: ProControlTaskRecord, conversationUrl: string): ProSessionRecord {
    const now = this.nowMs()
    const sessions = this.readSessions()
    const previous = sessions[task.proSessionKey]
    const session: ProSessionRecord = {
      sessionKey: task.proSessionKey,
      projectId: task.projectId,
      codexThreadId: task.codexThreadId,
      conversationUrl,
      createdAtMs: previous?.createdAtMs ?? now,
      lastUsedAtMs: now,
      model: 'pro',
      reasoning: 'extended',
    }
    sessions[task.proSessionKey] = session
    this.writeSessions(sessions)
    return session
  }

  private readSessions(): Record<string, ProSessionRecord> {
    const sessionPath = join(this.runtimeDir, 'sessions.json')
    try {
      const parsed = JSON.parse(readFileSync(sessionPath, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
      return parsed as Record<string, ProSessionRecord>
    } catch {
      return {}
    }
  }

  private writeSessions(sessions: Record<string, ProSessionRecord>): void {
    mkdirSync(this.runtimeDir, { recursive: true })
    writeFileSync(join(this.runtimeDir, 'sessions.json'), `${JSON.stringify(sessions, null, 2)}\n`)
  }

  private writeWorker(
    bindingId: string,
    state: ProControlWorkerStatus['state'],
    detail: string,
    currentTaskId?: string,
    lastError?: ProControlWorkerStatus['lastError'],
  ): ProControlWorkerStatus {
    const previous = this.workers.get(bindingId)
    const worker: ProControlWorkerStatus = {
      bindingId,
      state,
      detail,
      updatedAtIso: new Date(this.nowMs()).toISOString(),
      ...(currentTaskId ? { currentTaskId } : {}),
      ...(lastError ?? previous?.lastError ? { lastError: lastError ?? previous?.lastError } : {}),
    }
    this.workers.set(bindingId, worker)
    return worker
  }

  private prune(): void {
    const now = this.nowMs()
    for (const task of this.tasks.values()) {
      if (task.status === 'queued' && now - task.createdAtMs > this.queuedTtlMs) {
        task.status = 'failed'
        task.failureCode = 'pro_worker_offline'
        task.statusDetail = 'No Pro-control browser worker claimed the task before the queue timeout.'
        task.completedAtMs = now
      }
      if ((task.status === 'claimed' || task.status === 'running') && task.heartbeatAtMs && now - task.heartbeatAtMs > this.claimedTtlMs) {
        task.status = 'failed'
        task.failureCode = 'pro_worker_offline'
        task.statusDetail = 'The Pro-control browser worker stopped heartbeating before completion.'
        task.completedAtMs = now
      }
      if ((task.status === 'completed' || task.status === 'failed' || task.status === 'expired') && task.completedAtMs && now - task.completedAtMs > this.completedTtlMs) {
        this.tasks.delete(task.id)
      }
    }
    for (const [bindingId, worker] of this.workers.entries()) {
      const updatedAt = Date.parse(worker.updatedAtIso)
      if (Number.isFinite(updatedAt) && now - updatedAt > this.workerOfflineMs) {
        this.workers.set(bindingId, {
          ...worker,
          state: 'offline',
          detail: 'Worker has not polled recently.',
        })
      }
    }
  }

  private toTaskResponse(task: ProControlTaskRecord): ProControlTaskResponse {
    const session = this.readSession(task.proSessionKey)
    return {
      id: task.id,
      projectId: task.projectId,
      codexThreadId: task.codexThreadId,
      proSessionKey: task.proSessionKey,
      mode: task.mode,
      prompt: task.prompt,
      promptMarker: task.promptMarker,
      files: task.files,
      status: task.status,
      statusDetail: task.statusDetail,
      ...(task.failureCode ? { failureCode: task.failureCode } : {}),
      createdAtIso: new Date(task.createdAtMs).toISOString(),
      ...(task.claimedAtMs ? { claimedAtIso: new Date(task.claimedAtMs).toISOString() } : {}),
      ...(task.heartbeatAtMs ? { heartbeatAtIso: new Date(task.heartbeatAtMs).toISOString() } : {}),
      ...(task.completedAtMs ? { completedAtIso: new Date(task.completedAtMs).toISOString() } : {}),
      ...(task.claimedByBindingId ? { claimedByBindingId: task.claimedByBindingId } : {}),
      ...(session?.conversationUrl ? { conversationUrl: session.conversationUrl } : {}),
      ...(task.result ? { result: task.result } : {}),
    }
  }
}

export const sharedProControlStore = new ProControlStore()

export type ProControlRouteOptions = {
  store?: ProControlStore
  bindingStore?: BrowserAnnotationBindingStore
}

export async function handleProControlRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  options: ProControlRouteOptions = {},
): Promise<boolean> {
  if (!url.pathname.startsWith(`${PRO_CONTROL_BASE_PATH}/`)) return false
  const store = options.store ?? sharedProControlStore
  const bindingStore = options.bindingStore ?? sharedBrowserAnnotationBindingStore
  try {
    if (req.method === 'GET' && url.pathname === `${PRO_CONTROL_BASE_PATH}/workers`) {
      if (!isInternalRequest(req, store)) return denyInternal(res)
      setJson(res, 200, { ok: true, workers: store.listWorkers() })
      return true
    }

    if (req.method === 'POST' && url.pathname === `${PRO_CONTROL_BASE_PATH}/files`) {
      if (!isInternalRequest(req, store)) return denyInternal(res)
      const bodyResult = await readJsonBody(req, store.maxJsonBytes)
      if (!bodyResult.ok) return setBodyError(res, bodyResult)
      const body = asRecord(bodyResult.body)
      const file = await store.uploadFile({
        taskId: readString(body?.taskId) ?? null,
        name: readString(body?.name) || 'pro-control-file',
        mime: readString(body?.mime) || 'application/octet-stream',
        contentBase64: readString(body?.contentBase64) || '',
        purpose: body?.purpose === 'result-attachment' ? 'result-attachment' : 'prompt-attachment',
      })
      setJson(res, 200, { ok: true, file })
      return true
    }

    if (req.method === 'POST' && url.pathname === `${PRO_CONTROL_BASE_PATH}/tasks`) {
      if (!isInternalRequest(req, store)) return denyInternal(res)
      const bodyResult = await readJsonBody(req, store.maxJsonBytes)
      if (!bodyResult.ok) return setBodyError(res, bodyResult)
      const body = asRecord(bodyResult.body)
      if (!body || !readString(body.prompt)) {
        setJson(res, 400, { error: 'Pro-control task prompt is required' })
        return true
      }
      const task = store.createTask({
        projectId: readString(body.projectId),
        codexThreadId: readString(body.codexThreadId),
        sessionKey: readString(body.sessionKey),
        mode: readTaskMode(body.mode),
        prompt: readString(body.prompt) || '',
        fileIds: Array.isArray(body.fileIds) ? body.fileIds.map((value) => readString(value)).filter(Boolean) as string[] : [],
        executionModeRequested: body.executionModeRequested === 'background' ? 'background' : 'foreground',
      })
      setJson(res, 200, { ok: true, task })
      return true
    }

    const taskStatusMatch = url.pathname.match(/^\/codex-api\/extension\/pro-control\/tasks\/([^/]+)$/u)
    if (req.method === 'GET' && taskStatusMatch) {
      if (!isInternalRequest(req, store)) return denyInternal(res)
      const task = store.getTask(decodeURIComponent(taskStatusMatch[1] ?? ''))
      if (!task) {
        setJson(res, 404, { error: 'Unknown Pro-control task' })
        return true
      }
      setJson(res, 200, { ok: true, task })
      return true
    }

    if (req.method === 'POST' && url.pathname === `${PRO_CONTROL_BASE_PATH}/poll`) {
      const binding = readAuthorizedBinding(req, bindingStore)
      if (!binding) return denyBinding(res)
      const result = store.poll(binding.bindingId)
      setJson(res, 200, { ok: true, worker: result.worker, task: result.task })
      return true
    }

    const extensionFileMatch = url.pathname.match(/^\/codex-api\/extension\/pro-control\/files\/([^/]+)$/u)
    if (req.method === 'GET' && extensionFileMatch) {
      const binding = readAuthorizedBinding(req, bindingStore)
      if (!binding && !isInternalRequest(req, store)) return denyBinding(res)
      const file = store.getFile(decodeURIComponent(extensionFileMatch[1] ?? ''))
      if (!file) {
        setJson(res, 404, { error: 'Unknown Pro-control file' })
        return true
      }
      res.statusCode = 200
      res.setHeader('Content-Type', file.mime)
      res.setHeader('Content-Length', file.size)
      res.setHeader('Content-Disposition', `attachment; filename="${file.name.replace(/"/gu, '')}"`)
      createReadStream(file.path).pipe(res)
      return true
    }

    const extensionStatusMatch = url.pathname.match(/^\/codex-api\/extension\/pro-control\/tasks\/([^/]+)\/status$/u)
    if (req.method === 'POST' && extensionStatusMatch) {
      const binding = readAuthorizedBinding(req, bindingStore)
      if (!binding) return denyBinding(res)
      const bodyResult = await readJsonBody(req, store.maxJsonBytes)
      if (!bodyResult.ok) return setBodyError(res, bodyResult)
      const body = asRecord(bodyResult.body)
      const task = store.updateTaskStatus(binding.bindingId, decodeURIComponent(extensionStatusMatch[1] ?? ''), {
        status: readTaskStatus(body?.status),
        statusDetail: readString(body?.statusDetail),
        failureCode: readFailureCode(body?.failureCode),
        conversationUrl: readString(body?.conversationUrl),
      })
      if (!task) {
        setJson(res, 404, { error: 'Unknown or unclaimed Pro-control task' })
        return true
      }
      setJson(res, 200, { ok: true, task })
      return true
    }

    const extensionResultMatch = url.pathname.match(/^\/codex-api\/extension\/pro-control\/tasks\/([^/]+)\/result$/u)
    if (req.method === 'POST' && extensionResultMatch) {
      const binding = readAuthorizedBinding(req, bindingStore)
      if (!binding) return denyBinding(res)
      const bodyResult = await readJsonBody(req, store.maxJsonBytes)
      if (!bodyResult.ok) return setBodyError(res, bodyResult)
      const body = asRecord(bodyResult.body)
      const attachmentIds = Array.isArray(body?.attachmentFileIds)
        ? body.attachmentFileIds.map((value) => readString(value)).filter(Boolean) as string[]
        : []
      const attachments = attachmentIds
        .map((fileId) => store.getFile(fileId))
        .filter((file): file is ProControlFileRecord => Boolean(file))
        .map((file) => ({ ...publicFileRef(file), purpose: 'result-attachment' as const }))
      const task = store.completeTask(binding.bindingId, decodeURIComponent(extensionResultMatch[1] ?? ''), {
        answerText: readString(body?.answerText) || '',
        readMethod: body?.readMethod === 'dom-fallback' ? 'dom-fallback' : body?.readMethod === 'stub' ? 'stub' : 'copy-response',
        clipboardRestored: typeof body?.clipboardRestored === 'boolean' ? body.clipboardRestored : null,
        executionModeRequested: body?.executionModeRequested === 'background' ? 'background' : 'foreground',
        executionModeUsed: body?.executionModeUsed === 'background' ? 'background' : 'foreground',
        fallbackReason: readString(body?.fallbackReason),
        conversationUrl: readString(body?.conversationUrl),
        warnings: Array.isArray(body?.warnings) ? body.warnings.map((value) => readString(value)).filter(Boolean) as string[] : [],
        attachments,
      })
      if (!task) {
        setJson(res, 404, { error: 'Unknown or unclaimed Pro-control task' })
        return true
      }
      setJson(res, 200, { ok: true, task })
      return true
    }

    if (req.method === 'POST' && url.pathname === `${PRO_CONTROL_BASE_PATH}/result-files`) {
      const binding = readAuthorizedBinding(req, bindingStore)
      if (!binding) return denyBinding(res)
      const bodyResult = await readJsonBody(req, store.maxJsonBytes)
      if (!bodyResult.ok) return setBodyError(res, bodyResult)
      const body = asRecord(bodyResult.body)
      const file = await store.uploadFile({
        taskId: readString(body?.taskId),
        name: readString(body?.name) || 'chatgpt-attachment',
        mime: readString(body?.mime) || 'application/octet-stream',
        contentBase64: readString(body?.contentBase64) || '',
        purpose: 'result-attachment',
      })
      setJson(res, 200, { ok: true, file })
      return true
    }

    setJson(res, 404, { error: 'Unknown Pro-control endpoint' })
    return true
  } catch (error) {
    if (error instanceof ProControlHttpError) {
      setJson(res, error.statusCode, {
        error: error.message,
        ...(error.failureCode ? { failureCode: error.failureCode } : {}),
      })
      return true
    }
    throw error
  }
}

class ProControlHttpError extends Error {
  constructor(readonly statusCode: number, message: string, readonly failureCode?: ProControlFailureCode) {
    super(message)
  }
}

function readAuthorizedBinding(req: IncomingMessage, bindingStore: BrowserAnnotationBindingStore) {
  const token = readBrowserAnnotationBearerToken(req)
  return token ? bindingStore.getAuthorizedBinding(token) : null
}

function isInternalRequest(req: IncomingMessage, store: ProControlStore): boolean {
  const token = readBrowserAnnotationBearerToken(req)
  return Boolean(token && store.isInternalToken(token))
}

function denyInternal(res: ServerResponse): true {
  setJson(res, 401, { error: 'Missing or invalid Pro-control internal token' })
  return true
}

function denyBinding(res: ServerResponse): true {
  setJson(res, 401, { error: 'Missing or invalid browser binding token' })
  return true
}

function setBodyError(res: ServerResponse, result: Extract<JsonBodyReadResult, { ok: false }>): true {
  setJson(res, result.statusCode, { error: result.error })
  return true
}

function readTaskMode(value: unknown): ProControlTaskMode {
  return value === 'repo-bundle' || value === 'follow-up' ? value : 'question-only'
}

function readTaskStatus(value: unknown): ProControlTaskStatus | undefined {
  return value === 'queued' || value === 'claimed' || value === 'running' || value === 'completed' || value === 'failed' || value === 'expired'
    ? value
    : undefined
}

function readFailureCode(value: unknown): ProControlFailureCode | undefined {
  return PRO_CONTROL_FAILURE_CODES.includes(value as ProControlFailureCode) ? value as ProControlFailureCode : undefined
}

function publicFileRef(file: ProControlFileRecord): ProControlFileRef {
  return {
    fileId: file.fileId,
    name: file.name,
    mime: file.mime,
    size: file.size,
    sha256: file.sha256,
    purpose: file.purpose,
  }
}

function normalizeResult(result: ProControlResult): ProControlResult {
  return {
    answerText: result.answerText || '',
    readMethod: result.readMethod || 'copy-response',
    clipboardRestored: typeof result.clipboardRestored === 'boolean' ? result.clipboardRestored : null,
    executionModeRequested: result.executionModeRequested || 'foreground',
    executionModeUsed: result.executionModeUsed || 'foreground',
    ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {}),
    ...(result.conversationUrl ? { conversationUrl: result.conversationUrl } : {}),
    warnings: Array.isArray(result.warnings) ? result.warnings.filter(Boolean) : [],
    attachments: Array.isArray(result.attachments) ? result.attachments : [],
  }
}

function deriveProSessionKey(projectId: string, codexThreadId: string): string {
  return `${projectId || 'projectless'}:${codexThreadId || 'threadless'}`
}

function ensurePromptMarker(prompt: string, marker: string): string {
  return prompt.includes(marker) ? prompt : `${prompt.trim()}\n\n${marker}`.trim()
}

function statusDetailFor(status: ProControlTaskStatus): string {
  if (status === 'running') return 'ChatGPT Pro task is running.'
  if (status === 'completed') return 'ChatGPT Pro task completed.'
  if (status === 'failed') return 'ChatGPT Pro task failed.'
  if (status === 'expired') return 'ChatGPT Pro task expired.'
  if (status === 'claimed') return 'ChatGPT Pro task was claimed by a browser worker.'
  return 'Queued for a ChatGPT Pro browser worker.'
}

function sanitizeFileName(value: string): string {
  const name = basename(value || 'pro-control-file').replace(/[^\w .@()+,=-]/gu, '-').trim()
  return name || 'pro-control-file'
}

export function isProControlPathAllowed(workspaceRoot: string, candidatePath: string): boolean {
  const root = resolve(workspaceRoot)
  const absolute = resolve(root, candidatePath)
  const relativePath = normalize(absolute).slice(root.length).split('\\').join('/')
  if (!absolute.startsWith(`${root}${sep}`) && absolute !== root) return false
  if (relativePath.split('/').some((part: string) => part === '.git' || part === 'node_modules' || part === '.codex')) return false
  if (/(^|\/)\.env($|[./_-])/u.test(relativePath)) return false
  if (/(cookie|credential|secret|token|session)/iu.test(relativePath)) return false
  return true
}

export async function readAllowedWorkspaceFile(workspaceRoot: string, candidatePath: string): Promise<{ path: string; content: Buffer } | null> {
  if (!isProControlPathAllowed(workspaceRoot, candidatePath)) return null
  const absolute = resolve(workspaceRoot, candidatePath)
  const fileStat = await stat(absolute)
  if (!fileStat.isFile() || fileStat.size > 2 * 1024 * 1024) return null
  return { path: absolute, content: await readFile(absolute) }
}

export async function resetProControlRuntimeForTests(runtimeDir: string): Promise<void> {
  await rm(runtimeDir, { recursive: true, force: true })
}

export function defaultProControlRuntimeDir(): string {
  return process.env.CODEXUI_PRO_CONTROL_DIR || resolve(process.cwd() || homedir(), PRO_CONTROL_RUNTIME_DIR)
}

async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<JsonBodyReadResult> {
  const chunks: Uint8Array[] = []
  let byteLength = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    byteLength += buffer.byteLength
    if (byteLength > maxBytes) {
      return { ok: false, statusCode: 413, error: 'Pro-control request body is too large' }
    }
    chunks.push(buffer)
  }
  const raw = Buffer.concat(chunks)
  if (raw.length === 0) return { ok: true, body: null }
  try {
    return { ok: true, body: JSON.parse(raw.toString('utf8')) as unknown }
  } catch {
    return { ok: false, statusCode: 400, error: 'Malformed JSON body' }
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function doesTokenMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(createHash('sha256').update(actual).digest('hex'), 'hex')
  const expectedBuffer = Buffer.from(createHash('sha256').update(expected).digest('hex'), 'hex')
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

function setJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', Buffer.byteLength(body))
  res.end(body)
}
