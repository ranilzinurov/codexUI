import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDictationBackgroundJob,
  createDictationBackgroundJobId,
  getDictationBackgroundJob,
  getDictationBackgroundJobsForStorageKey,
  getDictationBackgroundJobsForThread,
  isDictationBackgroundJobRunning,
  listDictationBackgroundJobs,
  resetDictationBackgroundJobsForTest,
  startOrResumePendingDictationBackgroundJobs,
  useDictationBackgroundJobs,
  type DictationBackgroundJob,
  type DictationDraftSnapshot,
} from './dictationBackgroundJobs'
import type { StoredDictationRecording } from './dictationTranscription'

const JOB_DB_NAME_FOR_TEST = 'codex-web-local-dictation-jobs'
const JOB_STORE_FOR_TEST = 'jobs'

const transcriptionMock = vi.hoisted(() => {
  const recordings = new Map<string, StoredDictationRecording>()
  return {
    recordings,
    readStoredDictationRecording: vi.fn(async (key: string) => recordings.get(key) ?? null),
    deleteStoredDictationRecording: vi.fn(async (key: string, id?: string) => {
      const recording = recordings.get(key)
      if (!id || recording?.id === id) {
        recordings.delete(key)
      }
    }),
    transcribeStoredDictationRecording: vi.fn(async (recording: StoredDictationRecording) => `transcript:${recording.id}`),
  }
})

const nativeAudioMock = vi.hoisted(() => ({
  beginVoiceWaitingSession: vi.fn(async () => ({ ok: true })),
  endVoiceWaitingSession: vi.fn(async () => ({ ok: true })),
}))

vi.mock('./dictationTranscription', () => ({
  readStoredDictationRecording: transcriptionMock.readStoredDictationRecording,
  deleteStoredDictationRecording: transcriptionMock.deleteStoredDictationRecording,
  transcribeStoredDictationRecording: transcriptionMock.transcribeStoredDictationRecording,
}))

vi.mock('../native/codexAudioSession', () => nativeAudioMock)

type FakeStore = {
  keyPath: string
  records: Map<string, unknown>
}

type FakeDatabaseState = {
  version: number
  stores: Map<string, FakeStore>
}

type FakeRequest<T = unknown> = {
  result: T | undefined
  onsuccess: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
  onblocked?: ((event: Event) => void) | null
  onupgradeneeded?: ((event: Event) => void) | null
}

const fakeDatabases = new Map<string, FakeDatabaseState>()

function cloneRecord<T>(value: T): T {
  if (!value || typeof value !== 'object') return value
  return { ...(value as Record<string, unknown>) } as T
}

function createFakeRequest<T = unknown>(): FakeRequest<T> {
  return {
    result: undefined,
    onsuccess: null,
    onerror: null,
  }
}

function fireRequestSuccess<T>(request: FakeRequest<T>, result: T, onDone?: () => void): void {
  queueMicrotask(() => {
    request.result = result
    request.onsuccess?.({} as Event)
    onDone?.()
  })
}

class FakeTransaction {
  oncomplete: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onabort: ((event: Event) => void) | null = null

  private didScheduleComplete = false

  constructor(private readonly store: FakeStore) {}

  objectStore(): FakeObjectStore {
    return new FakeObjectStore(this.store, this)
  }

  complete(): void {
    if (this.didScheduleComplete) return
    this.didScheduleComplete = true
    queueMicrotask(() => {
      this.oncomplete?.({} as Event)
    })
  }
}

class FakeObjectStore {
  constructor(
    private readonly store: FakeStore,
    private readonly transaction: FakeTransaction,
  ) {}

  get(key: string): IDBRequest {
    const request = createFakeRequest()
    fireRequestSuccess(request, cloneRecord(this.store.records.get(String(key))), () => this.transaction.complete())
    return request as unknown as IDBRequest
  }

  getAll(): IDBRequest {
    const request = createFakeRequest()
    const records = [...this.store.records.values()].map(cloneRecord)
    fireRequestSuccess(request, records, () => this.transaction.complete())
    return request as unknown as IDBRequest
  }

  put(value: Record<string, unknown>): IDBRequest {
    const request = createFakeRequest()
    const key = String(value[this.store.keyPath])
    this.store.records.set(key, cloneRecord(value))
    fireRequestSuccess(request, key, () => this.transaction.complete())
    return request as unknown as IDBRequest
  }

  delete(key: string): IDBRequest {
    const request = createFakeRequest()
    this.store.records.delete(String(key))
    fireRequestSuccess(request, undefined, () => this.transaction.complete())
    return request as unknown as IDBRequest
  }
}

class FakeDatabase {
  readonly objectStoreNames = {
    contains: (name: string) => this.state.stores.has(name),
  }

  constructor(private readonly state: FakeDatabaseState) {}

  createObjectStore(name: string, options: IDBObjectStoreParameters = {}): IDBObjectStore {
    const keyPath = typeof options.keyPath === 'string' ? options.keyPath : 'id'
    const store: FakeStore = { keyPath, records: new Map() }
    this.state.stores.set(name, store)
    return new FakeObjectStore(store, new FakeTransaction(store)) as unknown as IDBObjectStore
  }

  transaction(storeName: string): IDBTransaction {
    const store = this.state.stores.get(storeName)
    if (!store) throw new Error(`Missing fake IndexedDB store: ${storeName}`)
    return new FakeTransaction(store) as unknown as IDBTransaction
  }

  close(): void {}
}

function installFakeIndexedDb(): void {
  fakeDatabases.clear()
  vi.stubGlobal('indexedDB', {
    open: (name: string, version = 1) => {
      const request = createFakeRequest<FakeDatabase>()
      request.onblocked = null
      request.onupgradeneeded = null

      queueMicrotask(() => {
        let state = fakeDatabases.get(name)
        const needsUpgrade = !state || version > state.version
        if (!state) {
          state = { version, stores: new Map() }
          fakeDatabases.set(name, state)
        } else if (version > state.version) {
          state.version = version
        }

        request.result = new FakeDatabase(state)
        if (needsUpgrade) {
          request.onupgradeneeded?.({} as Event)
        }
        request.onsuccess?.({} as Event)
      })

      return request
    },
  })
}

function getFakeJobRecords(): Map<string, unknown> {
  const database = fakeDatabases.get(JOB_DB_NAME_FOR_TEST)
  const store = database?.stores.get(JOB_STORE_FOR_TEST)
  if (!store) throw new Error('Expected fake dictation jobs store to exist')
  return store.records
}

function makeRecording(options: Partial<StoredDictationRecording> = {}): StoredDictationRecording {
  return {
    key: 'thread:alpha',
    id: 'recording-alpha',
    blob: new Blob(['voice'], { type: 'audio/webm' }),
    mimeType: 'audio/webm',
    language: 'ru',
    createdAt: 1_000,
    ...options,
  }
}

beforeEach(() => {
  installFakeIndexedDb()
  transcriptionMock.recordings.clear()
  transcriptionMock.readStoredDictationRecording.mockClear()
  transcriptionMock.deleteStoredDictationRecording.mockClear()
  transcriptionMock.transcribeStoredDictationRecording.mockClear()
  transcriptionMock.transcribeStoredDictationRecording.mockImplementation(
    async (recording: StoredDictationRecording) => `transcript:${recording.id}`,
  )
  nativeAudioMock.beginVoiceWaitingSession.mockClear()
  nativeAudioMock.endVoiceWaitingSession.mockClear()
  nativeAudioMock.beginVoiceWaitingSession.mockResolvedValue({ ok: true })
  nativeAudioMock.endVoiceWaitingSession.mockResolvedValue({ ok: true })
  resetDictationBackgroundJobsForTest()
})

describe('dictation background jobs', () => {
  it('creates stable metadata and queries jobs by thread id or storage key', async () => {
    const recording = makeRecording()

    const job = await createDictationBackgroundJob(recording, {
      autoSend: false,
      draftOnly: true,
    })
    const duplicate = await createDictationBackgroundJob(recording, {
      threadId: 'other-thread',
      autoSend: true,
      draftOnly: false,
    })

    expect(createDictationBackgroundJobId(recording)).toBe('dictation-job:recording-alpha')
    expect(job).toMatchObject<Partial<DictationBackgroundJob>>({
      id: 'dictation-job:recording-alpha',
      recordingId: 'recording-alpha',
      threadId: 'alpha',
      storageKey: 'thread:alpha',
      language: 'ru',
      autoSend: false,
      draftOnly: true,
      status: 'queued',
      transcript: '',
      error: '',
    })
    expect(duplicate).toEqual(job)
    expect(await getDictationBackgroundJobsForThread('alpha')).toHaveLength(1)
    expect(await getDictationBackgroundJobsForStorageKey('thread:alpha')).toHaveLength(1)
    expect(await listDictationBackgroundJobs()).toHaveLength(1)
  })

  it('persists draft snapshots and normalizes untrusted stored records', async () => {
    const recording = makeRecording()
    const draftSnapshot: DictationDraftSnapshot = {
      text: 'typed before stop',
      imageUrls: ['blob:image-one'],
      fileAttachments: [{
        label: 'notes.md',
        path: '/workspace/notes.md',
        fsPath: '/workspace/notes.md',
      }],
      skills: [{
        name: 'frontend-skill',
        path: '/skills/frontend-skill/SKILL.md',
      }],
    }

    const job = await createDictationBackgroundJob(recording, { draftSnapshot })
    draftSnapshot.imageUrls.push('blob:mutated-after-create')

    expect(job.draftSnapshot).toEqual({
      text: 'typed before stop',
      imageUrls: ['blob:image-one'],
      fileAttachments: [{
        label: 'notes.md',
        path: '/workspace/notes.md',
        fsPath: '/workspace/notes.md',
      }],
      skills: [{
        name: 'frontend-skill',
        path: '/skills/frontend-skill/SKILL.md',
      }],
    })

    const records = getFakeJobRecords()
    const storedRecord = records.get(job.id) as Record<string, unknown>
    records.set(job.id, {
      ...storedRecord,
      draftSnapshot: {
        text: 42,
        imageUrls: ['blob:image-ok', 7, null, ''],
        fileAttachments: [
          { label: 'valid.txt', path: '/tmp/valid.txt', fsPath: '/tmp/valid.txt', extra: true },
          { label: 'missing-fs-path.txt', path: '/tmp/missing-fs-path.txt' },
          { label: 9, path: '/tmp/bad-label.txt', fsPath: '/tmp/bad-label.txt' },
        ],
        skills: [
          { name: 'valid-skill', path: '/skills/valid/SKILL.md', extra: 'ignored' },
          { name: 'missing-path' },
          { name: 3, path: '/skills/bad/SKILL.md' },
        ],
      },
    })
    resetDictationBackgroundJobsForTest()

    expect((await getDictationBackgroundJob(job.id))?.draftSnapshot).toEqual({
      text: '',
      imageUrls: ['blob:image-ok', ''],
      fileAttachments: [{
        label: 'valid.txt',
        path: '/tmp/valid.txt',
        fsPath: '/tmp/valid.txt',
      }],
      skills: [{
        name: 'valid-skill',
        path: '/skills/valid/SKILL.md',
      }],
    })
  })

  it('defaults missing persisted draft snapshots for older jobs', async () => {
    const recording = makeRecording()
    const job = await createDictationBackgroundJob(recording, {
      draftSnapshot: {
        text: 'old draft',
        imageUrls: ['blob:image'],
        fileAttachments: [],
        skills: [],
      },
    })
    const records = getFakeJobRecords()
    const storedRecord = { ...(records.get(job.id) as Record<string, unknown>) }
    delete storedRecord.draftSnapshot
    records.set(job.id, storedRecord)
    resetDictationBackgroundJobsForTest()

    expect((await getDictationBackgroundJob(job.id))?.draftSnapshot).toEqual({
      text: '',
      imageUrls: [],
      fileAttachments: [],
      skills: [],
    })
  })

  it('does not transcribe the same job twice when resume is invoked concurrently', async () => {
    const recording = makeRecording()
    transcriptionMock.recordings.set(recording.key, recording)
    let resolveTranscript: (text: string) => void = () => {}
    transcriptionMock.transcribeStoredDictationRecording.mockImplementationOnce(
      () => new Promise<string>((resolve) => {
        resolveTranscript = resolve
      }),
    )

    const job = await createDictationBackgroundJob(recording)
    const firstRun = startOrResumePendingDictationBackgroundJobs()
    const secondRun = startOrResumePendingDictationBackgroundJobs()

    await vi.waitFor(() => {
      expect(transcriptionMock.transcribeStoredDictationRecording).toHaveBeenCalledTimes(1)
    })
    expect(isDictationBackgroundJobRunning(job.id)).toBe(true)

    resolveTranscript('hello from background')
    const [firstResult, secondResult] = await Promise.all([firstRun, secondRun])

    expect(firstResult).toEqual(secondResult)
    expect(firstResult[0]).toMatchObject({
      id: job.id,
      status: 'completed',
      transcript: 'hello from background',
    })
    expect(transcriptionMock.deleteStoredDictationRecording).toHaveBeenCalledWith(recording.key, recording.id)
    expect((await getDictationBackgroundJob(job.id))?.status).toBe('completed')
    expect(nativeAudioMock.beginVoiceWaitingSession).toHaveBeenCalledWith({ keepAlive: true })
    expect(nativeAudioMock.endVoiceWaitingSession).toHaveBeenCalledTimes(1)
  })

  it('marks a persisted pending job failed when its recording is unavailable after reload', async () => {
    const recording = makeRecording()
    const job = await createDictationBackgroundJob(recording)
    resetDictationBackgroundJobsForTest()

    const results = await startOrResumePendingDictationBackgroundJobs()

    expect(transcriptionMock.transcribeStoredDictationRecording).not.toHaveBeenCalled()
    expect(results[0]).toMatchObject({
      id: job.id,
      status: 'failed',
      error: 'Saved dictation recording was not found for this background job.',
    })
    expect((await getDictationBackgroundJob(job.id))?.status).toBe('failed')
  })

  it('marks a transcribed job failed when completion dispatch fails', async () => {
    const recording = makeRecording()
    transcriptionMock.recordings.set(recording.key, recording)
    const onFailed = vi.fn()

    const job = await createDictationBackgroundJob(recording)
    const results = await startOrResumePendingDictationBackgroundJobs({
      onCompleted: async () => {
        throw new Error('target thread send failed')
      },
      onFailed,
    })

    expect(results[0]).toMatchObject({
      id: job.id,
      status: 'failed',
      transcript: 'transcript:recording-alpha',
      error: 'target thread send failed',
    })
    expect(transcriptionMock.deleteStoredDictationRecording).not.toHaveBeenCalled()
    expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({
      id: job.id,
      status: 'failed',
    }))
  })

  it('emits manager job state when completion dispatch fails', async () => {
    const recording = makeRecording()
    transcriptionMock.recordings.set(recording.key, recording)
    const manager = useDictationBackgroundJobs({
      onCompleted: async () => {
        throw new Error('target thread send failed')
      },
    })

    const job = await manager.createJob({
      recording,
      threadId: 'alpha',
      autoSend: true,
      draftOnly: false,
    })

    await vi.waitFor(() => {
      expect(manager.jobs.value.find((candidate) => candidate.id === job.id)).toMatchObject({
        id: job.id,
        status: 'failed',
        transcript: 'transcript:recording-alpha',
        error: 'target thread send failed',
      })
    })
  })

  it('starts manager-created jobs immediately', async () => {
    const recording = makeRecording()
    transcriptionMock.recordings.set(recording.key, recording)
    const onCompleted = vi.fn()
    const manager = useDictationBackgroundJobs({ onCompleted })
    const draftSnapshot: DictationDraftSnapshot = {
      text: 'send this with the transcript',
      imageUrls: ['blob:image-one'],
      fileAttachments: [{
        label: 'design.png',
        path: '/workspace/design.png',
        fsPath: '/workspace/design.png',
      }],
      skills: [{
        name: 'impeccable',
        path: '/skills/impeccable/SKILL.md',
      }],
    }

    const job = await manager.createJob({
      recording,
      threadId: 'alpha',
      autoSend: true,
      draftOnly: false,
      draftSnapshot,
      mode: 'queue',
      collaborationMode: 'plan',
    })

    await vi.waitFor(() => {
      expect(onCompleted).toHaveBeenCalledWith(expect.objectContaining({
        id: job.id,
        status: 'completed',
        transcript: 'transcript:recording-alpha',
        draftSnapshot,
        mode: 'queue',
        collaborationMode: 'plan',
      }))
    })
    expect(manager.jobs.value.find((candidate) => candidate.id === job.id)).toMatchObject({
      status: 'completed',
      transcript: 'transcript:recording-alpha',
      draftSnapshot,
    })
    expect(transcriptionMock.deleteStoredDictationRecording).toHaveBeenCalledWith(recording.key, recording.id)
    expect((await getDictationBackgroundJob(job.id))?.status).toBe('completed')
  })
})
