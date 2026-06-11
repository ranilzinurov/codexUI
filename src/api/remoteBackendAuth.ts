import { Capacitor, CapacitorCookies, CapacitorHttp, type HttpHeaders, type HttpResponse } from '@capacitor/core'
import { resolveBackendHttpUrl } from '../backendUrl'
import { CodexApiError, extractErrorMessage } from './codexErrors'

export type RemoteBackendAuthStatus = 'authenticated' | 'unauthenticated' | 'unknown'

const REMOTE_SESSION_COOKIE = 'portal_session'
const MOBILE_SHELL_ORIGIN = 'capacitor://localhost'

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

function shouldUseNativeRemoteLogin(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'
}

function findHeader(headers: HttpHeaders, targetName: string): string {
  const normalizedTarget = targetName.toLowerCase()
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === normalizedTarget) return value
  }
  return ''
}

function readNativeJsonPayload(response: HttpResponse): unknown {
  const data = response.data
  if (isRecord(data) || Array.isArray(data)) return data
  if (typeof data !== 'string' || data.trim().length === 0) return null
  try {
    return JSON.parse(data) as unknown
  } catch {
    return data
  }
}

function extractCookieAttribute(setCookieHeader: string, attributeName: string): string {
  const pattern = new RegExp(`(?:^|;)\\s*${attributeName}=([^;]+)`, 'iu')
  return pattern.exec(setCookieHeader)?.[1]?.trim() ?? ''
}

function extractSessionCookieValue(setCookieHeader: string): string {
  const pattern = new RegExp(`(?:^|,\\s*)${REMOTE_SESSION_COOKIE}=([^;,\\s]+)`, 'iu')
  return pattern.exec(setCookieHeader)?.[1]?.trim() ?? ''
}

async function ensureNativeSessionCookie(backendUrl: string, setCookieHeader: string): Promise<void> {
  const currentCookies = await CapacitorCookies.getCookies({ url: backendUrl })
  if (currentCookies[REMOTE_SESSION_COOKIE]) return

  const value = extractSessionCookieValue(setCookieHeader)
  if (!value) {
    throw new CodexApiError('Remote backend accepted the password, but did not return a session cookie.', {
      code: 'invalid_response',
      method: '/auth/login',
    })
  }

  const expires = extractCookieAttribute(setCookieHeader, 'Expires')
  await CapacitorCookies.setCookie({
    url: backendUrl,
    key: REMOTE_SESSION_COOKIE,
    value,
    path: '/',
    ...(expires ? { expires } : {}),
  })

  const nextCookies = await CapacitorCookies.getCookies({ url: backendUrl })
  if (!nextCookies[REMOTE_SESSION_COOKIE]) {
    throw new CodexApiError('Remote backend accepted the password, but the native session cookie was not stored.', {
      code: 'invalid_response',
      method: '/auth/login',
    })
  }
}

async function loginRemoteBackendNative(password: string): Promise<void> {
  const url = resolveBackendHttpUrl('/auth/login')
  const backendOrigin = new URL(url).origin
  try {
    await CapacitorCookies.deleteCookie({ url: backendOrigin, key: REMOTE_SESSION_COOKIE })
  } catch {
    // Best effort: stale cookies should not block a fresh native login attempt.
  }

  const response = await CapacitorHttp.request({
    url,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: MOBILE_SHELL_ORIGIN,
    },
    data: JSON.stringify({ password }),
    responseType: 'json',
    connectTimeout: 20000,
    readTimeout: 20000,
  })
  const payload = readNativeJsonPayload(response)

  if (response.status < 200 || response.status >= 300 || !isRecord(payload) || payload.ok !== true) {
    throw new CodexApiError(extractErrorMessage(
      payload,
      response.status === 401 ? 'Invalid remote backend password.' : 'Remote backend login failed.',
    ), {
      code: 'http_error',
      method: '/auth/login',
      status: response.status,
    })
  }

  const setCookieHeader = findHeader(response.headers, 'set-cookie')
  await ensureNativeSessionCookie(backendOrigin, setCookieHeader)
}

export async function loginRemoteBackend(password: string, signal?: AbortSignal): Promise<void> {
  if (shouldUseNativeRemoteLogin()) {
    await loginRemoteBackendNative(password)
    return
  }

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
    if (!response.ok) return 'unknown'
    const payload = await readJsonPayload(response)
    return isRecord(payload) ? 'authenticated' : 'unknown'
  } catch {
    return 'unknown'
  }
}
