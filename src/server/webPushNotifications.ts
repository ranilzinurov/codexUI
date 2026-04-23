import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  createSign,
  generateKeyPairSync,
  type KeyObject,
  hkdfSync,
  randomBytes,
} from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'

type JsonRecord = Record<string, unknown>

type PushSubscriptionKeys = {
  p256dh: string
  auth: string
}

type PushSubscriptionData = {
  endpoint: string
  expirationTime: number | null
  keys: PushSubscriptionKeys
}

type StoredPushSubscription = PushSubscriptionData & {
  deviceId: string
  userAgent: string
  locale: string
  createdAtIso: string
  updatedAtIso: string
}

type EcKeyJwk = {
  kty: 'EC'
  crv: 'P-256'
  x: string
  y: string
  d?: string
}

type WebPushState = {
  version: 1
  vapid: {
    subject: string
    publicJwk: EcKeyJwk
    privateJwk: EcKeyJwk
  }
  subscriptions: StoredPushSubscription[]
}

type ThreadNotificationContext = {
  title: string
}

type NotificationDeliveryResult = {
  ok: boolean
  status: number
  body: string
}

const WEB_PUSH_STATE_VERSION = 1
const WEB_PUSH_RECORD_SIZE = 4096
const WEB_PUSH_TTL_SECONDS = 60
const DEFAULT_VAPID_SUBJECT = 'mailto:codexui@localhost'
const MAX_NOTIFICATION_BODY_LENGTH = 160
const TASK_NOTIFICATION_ICON = '/icons/pwa-192x192.png'

function getCodexHomeDir(): string {
  const codexHome = process.env.CODEX_HOME?.trim()
  return codexHome && codexHome.length > 0 ? codexHome : join(homedir(), '.codex')
}

function getWebPushStatePath(): string {
  return join(getCodexHomeDir(), 'web-push-notifications.json')
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function base64UrlEncode(value: Buffer | string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/gu, '')
}

function base64UrlDecode(value: string): Buffer {
  const normalized = value.replace(/-/gu, '+').replace(/_/gu, '/')
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  return Buffer.from(normalized + padding, 'base64')
}

function normalizePushSubscription(value: unknown): PushSubscriptionData | null {
  const record = asRecord(value)
  if (!record) return null

  const endpoint = asString(record.endpoint)
  if (!endpoint) return null

  let parsedEndpoint: URL
  try {
    parsedEndpoint = new URL(endpoint)
  } catch {
    return null
  }

  if (parsedEndpoint.protocol !== 'https:') {
    return null
  }

  const keys = asRecord(record.keys)
  const p256dh = asString(keys?.p256dh)
  const auth = asString(keys?.auth)
  if (!p256dh || !auth) {
    return null
  }

  try {
    const uaPublicKey = base64UrlDecode(p256dh)
    const authSecret = base64UrlDecode(auth)
    if (uaPublicKey.length !== 65 || authSecret.length < 16) {
      return null
    }
  } catch {
    return null
  }

  return {
    endpoint: parsedEndpoint.toString(),
    expirationTime: asOptionalNumber(record.expirationTime),
    keys: {
      p256dh,
      auth,
    },
  }
}

function truncateText(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

function toPublicKeyBuffer(jwk: EcKeyJwk): Buffer {
  return Buffer.concat([
    Buffer.from([0x04]),
    base64UrlDecode(jwk.x),
    base64UrlDecode(jwk.y),
  ])
}

function generateVapidKeys(): { publicJwk: EcKeyJwk; privateJwk: EcKeyJwk } {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  }) as { publicKey: KeyObject; privateKey: KeyObject }

  return {
    publicJwk: publicKey.export({ format: 'jwk' }) as EcKeyJwk,
    privateJwk: privateKey.export({ format: 'jwk' }) as EcKeyJwk,
  }
}

function createInitialState(): WebPushState {
  const { publicJwk, privateJwk } = generateVapidKeys()
  return {
    version: WEB_PUSH_STATE_VERSION,
    vapid: {
      subject: process.env.CODEXUI_VAPID_SUBJECT?.trim() || DEFAULT_VAPID_SUBJECT,
      publicJwk,
      privateJwk,
    },
    subscriptions: [],
  }
}

function normalizeStoredState(value: unknown): WebPushState | null {
  const record = asRecord(value)
  if (!record || record.version !== WEB_PUSH_STATE_VERSION) return null

  const vapid = asRecord(record.vapid)
  const publicJwk = asRecord(vapid?.publicJwk)
  const privateJwk = asRecord(vapid?.privateJwk)
  const subject = asString(vapid?.subject) || DEFAULT_VAPID_SUBJECT
  if (!publicJwk || !privateJwk) return null

  const normalizedPublic: EcKeyJwk = {
    kty: 'EC',
    crv: 'P-256',
    x: asString(publicJwk.x),
    y: asString(publicJwk.y),
  }

  const normalizedPrivate: EcKeyJwk = {
    kty: 'EC',
    crv: 'P-256',
    x: asString(privateJwk.x),
    y: asString(privateJwk.y),
    d: asString(privateJwk.d),
  }

  if (!normalizedPublic.x || !normalizedPublic.y || !normalizedPrivate.x || !normalizedPrivate.y || !normalizedPrivate.d) {
    return null
  }

  const subscriptions = Array.isArray(record.subscriptions)
    ? record.subscriptions
        .map((entry) => {
          const row = asRecord(entry)
          if (!row) return null
          const subscription = normalizePushSubscription(row)
          const deviceId = asString(row.deviceId)
          if (!subscription || !deviceId) return null
          return {
            ...subscription,
            deviceId,
            userAgent: asString(row.userAgent),
            locale: asString(row.locale),
            createdAtIso: asString(row.createdAtIso) || new Date().toISOString(),
            updatedAtIso: asString(row.updatedAtIso) || new Date().toISOString(),
          } satisfies StoredPushSubscription
        })
        .filter((entry): entry is StoredPushSubscription => entry !== null)
    : []

  return {
    version: WEB_PUSH_STATE_VERSION,
    vapid: {
      subject,
      publicJwk: normalizedPublic,
      privateJwk: normalizedPrivate,
    },
    subscriptions,
  }
}

function buildJwt(state: WebPushState, audience: string): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'ES256', typ: 'JWT' }))
  const payload = base64UrlEncode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + (12 * 60 * 60),
    sub: state.vapid.subject,
  }))
  const unsignedToken = `${header}.${payload}`
  const signer = createSign('sha256')
  signer.update(unsignedToken)
  signer.end()
  const signature = signer.sign({
    key: createPrivateKey({ key: state.vapid.privateJwk as never, format: 'jwk' }),
    dsaEncoding: 'ieee-p1363',
  })
  return `${unsignedToken}.${base64UrlEncode(signature)}`
}

function encryptPushPayload(subscription: PushSubscriptionData, payload: string): Buffer {
  const uaPublicKey = base64UrlDecode(subscription.keys.p256dh)
  const authSecret = base64UrlDecode(subscription.keys.auth)
  const salt = randomBytes(16)

  const localKey = createECDH('prime256v1')
  const localPublicKey = localKey.generateKeys()
  const sharedSecret = localKey.computeSecret(uaPublicKey)

  const info = Buffer.concat([
    Buffer.from('WebPush: info\u0000', 'utf8'),
    uaPublicKey,
    localPublicKey,
  ])
  const ikm = Buffer.from(hkdfSync('sha256', sharedSecret, authSecret, info, 32))
  const contentEncryptionKey = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\u0000', 'utf8'), 16))
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\u0000', 'utf8'), 12))

  const plaintext = Buffer.concat([Buffer.from(payload, 'utf8'), Buffer.from([0x02])])
  const cipher = createCipheriv('aes-128-gcm', contentEncryptionKey, nonce)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()

  const header = Buffer.alloc(21 + localPublicKey.length)
  salt.copy(header, 0)
  header.writeUInt32BE(WEB_PUSH_RECORD_SIZE, 16)
  header.writeUInt8(localPublicKey.length, 20)
  localPublicKey.copy(header, 21)

  return Buffer.concat([header, ciphertext, tag])
}

async function sendWebPushRequest(
  state: WebPushState,
  subscription: PushSubscriptionData,
  payload: string,
): Promise<NotificationDeliveryResult> {
  const endpoint = new URL(subscription.endpoint)
  const body = encryptPushPayload(subscription, payload)
  const requestBody = new Uint8Array(body.byteLength)
  requestBody.set(body)
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${buildJwt(state, endpoint.origin)}, k=${base64UrlEncode(toPublicKeyBuffer(state.vapid.publicJwk))}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Length': String(body.byteLength),
      'Content-Type': 'application/octet-stream',
      TTL: String(WEB_PUSH_TTL_SECONDS),
      Urgency: 'normal',
    },
    body: requestBody,
  })

  return {
    ok: response.ok,
    status: response.status,
    body: truncateText(await response.text(), 600),
  }
}

export class WebPushNotifications {
  private state: WebPushState | null = null
  private loadPromise: Promise<WebPushState> | null = null
  private writePromise: Promise<void> = Promise.resolve()
  private readonly threadContextById = new Map<string, ThreadNotificationContext>()

  private async ensureState(): Promise<WebPushState> {
    if (this.state) return this.state
    if (this.loadPromise) return this.loadPromise

    this.loadPromise = (async () => {
      const statePath = getWebPushStatePath()
      try {
        const raw = await readFile(statePath, 'utf8')
        const parsed = normalizeStoredState(JSON.parse(raw) as unknown)
        if (parsed) {
          this.state = parsed
          return parsed
        }
      } catch {
        // Fall back to a fresh state file.
      }

      const created = createInitialState()
      this.state = created
      await this.persistState(created)
      return created
    })().finally(() => {
      this.loadPromise = null
    })

    return this.loadPromise
  }

  private async persistState(state: WebPushState): Promise<void> {
    const statePath = getWebPushStatePath()
    const tempPath = `${statePath}.tmp`
    const body = `${JSON.stringify(state, null, 2)}\n`

    this.writePromise = this.writePromise.then(async () => {
      await mkdir(getCodexHomeDir(), { recursive: true })
      await writeFile(tempPath, body, 'utf8')
      await rename(tempPath, statePath)
    })

    await this.writePromise
  }

  private rememberThreadContext(notification: { method: string; params: unknown }): void {
    if (notification.method !== 'thread/name/updated') return
    const params = asRecord(notification.params)
    const threadId = asString(params?.threadId)
    const title = asString(params?.threadName)
    if (!threadId || !title) return
    this.threadContextById.set(threadId, { title })
  }

  private formatThreadLabel(threadId: string): string {
    const knownTitle = this.threadContextById.get(threadId)?.title.trim() ?? ''
    if (knownTitle) return knownTitle
    return threadId ? `Thread ${threadId.slice(0, 8)}` : 'Current thread'
  }

  async getStatus(): Promise<{ supported: true; vapidPublicKey: string; subject: string; subscriptionCount: number }> {
    const state = await this.ensureState()
    return {
      supported: true,
      vapidPublicKey: base64UrlEncode(toPublicKeyBuffer(state.vapid.publicJwk)),
      subject: state.vapid.subject,
      subscriptionCount: state.subscriptions.length,
    }
  }

  async subscribe(payload: unknown): Promise<{ subscription: StoredPushSubscription; total: number }> {
    const state = await this.ensureState()
    const body = asRecord(payload)
    const subscription = normalizePushSubscription(body?.subscription)
    const deviceId = asString(body?.deviceId)
    if (!subscription || !deviceId) {
      throw new Error('Expected push subscription and deviceId.')
    }

    const nowIso = new Date().toISOString()
    const nextEntry: StoredPushSubscription = {
      ...subscription,
      deviceId,
      userAgent: asString(body?.userAgent),
      locale: asString(body?.locale),
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
    }

    const existing = state.subscriptions.find((entry) => entry.endpoint === subscription.endpoint)
    if (existing) {
      nextEntry.createdAtIso = existing.createdAtIso
    }

    state.subscriptions = [
      ...state.subscriptions.filter((entry) => entry.endpoint !== subscription.endpoint && entry.deviceId !== deviceId),
      nextEntry,
    ]
    this.state = state
    await this.persistState(state)

    return {
      subscription: nextEntry,
      total: state.subscriptions.length,
    }
  }

  async unsubscribe(payload: unknown): Promise<{ removed: boolean; total: number }> {
    const state = await this.ensureState()
    const body = asRecord(payload)
    const subscription = normalizePushSubscription(body?.subscription)
    const endpoint = subscription?.endpoint || asString(body?.endpoint)
    const deviceId = asString(body?.deviceId)

    if (!endpoint && !deviceId) {
      throw new Error('Expected subscription, endpoint, or deviceId.')
    }

    const before = state.subscriptions.length
    state.subscriptions = state.subscriptions.filter((entry) => {
      if (endpoint && entry.endpoint === endpoint) return false
      if (deviceId && entry.deviceId === deviceId) return false
      return true
    })

    this.state = state
    if (state.subscriptions.length !== before) {
      await this.persistState(state)
    }

    return {
      removed: state.subscriptions.length !== before,
      total: state.subscriptions.length,
    }
  }

  async sendTest(payload: unknown): Promise<NotificationDeliveryResult> {
    const state = await this.ensureState()
    const body = asRecord(payload)
    const subscription = normalizePushSubscription(body?.subscription)
    if (!subscription) {
      throw new Error('Expected a valid push subscription.')
    }

    const result = await sendWebPushRequest(state, subscription, JSON.stringify({
      title: 'Codex test notification',
      body: 'Web Push is configured correctly for this device.',
      icon: TASK_NOTIFICATION_ICON,
      badge: TASK_NOTIFICATION_ICON,
      tag: `codex-test-${Date.now().toString(36)}`,
      data: {
        url: '/#/',
        kind: 'test',
      },
    }))

    if (!result.ok) {
      throw new Error(result.body || `Push endpoint rejected the test notification with HTTP ${String(result.status)}.`)
    }

    return result
  }

  async handleNotification(notification: { method: string; params: unknown }): Promise<void> {
    this.rememberThreadContext(notification)
    if (notification.method !== 'turn/completed') return

    const state = await this.ensureState()
    if (state.subscriptions.length === 0) return

    const params = asRecord(notification.params)
    const threadId = asString(params?.threadId)
    const turn = asRecord(params?.turn)
    const turnId = asString(turn?.id)
    const status = asString(turn?.status)
    const errorMessage = asString(asRecord(turn?.error)?.message)

    const threadLabel = this.formatThreadLabel(threadId)
    const title = status === 'failed' ? 'Codex task failed' : 'Codex task completed'
    const body = status === 'failed'
      ? truncateText(`${threadLabel}: ${errorMessage || 'The task finished with an error.'}`, MAX_NOTIFICATION_BODY_LENGTH)
      : truncateText(`${threadLabel} is ready.`, MAX_NOTIFICATION_BODY_LENGTH)
    const payload = JSON.stringify({
      title,
      body,
      icon: TASK_NOTIFICATION_ICON,
      badge: TASK_NOTIFICATION_ICON,
      tag: turnId ? `codex-turn-${turnId}` : `codex-thread-${threadId}`,
      renotify: status === 'failed',
      data: {
        kind: 'turn-completed',
        threadId,
        turnId,
        url: threadId ? `/#/thread/${encodeURIComponent(threadId)}` : '/#/',
      },
    })

    const staleEndpoints = new Set<string>()
    await Promise.all(state.subscriptions.map(async (subscription) => {
      try {
        const result = await sendWebPushRequest(state, subscription, payload)
        if (!result.ok && (result.status === 404 || result.status === 410)) {
          staleEndpoints.add(subscription.endpoint)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn('[web-push]', 'Notification delivery failed', {
          endpoint: subscription.endpoint,
          threadId,
          turnId,
          error: message,
        })
      }
    }))

    if (staleEndpoints.size === 0) return

    state.subscriptions = state.subscriptions.filter((entry) => !staleEndpoints.has(entry.endpoint))
    this.state = state
    await this.persistState(state)
  }

  dispose(): void {
    this.threadContextById.clear()
  }
}
