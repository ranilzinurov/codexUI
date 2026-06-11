import { resolveBackendHttpUrl } from '../backendUrl'
import { CodexApiError, extractErrorMessage } from './codexErrors'

export type RemoteBackendAuthStatus = 'authenticated' | 'unauthenticated' | 'unknown'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function readJsonPayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) return null
  try {
    return await response.json()
  } catch {
    return null
  }
}

export async function loginRemoteBackend(password: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch(resolveBackendHttpUrl('/auth/login'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
    signal,
  })
  const payload = await readJsonPayload(response)

  if (!response.ok || !isRecord(payload) || payload.ok !== true) {
    throw new CodexApiError(extractErrorMessage(
      payload,
      response.status === 401 ? 'Invalid remote backend password.' : 'Remote backend login failed.',
    ), {
      code: 'http_error',
      method: '/auth/login',
      status: response.status,
    })
  }
}

export async function readRemoteBackendAuthStatus(signal?: AbortSignal): Promise<RemoteBackendAuthStatus> {
  try {
    const response = await fetch(resolveBackendHttpUrl('/codex-api/thread-queue-state'), {
      credentials: 'include',
      signal,
    })
    if (response.status === 401) return 'unauthenticated'
    return response.ok ? 'authenticated' : 'unknown'
  } catch {
    return 'unknown'
  }
}
