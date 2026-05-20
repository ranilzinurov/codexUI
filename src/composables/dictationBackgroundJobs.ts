import { onBeforeUnmount, ref, type Ref } from 'vue'
import {
  deleteStoredDictationRecording,
  readStoredDictationRecording,
  transcribeStoredDictationRecording,
  type StoredDictationRecording,
} from './dictationTranscription'
import type { ComposerDraftPayload } from './composerDraftStorage'

const JOB_DB_NAME = 'codex-web-local-dictation-jobs'
const JOB_DB_VERSION = 1
const JOB_STORE = 'jobs'
const JOB_ID_PREFIX = 'dictation-job:'

export type DictationBackgroundJobStatus = 'queued' | 'transcribing' | 'completed' | 'failed'

export type DictationDraftSnapshot = ComposerDraftPayload

export type DictationBackgroundJob = {
  id: string
  recordingId: string
  threadId: string
  storageKey: string
  language: string
  autoSend: boolean
  draftOnly: boolean
  draftSnapshot: DictationDraftSnapshot
  mode: 'steer' | 'queue'
  collaborationMode: 'default' | 'plan'
  status: DictationBackgroundJobStatus
  transcript: string
  error: string
  retryAttempt: number
  retryMaxAttempts: number
  createdAt: number
  updatedAt: number
}

export type CreateDictationBackgroundJobOptions = {
  threadId?: string | null
  storageKey?: string
  language?: string
  autoSend?: boolean
  draftOnly?: boolean
  draftSnapshot?: DictationDraftSnapshot
  mode?: 'steer' | 'queue'
  collaborationMode?: 'default' | 'plan'
}

export type StartDictationBackgroundJobsOptions = {
  includeFailed?: boolean
  jobIds?: readonly string[]
  onCompleted?: (job: DictationBackgroundJob) => void | Promise<void>
  onTranscript?: (job: DictationBackgroundJob, transcript: string) => void | Promise<void>
  onFailed?: (job: DictationBackgroundJob) => void | Promise<void>
  onRetry?: (job: DictationBackgroundJob, attempt: number, maxAttempts: number) => void
}

export type DictationBackgroundJobListener = (jobs: readonly DictationBackgroundJob[]) => void

export type CreateDictationBackgroundJobInput = {
  recording: StoredDictationRecording
  threadId: string
  autoSend: boolean
  draftOnly: boolean
  draftSnapshot?: DictationDraftSnapshot
  mode?: 'steer' | 'queue'
  collaborationMode?: 'default' | 'plan'
}

export type DictationBackgroundJobManager = {
  jobs: Ref<DictationBackgroundJob[]>
  createJob: (input: CreateDictationBackgroundJobInput) => Promise<DictationBackgroundJob>
  resumePendingJobs: () => Promise<DictationBackgroundJob[]>
  retryJob: (jobId: string) => Promise<DictationBackgroundJob | null>
  getJobsForThread: (threadId: string) => DictationBackgroundJob[]
}

const jobCache = new Map<string, DictationBackgroundJob>()
const recordingCache = new Map<string, StoredDictationRecording>()
const activeJobIds = new Set<string>()
const activeAbortControllers = new Map<string, AbortController>()
const listeners = new Set<DictationBackgroundJobListener>()

let runnerPromise: Promise<DictationBackgroundJob[]> | null = null

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readDraftString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function nowMs(): number {
  return Date.now()
}

function createEmptyDraftSnapshot(): DictationDraftSnapshot {
  return {
    text: '',
    imageUrls: [],
    fileAttachments: [],
    skills: [],
  }
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function normalizeDraftSnapshot(value: unknown): DictationDraftSnapshot {
  if (!value || typeof value !== 'object') return createEmptyDraftSnapshot()
  const record = value as Record<string, unknown>

  const fileAttachments = Array.isArray(record.fileAttachments)
    ? record.fileAttachments.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const attachment = item as Record<string, unknown>
      if (
        typeof attachment.label !== 'string' ||
        typeof attachment.path !== 'string' ||
        typeof attachment.fsPath !== 'string'
      ) {
        return []
      }
      return [{
        label: attachment.label,
        path: attachment.path,
        fsPath: attachment.fsPath,
      }]
    })
    : []

  const skills = Array.isArray(record.skills)
    ? record.skills.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const skill = item as Record<string, unknown>
      if (typeof skill.name !== 'string' || typeof skill.path !== 'string') return []
      return [{
        name: skill.name,
        path: skill.path,
      }]
    })
    : []

  return {
    text: readDraftString(record.text),
    imageUrls: normalizeStringList(record.imageUrls),
    fileAttachments,
    skills,
  }
}

function cloneDraftSnapshot(snapshot: DictationDraftSnapshot): DictationDraftSnapshot {
  return {
    text: snapshot.text,
    imageUrls: [...snapshot.imageUrls],
    fileAttachments: snapshot.fileAttachments.map((attachment) => ({ ...attachment })),
    skills: snapshot.skills.map((skill) => ({ ...skill })),
  }
}

function cloneJob(job: DictationBackgroundJob): DictationBackgroundJob {
  return {
    ...job,
    draftSnapshot: cloneDraftSnapshot(job.draftSnapshot),
  }
}

function createSnapshot(): DictationBackgroundJob[] {
  return [...jobCache.values()]
    .map(cloneJob)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}

function emitJobsChanged(): void {
  const snapshot = createSnapshot()
  for (const listener of listeners) {
    try {
      listener(snapshot)
    } catch (error) {
      console.error('Dictation background job listener failed', error)
    }
  }
}

function setCachedJob(job: DictationBackgroundJob): DictationBackgroundJob {
  const cloned = cloneJob(job)
  jobCache.set(cloned.id, cloned)
  emitJobsChanged()
  return cloneJob(cloned)
}

function isDictationBackgroundJobStatus(value: unknown): value is DictationBackgroundJobStatus {
  return value === 'queued' || value === 'transcribing' || value === 'completed' || value === 'failed'
}

function readStoredStorageKey(record: Record<string, unknown>): string {
  return readTrimmedString(record.storageKey) || readTrimmedString(record.recordingKey)
}

function normalizeThreadId(value: unknown, storageKey: string): string {
  const direct = readTrimmedString(value)
  if (direct) return direct

  const threadPrefix = 'thread:'
  if (!storageKey.startsWith(threadPrefix)) return ''
  const withoutPrefix = storageKey.slice(threadPrefix.length)
  const dictationSuffixIndex = withoutPrefix.indexOf(':dictation:')
  return readTrimmedString(dictationSuffixIndex >= 0 ? withoutPrefix.slice(0, dictationSuffixIndex) : withoutPrefix)
}

function normalizeJob(value: unknown): DictationBackgroundJob | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const storageKey = readStoredStorageKey(record)
  const id = readTrimmedString(record.id)
  const recordingId = readTrimmedString(record.recordingId)
  if (!id || !recordingId || !storageKey || !isDictationBackgroundJobStatus(record.status)) return null

  return {
    id,
    recordingId,
    threadId: normalizeThreadId(record.threadId, storageKey),
    storageKey,
    language: readTrimmedString(record.language),
    autoSend: record.autoSend !== false,
    draftOnly: record.draftOnly === true,
    draftSnapshot: normalizeDraftSnapshot(record.draftSnapshot),
    mode: record.mode === 'queue' ? 'queue' : 'steer',
    collaborationMode: record.collaborationMode === 'plan' ? 'plan' : 'default',
    status: record.status,
    transcript: readTrimmedString(record.transcript),
    error: readTrimmedString(record.error),
    retryAttempt: typeof record.retryAttempt === 'number' && Number.isFinite(record.retryAttempt)
      ? Math.max(0, record.retryAttempt)
      : 0,
    retryMaxAttempts: typeof record.retryMaxAttempts === 'number' && Number.isFinite(record.retryMaxAttempts)
      ? Math.max(0, record.retryMaxAttempts)
      : 0,
    createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : nowMs(),
    updatedAt: typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? record.updatedAt : nowMs(),
  }
}

function openJobsDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)

  return new Promise((resolve) => {
    const request = indexedDB.open(JOB_DB_NAME, JOB_DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(JOB_STORE)) {
        db.createObjectStore(JOB_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
}

async function readPersistedJob(id: string): Promise<DictationBackgroundJob | null> {
  const db = await openJobsDb()
  if (!db) return jobCache.get(id) ? cloneJob(jobCache.get(id)!) : null

  return new Promise((resolve) => {
    const transaction = db.transaction(JOB_STORE, 'readonly')
    const request = transaction.objectStore(JOB_STORE).get(id)
    request.onsuccess = () => {
      const job = normalizeJob(request.result)
      const cachedJob = jobCache.get(id)
      resolve(job ? cloneJob(job) : cachedJob ? cloneJob(cachedJob) : null)
    }
    request.onerror = () => {
      const cachedJob = jobCache.get(id)
      resolve(cachedJob ? cloneJob(cachedJob) : null)
    }
    transaction.oncomplete = () => db.close()
    transaction.onerror = () => db.close()
    transaction.onabort = () => db.close()
  })
}

async function readAllPersistedJobs(): Promise<DictationBackgroundJob[]> {
  const db = await openJobsDb()
  if (!db) return []

  return new Promise((resolve) => {
    const transaction = db.transaction(JOB_STORE, 'readonly')
    const request = transaction.objectStore(JOB_STORE).getAll()
    request.onsuccess = () => {
      const records = Array.isArray(request.result) ? request.result : []
      resolve(records.flatMap((record) => {
        const job = normalizeJob(record)
        return job ? [job] : []
      }))
    }
    request.onerror = () => resolve([])
    transaction.oncomplete = () => db.close()
    transaction.onerror = () => db.close()
    transaction.onabort = () => db.close()
  })
}

async function writePersistedJob(job: DictationBackgroundJob): Promise<boolean> {
  const db = await openJobsDb()
  if (!db) return false

  return new Promise((resolve) => {
    const transaction = db.transaction(JOB_STORE, 'readwrite')
    transaction.objectStore(JOB_STORE).put(cloneJob(job))
    transaction.oncomplete = () => {
      db.close()
      resolve(true)
    }
    transaction.onerror = () => {
      db.close()
      resolve(false)
    }
    transaction.onabort = () => {
      db.close()
      resolve(false)
    }
  })
}

function createJobId(recording: StoredDictationRecording): string {
  return `${JOB_ID_PREFIX}${recording.id}`
}

function createRandomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function createAbortReason(message: string): Error | DOMException {
  if (typeof DOMException !== 'undefined') return new DOMException(message, 'AbortError')
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function isAbortError(error: unknown): boolean {
  return (
    (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return readTrimmedString(error.message) || 'Dictation transcription failed.'
  return readTrimmedString(error) || 'Dictation transcription failed.'
}

async function updateJob(job: DictationBackgroundJob): Promise<DictationBackgroundJob> {
  const nextJob = cloneJob(job)
  setCachedJob(nextJob)
  await writePersistedJob(nextJob)
  return cloneJob(nextJob)
}

function matchesRunnerFilter(job: DictationBackgroundJob, options: StartDictationBackgroundJobsOptions): boolean {
  if (options.jobIds && !options.jobIds.includes(job.id)) return false
  if (job.status === 'queued') return true
  if (job.status === 'transcribing') return true
  return Boolean(options.includeFailed && job.status === 'failed')
}

function isRunnableJob(job: DictationBackgroundJob, options: StartDictationBackgroundJobsOptions): boolean {
  return !activeJobIds.has(job.id) && matchesRunnerFilter(job, options)
}

async function readRecordingForJob(job: DictationBackgroundJob): Promise<StoredDictationRecording | null> {
  const persistedRecording = await readStoredDictationRecording(job.storageKey)
  if (persistedRecording?.id === job.recordingId) return persistedRecording

  const cachedRecording = recordingCache.get(job.id)
  if (cachedRecording?.id === job.recordingId && cachedRecording.key === job.storageKey) {
    return cachedRecording
  }

  return null
}

async function notifyJobCallback(
  callback: ((job: DictationBackgroundJob) => void | Promise<void>) | undefined,
  job: DictationBackgroundJob,
): Promise<void> {
  try {
    await callback?.(cloneJob(job))
  } catch (error) {
    console.error('Dictation background job callback failed', error)
  }
}

async function runJob(job: DictationBackgroundJob, options: StartDictationBackgroundJobsOptions): Promise<DictationBackgroundJob | null> {
  if (activeJobIds.has(job.id)) return readPersistedJob(job.id)

  activeJobIds.add(job.id)
  const abortController = new AbortController()
  activeAbortControllers.set(job.id, abortController)

  try {
    const latestJob = (await readPersistedJob(job.id)) ?? job
    if (!matchesRunnerFilter(latestJob, options)) return latestJob

    const startedJob = await updateJob({
      ...latestJob,
      status: 'transcribing',
      error: '',
      updatedAt: nowMs(),
    })

    const recording = await readRecordingForJob(startedJob)
    if (!recording) {
      const failedJob = await updateJob({
        ...startedJob,
        status: 'failed',
        error: 'Saved dictation recording was not found for this background job.',
        updatedAt: nowMs(),
      })
      await notifyJobCallback(options.onFailed, failedJob)
      return failedJob
    }

    const transcript = await transcribeStoredDictationRecording(recording, abortController.signal, (attempt, maxAttempts) => {
      const retryJob = {
        ...startedJob,
        retryAttempt: attempt,
        retryMaxAttempts: maxAttempts,
        updatedAt: nowMs(),
      }
      setCachedJob(retryJob)
      void writePersistedJob(retryJob)
      options.onRetry?.(cloneJob(retryJob), attempt, maxAttempts)
    })

    const completedJob = await updateJob({
      ...startedJob,
      status: 'completed',
      transcript,
      error: '',
      retryAttempt: 0,
      retryMaxAttempts: 0,
      updatedAt: nowMs(),
    })

    try {
      await options.onCompleted?.(cloneJob(completedJob))
      await options.onTranscript?.(cloneJob(completedJob), transcript)
    } catch (error) {
      const failedJob = await updateJob({
        ...completedJob,
        status: 'failed',
        error: readErrorMessage(error),
        updatedAt: nowMs(),
      })
      await notifyJobCallback(options.onFailed, failedJob)
      return failedJob
    }

    await deleteStoredDictationRecording(recording.key, recording.id)
    recordingCache.delete(startedJob.id)
    return completedJob
  } catch (error) {
    const latestJob = (await readPersistedJob(job.id)) ?? job
    if (isAbortError(error)) {
      return updateJob({
        ...latestJob,
        status: 'queued',
        error: '',
        updatedAt: nowMs(),
      })
    }

    const failedJob = await updateJob({
      ...latestJob,
      status: 'failed',
      error: readErrorMessage(error),
      updatedAt: nowMs(),
    })
    await notifyJobCallback(options.onFailed, failedJob)
    return failedJob
  } finally {
    activeAbortControllers.delete(job.id)
    activeJobIds.delete(job.id)
  }
}

export function createDictationBackgroundJobId(recording: StoredDictationRecording): string {
  return createJobId(recording)
}

export function createDictationRecordingStorageKey(threadId: string): string {
  const normalizedThreadId = readTrimmedString(threadId) || 'unassigned'
  return `thread:${normalizedThreadId}:dictation:${createRandomId()}`
}

export async function createDictationBackgroundJob(
  recording: StoredDictationRecording,
  options: CreateDictationBackgroundJobOptions = {},
): Promise<DictationBackgroundJob> {
  const storageKey = readTrimmedString(options.storageKey) || recording.key
  const id = createJobId(recording)
  const existingJob = await readPersistedJob(id)
  if (existingJob) {
    recordingCache.set(existingJob.id, recording)
    jobCache.set(existingJob.id, cloneJob(existingJob))
    return cloneJob(existingJob)
  }

  const createdAt = Number.isFinite(recording.createdAt) ? recording.createdAt : nowMs()
  const job: DictationBackgroundJob = {
    id,
    recordingId: recording.id,
    threadId: normalizeThreadId(options.threadId, storageKey),
    storageKey,
    language: readTrimmedString(options.language) || readTrimmedString(recording.language),
    autoSend: options.autoSend ?? true,
    draftOnly: options.draftOnly ?? false,
    draftSnapshot: normalizeDraftSnapshot(options.draftSnapshot),
    mode: options.mode === 'queue' ? 'queue' : 'steer',
    collaborationMode: options.collaborationMode === 'plan' ? 'plan' : 'default',
    status: 'queued',
    transcript: '',
    error: '',
    retryAttempt: 0,
    retryMaxAttempts: 0,
    createdAt,
    updatedAt: nowMs(),
  }

  recordingCache.set(job.id, recording)
  setCachedJob(job)
  await writePersistedJob(job)
  return cloneJob(job)
}

export async function refreshDictationBackgroundJobs(): Promise<DictationBackgroundJob[]> {
  const persistedJobs = await readAllPersistedJobs()
  for (const job of persistedJobs) {
    jobCache.set(job.id, cloneJob(job))
  }
  emitJobsChanged()
  return createSnapshot()
}

export function getCachedDictationBackgroundJobs(): DictationBackgroundJob[] {
  return createSnapshot()
}

export async function listDictationBackgroundJobs(): Promise<DictationBackgroundJob[]> {
  await refreshDictationBackgroundJobs()
  return createSnapshot()
}

export async function getDictationBackgroundJob(id: string): Promise<DictationBackgroundJob | null> {
  const persistedJob = await readPersistedJob(id)
  if (persistedJob) {
    jobCache.set(persistedJob.id, cloneJob(persistedJob))
    emitJobsChanged()
    return cloneJob(persistedJob)
  }
  return null
}

export async function getDictationBackgroundJobsForThread(threadId: string): Promise<DictationBackgroundJob[]> {
  const normalizedThreadId = readTrimmedString(threadId)
  if (!normalizedThreadId) return []
  const jobs = await listDictationBackgroundJobs()
  return jobs.filter((job) => job.threadId === normalizedThreadId)
}

export async function getDictationBackgroundJobsForStorageKey(storageKey: string): Promise<DictationBackgroundJob[]> {
  const normalizedStorageKey = readTrimmedString(storageKey)
  if (!normalizedStorageKey) return []
  const jobs = await listDictationBackgroundJobs()
  return jobs.filter((job) => job.storageKey === normalizedStorageKey)
}

export function subscribeDictationBackgroundJobs(listener: DictationBackgroundJobListener): () => void {
  listeners.add(listener)
  listener(createSnapshot())
  void refreshDictationBackgroundJobs()

  return () => {
    listeners.delete(listener)
  }
}

export function isDictationBackgroundJobRunning(jobId: string): boolean {
  return activeJobIds.has(jobId)
}

export function cancelDictationBackgroundJob(jobId: string): boolean {
  const abortController = activeAbortControllers.get(jobId)
  if (!abortController) return false
  abortController.abort(createAbortReason('Dictation background job was cancelled.'))
  return true
}

export async function startOrResumePendingDictationBackgroundJobs(
  options: StartDictationBackgroundJobsOptions = {},
): Promise<DictationBackgroundJob[]> {
  if (runnerPromise) return runnerPromise

  runnerPromise = (async () => {
    const jobs = await listDictationBackgroundJobs()
    const completedJobs: DictationBackgroundJob[] = []
    for (const job of jobs) {
      if (!isRunnableJob(job, options)) continue
      const completedJob = await runJob(job, options)
      if (completedJob) completedJobs.push(completedJob)
    }
    return completedJobs
  })().finally(() => {
    runnerPromise = null
  })

  return runnerPromise
}

export async function retryDictationBackgroundJob(jobId: string): Promise<DictationBackgroundJob | null> {
  const job = await readPersistedJob(jobId)
  if (!job || job.status === 'completed') return job

  return updateJob({
    ...job,
    status: 'queued',
    error: '',
    updatedAt: nowMs(),
  })
}

export function useDictationBackgroundJobs(options: {
  onCompleted?: (job: DictationBackgroundJob) => void | Promise<void>
  onTranscript?: (job: DictationBackgroundJob, transcript: string) => void | Promise<void>
  onFailed?: (job: DictationBackgroundJob) => void | Promise<void>
  onRetry?: (job: DictationBackgroundJob, attempt: number, maxAttempts: number) => void
} = {}): DictationBackgroundJobManager {
  const jobs = ref<DictationBackgroundJob[]>(getCachedDictationBackgroundJobs())
  const unsubscribe = subscribeDictationBackgroundJobs((nextJobs) => {
    jobs.value = [...nextJobs]
  })
  onBeforeUnmount(unsubscribe)

  async function startJobEventually(jobId: string): Promise<void> {
    const startOptions = { ...options, jobIds: [jobId], includeFailed: true }
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (activeJobIds.has(jobId)) return
      const results = await startOrResumePendingDictationBackgroundJobs(startOptions)
      if (results.some((job) => job.id === jobId)) return
      const latestJob = await readPersistedJob(jobId)
      if (!latestJob || latestJob.status === 'completed' || !matchesRunnerFilter(latestJob, startOptions)) return
    }
    console.error('Dictation background job did not start after repeated attempts', jobId)
  }

  function startJobInBackground(jobId: string): void {
    void startJobEventually(jobId).catch((error) => {
      console.error('Dictation background job start failed', error)
    })
  }

  return {
    jobs,
    createJob: async (input) => {
      const job = await createDictationBackgroundJob(input.recording, {
        threadId: input.threadId,
        autoSend: input.autoSend,
        draftOnly: input.draftOnly,
        draftSnapshot: input.draftSnapshot,
        mode: input.mode,
        collaborationMode: input.collaborationMode,
      })
      startJobInBackground(job.id)
      return job
    },
    resumePendingJobs: () => startOrResumePendingDictationBackgroundJobs(options),
    retryJob: async (jobId) => {
      const job = await retryDictationBackgroundJob(jobId)
      if (job) await startOrResumePendingDictationBackgroundJobs({ ...options, jobIds: [job.id], includeFailed: true })
      return job
    },
    getJobsForThread: (threadId) => jobs.value.filter((job) => job.threadId === readTrimmedString(threadId)),
  }
}

export function resetDictationBackgroundJobsForTest(): void {
  for (const abortController of activeAbortControllers.values()) {
    abortController.abort(createAbortReason('Dictation background job test reset.'))
  }
  activeAbortControllers.clear()
  activeJobIds.clear()
  recordingCache.clear()
  jobCache.clear()
  listeners.clear()
  runnerPromise = null
}
