const TRANSCRIPTION_MAX_ATTEMPTS = 3
const TRANSCRIPTION_RETRY_DELAYS_MS = [800, 1800]
const TRANSCRIPTION_ATTEMPT_BASE_TIMEOUT_MS = 60_000
const TRANSCRIPTION_ATTEMPT_TIMEOUT_PER_MB_MS = 30_000
const TRANSCRIPTION_ATTEMPT_MAX_TIMEOUT_MS = 180_000
const DB_NAME = 'codex-web-local-dictation'
const DB_VERSION = 1
const RECORDING_STORE = 'recordings'

export type StoredDictationRecording = {
  key: string
  id: string
  blob: Blob
  mimeType: string
  language: string
  createdAt: number
}

export type DictationTranscriptionRetryHandler = (attempt: number, maxAttempts: number) => void

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readTranscriptionError(value: unknown): string {
  const direct = readTrimmedString(value)
  if (direct) return direct

  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  return readTrimmedString(record.message) || readTranscriptionError(record.error)
}

function createRecordingId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function isStoredDictationRecording(value: unknown): value is StoredDictationRecording {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.key === 'string' &&
    typeof record.id === 'string' &&
    record.blob instanceof Blob &&
    typeof record.mimeType === 'string' &&
    typeof record.language === 'string' &&
    typeof record.createdAt === 'number'
  )
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)

  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(RECORDING_STORE)) {
        db.createObjectStore(RECORDING_STORE, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
}

export function createStoredDictationRecording(
  key: string,
  blob: Blob,
  mimeType: string,
  language: string,
): StoredDictationRecording {
  return {
    key,
    id: createRecordingId(),
    blob,
    mimeType,
    language,
    createdAt: Date.now(),
  }
}

export async function readStoredDictationRecording(key: string): Promise<StoredDictationRecording | null> {
  const db = await openDb()
  if (!db) return null

  return new Promise((resolve) => {
    const transaction = db.transaction(RECORDING_STORE, 'readonly')
    const request = transaction.objectStore(RECORDING_STORE).get(key)
    request.onsuccess = () => resolve(isStoredDictationRecording(request.result) ? request.result : null)
    request.onerror = () => resolve(null)
    transaction.oncomplete = () => db.close()
    transaction.onerror = () => db.close()
    transaction.onabort = () => db.close()
  })
}

export async function writeStoredDictationRecording(recording: StoredDictationRecording): Promise<boolean> {
  const db = await openDb()
  if (!db) return false

  return new Promise((resolve) => {
    const transaction = db.transaction(RECORDING_STORE, 'readwrite')
    transaction.objectStore(RECORDING_STORE).put(recording)
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

export async function deleteStoredDictationRecording(key: string, id?: string): Promise<void> {
  if (id) {
    const existing = await readStoredDictationRecording(key)
    if (existing?.id !== id) return
  }

  const db = await openDb()
  if (!db) return

  await new Promise<void>((resolve) => {
    const transaction = db.transaction(RECORDING_STORE, 'readwrite')
    transaction.objectStore(RECORDING_STORE).delete(key)
    transaction.oncomplete = () => {
      db.close()
      resolve()
    }
    transaction.onerror = () => {
      db.close()
      resolve()
    }
    transaction.onabort = () => {
      db.close()
      resolve()
    }
  })
}

function createAbortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Transcription was cancelled.', 'AbortError')
}

function waitForRetryDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(createAbortError(signal))
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(resolve, delayMs)
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timeout)
        reject(createAbortError(signal))
      },
      { once: true },
    )
  })
}

class TranscriptionRequestError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'TranscriptionRequestError'
    this.status = status
  }
}

function getAttemptTimeoutMs(recording: StoredDictationRecording): number {
  const sizeMb = recording.blob.size / (1024 * 1024)
  const scaledTimeoutMs =
    TRANSCRIPTION_ATTEMPT_BASE_TIMEOUT_MS + Math.ceil(Math.max(0, sizeMb)) * TRANSCRIPTION_ATTEMPT_TIMEOUT_PER_MB_MS
  return Math.min(TRANSCRIPTION_ATTEMPT_MAX_TIMEOUT_MS, scaledTimeoutMs)
}

export function isDictationTranscriptionAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isRetryableTranscriptionError(error: unknown): boolean {
  if (isDictationTranscriptionAbortError(error)) return false
  if (!(error instanceof TranscriptionRequestError)) return true
  if (error.status === null) return true
  return error.status === 408 || error.status === 409 || error.status === 425 || error.status === 429 || error.status >= 500
}

async function fetchTranscriptionWithTimeout(
  recording: StoredDictationRecording,
  formData: FormData,
  parentSignal: AbortSignal,
): Promise<Response> {
  if (parentSignal.aborted) {
    throw createAbortError(parentSignal)
  }

  const requestAbortController = new AbortController()
  let timedOut = false
  let abortedByParent = false
  const timeoutMs = getAttemptTimeoutMs(recording)
  const timeout = window.setTimeout(() => {
    timedOut = true
    requestAbortController.abort()
  }, timeoutMs)
  const abortFromParent = () => {
    abortedByParent = true
    requestAbortController.abort()
  }
  parentSignal.addEventListener('abort', abortFromParent, { once: true })

  try {
    return await fetch('/codex-api/transcribe', {
      method: 'POST',
      body: formData,
      signal: requestAbortController.signal,
    })
  } catch (error) {
    if (timedOut) {
      const seconds = Math.round(timeoutMs / 1000)
      throw new TranscriptionRequestError(`No transcription response after ${seconds} seconds`, 408)
    }
    if (abortedByParent || parentSignal.aborted) {
      throw createAbortError(parentSignal)
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
    parentSignal.removeEventListener('abort', abortFromParent)
  }
}

async function postTranscription(recording: StoredDictationRecording, signal: AbortSignal): Promise<string> {
  const ext = recording.mimeType.split(/[/;]/)[1] ?? 'webm'
  const formData = new FormData()
  formData.append('file', recording.blob, `codex.${ext}`)
  if (recording.language && recording.language.toLowerCase() !== 'auto') {
    formData.append('language', recording.language)
  }

  const response = await fetchTranscriptionWithTimeout(recording, formData, signal)

  const responseText = await response.text()
  let data: { text?: unknown; error?: unknown } | null = null
  try {
    data = responseText.trim() ? (JSON.parse(responseText) as { text?: unknown; error?: unknown }) : null
  } catch {
    data = null
  }

  if (!response.ok) {
    const jsonError = readTranscriptionError(data?.error)
    const textError = responseText.trim()
    throw new TranscriptionRequestError(jsonError || textError || `Transcription failed: ${response.status}`, response.status)
  }

  if (!data || !('text' in data)) {
    throw new TranscriptionRequestError('Transcription response did not include text.', response.status)
  }

  return readTrimmedString(data.text)
}

export async function transcribeStoredDictationRecording(
  recording: StoredDictationRecording,
  signal: AbortSignal,
  onRetry?: DictationTranscriptionRetryHandler,
): Promise<string> {
  let lastError: unknown = null
  for (let attempt = 1; attempt <= TRANSCRIPTION_MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      await waitForRetryDelay(TRANSCRIPTION_RETRY_DELAYS_MS[attempt - 2] ?? 1800, signal)
      onRetry?.(attempt, TRANSCRIPTION_MAX_ATTEMPTS)
    }

    try {
      return await postTranscription(recording, signal)
    } catch (error) {
      lastError = error
      if (!isRetryableTranscriptionError(error) || attempt === TRANSCRIPTION_MAX_ATTEMPTS) {
        throw error
      }
    }
  }

  throw lastError
}
