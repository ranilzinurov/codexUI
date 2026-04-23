import { CodexApiError, extractErrorMessage } from './codexErrors'

export type SerializablePushSubscription = {
  endpoint: string
  expirationTime: number | null
  keys: {
    p256dh: string
    auth: string
  }
}

export type TaskNotificationStatus = {
  supported: boolean
  vapidPublicKey: string
  subject: string
  subscriptionCount: number
}

type JsonEnvelope<T> = {
  data: T
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw new CodexApiError(
      error instanceof Error ? error.message : `Request to ${path} failed before it was sent`,
      { code: 'network_error', method: path },
    )
  }

  const payload = await parseJsonResponse(response)
  if (!response.ok) {
    throw new CodexApiError(
      extractErrorMessage(payload, `Request to ${path} failed with HTTP ${response.status}`),
      { code: 'http_error', method: path, status: response.status },
    )
  }

  const envelope = payload as JsonEnvelope<T> | null
  if (!envelope || typeof envelope !== 'object' || !('data' in envelope)) {
    throw new CodexApiError(`Request to ${path} returned malformed JSON`, {
      code: 'invalid_response',
      method: path,
      status: response.status,
    })
  }

  return envelope.data
}

export async function fetchTaskNotificationStatus(): Promise<TaskNotificationStatus> {
  let response: Response
  try {
    response = await fetch('/codex-api/push/status')
  } catch (error) {
    throw new CodexApiError(
      error instanceof Error ? error.message : 'Push status request failed before it was sent',
      { code: 'network_error', method: '/codex-api/push/status' },
    )
  }

  const payload = await parseJsonResponse(response)
  if (!response.ok) {
    throw new CodexApiError(
      extractErrorMessage(payload, `Push status failed with HTTP ${response.status}`),
      { code: 'http_error', method: '/codex-api/push/status', status: response.status },
    )
  }

  const envelope = payload as JsonEnvelope<TaskNotificationStatus> | null
  if (!envelope || typeof envelope !== 'object' || !('data' in envelope)) {
    throw new CodexApiError('Push status returned malformed JSON', {
      code: 'invalid_response',
      method: '/codex-api/push/status',
      status: response.status,
    })
  }

  return envelope.data
}

export async function subscribeTaskNotifications(payload: {
  subscription: SerializablePushSubscription
  deviceId: string
  userAgent: string
  locale: string
}): Promise<void> {
  await postJson('/codex-api/push/subscribe', payload)
}

export async function unsubscribeTaskNotifications(payload: {
  subscription?: SerializablePushSubscription
  endpoint?: string
  deviceId: string
}): Promise<void> {
  await postJson('/codex-api/push/unsubscribe', payload)
}

export async function sendTaskNotificationTest(payload: {
  subscription: SerializablePushSubscription
}): Promise<void> {
  await postJson('/codex-api/push/test', payload)
}
