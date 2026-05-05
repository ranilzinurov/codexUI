import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'

const require = createRequire(import.meta.url)

const webPush = require('web-push') as {
  generateVAPIDKeys: () => { publicKey: string; privateKey: string }
  sendNotification: (
    subscription: unknown,
    payload?: string,
    options?: {
      TTL?: number
      urgency?: 'very-low' | 'low' | 'normal' | 'high'
      contentEncoding?: 'aes128gcm' | 'aesgcm'
      vapidDetails?: {
        subject: string
        publicKey: string
        privateKey: string
      }
    },
  ) => Promise<{ statusCode?: number; body?: string }>
}

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
  x: string
  y: string
  d?: string
}

type WebPushState = {
  version: 2
  vapid: {
    subject: string
    publicKey: string
    privateKey: string
  }
  subscriptions: StoredPushSubscription[]
}

type ThreadNotificationContext = {
  title: string
}

type AppServerReader = {
  rpc: (method: string, params: unknown) => Promise<unknown>
}

type NotificationDeliveryResult = {
  ok: boolean
  status: number
  body: string
}

type BrowserClientState = {
  clientId: string
  threadId: string
  active: boolean
  visible: boolean
  focused: boolean
  userAgent: string
  updatedAtMs: number
}

type NormalizedStateResult = {
  state: WebPushState
  didMutate: boolean
}

const WEB_PUSH_STATE_VERSION = 2
const WEB_PUSH_TTL_SECONDS = 60
const ACTIVE_BROWSER_CLIENT_TTL_MS = 45_000
const DEFAULT_VAPID_SUBJECT = 'mailto:codexui@example.com'
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

function normalizeVapidSubject(value: string): string {
  const fromEnv = process.env.CODEXUI_VAPID_SUBJECT?.trim() ?? ''
  if (fromEnv) return fromEnv

  const normalized = value.trim()
  if (!normalized) return DEFAULT_VAPID_SUBJECT
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/iu.test(normalized)) {
    return DEFAULT_VAPID_SUBJECT
  }
  if (/^mailto:[^@]+@localhost$/iu.test(normalized)) {
    return DEFAULT_VAPID_SUBJECT
  }
  return normalized
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

function publicKeyFromJwk(jwk: EcKeyJwk): string {
  const x = asString(jwk.x)
  const y = asString(jwk.y)
  if (!x || !y) return ''
  return base64UrlEncode(Buffer.concat([
    Buffer.from([0x04]),
    base64UrlDecode(x),
    base64UrlDecode(y),
  ]))
}

function privateKeyFromJwk(jwk: EcKeyJwk): string {
  const d = asString(jwk.d)
  return d ? base64UrlEncode(base64UrlDecode(d)) : ''
}

function createInitialState(): WebPushState {
  const vapidKeys = webPush.generateVAPIDKeys()
  return {
    version: WEB_PUSH_STATE_VERSION,
    vapid: {
      subject: normalizeVapidSubject(''),
      publicKey: vapidKeys.publicKey,
      privateKey: vapidKeys.privateKey,
    },
    subscriptions: [],
  }
}

function normalizeStoredState(value: unknown): NormalizedStateResult | null {
  const record = asRecord(value)
  if (!record) return null

  const vapid = asRecord(record.vapid)
  if (!vapid) return null

  const originalSubject = asString(vapid.subject)
  const subject = normalizeVapidSubject(originalSubject)

  let publicKey = asString(vapid.publicKey)
  let privateKey = asString(vapid.privateKey)
  let didMutate = record.version !== WEB_PUSH_STATE_VERSION || subject !== originalSubject

  if (!publicKey || !privateKey) {
    const publicJwk = asRecord(vapid.publicJwk) as EcKeyJwk | null
    const privateJwk = asRecord(vapid.privateJwk) as EcKeyJwk | null
    publicKey = publicKey || (publicJwk ? publicKeyFromJwk(publicJwk) : '')
    privateKey = privateKey || (privateJwk ? privateKeyFromJwk(privateJwk) : '')
    if (publicKey && privateKey) {
      didMutate = true
    }
  }

  if (!publicKey || !privateKey) {
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
    state: {
      version: WEB_PUSH_STATE_VERSION,
      vapid: {
        subject,
        publicKey,
        privateKey,
      },
      subscriptions,
    },
    didMutate,
  }
}

async function sendWebPushRequest(
  state: WebPushState,
  subscription: PushSubscriptionData,
  payload: string,
): Promise<NotificationDeliveryResult> {
  try {
    const response = await webPush.sendNotification(subscription, payload, {
      TTL: WEB_PUSH_TTL_SECONDS,
      urgency: 'high',
      contentEncoding: 'aes128gcm',
      vapidDetails: {
        subject: state.vapid.subject,
        publicKey: state.vapid.publicKey,
        privateKey: state.vapid.privateKey,
      },
    })

    return {
      ok: true,
      status: typeof response.statusCode === 'number' ? response.statusCode : 201,
      body: truncateText(typeof response.body === 'string' ? response.body : '', 600),
    }
  } catch (error) {
    const failed = error as { statusCode?: number; body?: string }
    const body = typeof failed.body === 'string'
      ? failed.body
      : error instanceof Error
        ? error.message
        : String(error)
    return {
      ok: false,
      status: typeof failed.statusCode === 'number' ? failed.statusCode : 0,
      body: truncateText(body, 600),
    }
  }
}

export class WebPushNotifications {
  private state: WebPushState | null = null
  private loadPromise: Promise<WebPushState> | null = null
  private writePromise: Promise<void> = Promise.resolve()
  private readonly threadContextById = new Map<string, ThreadNotificationContext>()
  private readonly browserClientStateById = new Map<string, BrowserClientState>()

  constructor(private readonly appServer: AppServerReader | null = null) {}

  private async ensureState(): Promise<WebPushState> {
    if (this.state) return this.state
    if (this.loadPromise) return this.loadPromise

    this.loadPromise = (async () => {
      const statePath = getWebPushStatePath()
      try {
        const raw = await readFile(statePath, 'utf8')
        const normalized = normalizeStoredState(JSON.parse(raw) as unknown)
        if (normalized) {
          this.state = normalized.state
          if (normalized.didMutate) {
            await this.persistState(normalized.state)
          }
          return normalized.state
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

  private rememberThreadTitle(threadId: string, title: string): void {
    if (!threadId || !title) return
    this.threadContextById.set(threadId, { title })
  }

  private pickThreadTitle(thread: JsonRecord | null): string {
    const direct = [
      thread?.name,
      thread?.title,
      thread?.preview,
    ]
    for (const candidate of direct) {
      const title = asString(candidate)
      if (title) return title
    }
    return ''
  }

  private rememberThreadContext(notification: { method: string; params: unknown }): void {
    const params = asRecord(notification.params)

    if (notification.method === 'thread/name/updated') {
      const threadId = asString(params?.threadId)
      const title = asString(params?.threadName)
      this.rememberThreadTitle(threadId, title)
      return
    }

    const thread = asRecord(params?.thread)
    const threadId = asString(thread?.id) || asString(params?.threadId)
    const title = this.pickThreadTitle(thread)
    this.rememberThreadTitle(threadId, title)
  }

  private formatThreadLabel(threadId: string): string {
    const knownTitle = this.threadContextById.get(threadId)?.title.trim() ?? ''
    if (knownTitle) return knownTitle
    return threadId ? `Thread ${threadId.slice(0, 8)}` : 'Current thread'
  }

  private async resolveThreadLabel(threadId: string): Promise<string> {
    const knownTitle = this.threadContextById.get(threadId)?.title.trim() ?? ''
    if (knownTitle) return knownTitle

    if (threadId && this.appServer) {
      try {
        const response = asRecord(await this.appServer.rpc('thread/read', { threadId, includeTurns: false }))
        const thread = asRecord(response?.thread)
        const title = this.pickThreadTitle(thread)
        this.rememberThreadTitle(threadId, title)
        if (title) return title
      } catch {
        // Keep notification delivery best-effort if the thread cannot be read.
      }
    }

    return this.formatThreadLabel(threadId)
  }

  private pruneInactiveBrowserClients(nowMs = Date.now()): void {
    for (const [clientId, state] of this.browserClientStateById) {
      if (nowMs - state.updatedAtMs > ACTIVE_BROWSER_CLIENT_TTL_MS) {
        this.browserClientStateById.delete(clientId)
      }
    }
  }

  private hasActiveBrowserClientForThread(threadId: string): boolean {
    this.pruneInactiveBrowserClients()
    if (!threadId) return false

    for (const state of this.browserClientStateById.values()) {
      if (!state.active || !state.visible || !state.focused) continue
      if (state.threadId === threadId) return true
    }

    return false
  }

  private activeBrowserClientCount(): number {
    this.pruneInactiveBrowserClients()
    let count = 0
    for (const state of this.browserClientStateById.values()) {
      if (state.active && state.visible && state.focused) count += 1
    }
    return count
  }

  async getStatus(): Promise<{
    supported: true
    vapidPublicKey: string
    subject: string
    subscriptionCount: number
    activeBrowserClientCount: number
  }> {
    const state = await this.ensureState()
    return {
      supported: true,
      vapidPublicKey: state.vapid.publicKey,
      subject: state.vapid.subject,
      subscriptionCount: state.subscriptions.length,
      activeBrowserClientCount: this.activeBrowserClientCount(),
    }
  }

  updateClientState(payload: unknown, userAgent = ''): { activeBrowserClientCount: number } {
    const body = asRecord(payload)
    const clientId = asString(body?.clientId)
    if (!clientId) {
      throw new Error('Expected clientId.')
    }

    const visible = body?.visible === true
    const focused = body?.focused === true
    const active = body?.active === true && visible && focused
    const threadId = asString(body?.threadId)

    this.pruneInactiveBrowserClients()
    this.browserClientStateById.set(clientId, {
      clientId,
      threadId,
      active,
      visible,
      focused,
      userAgent,
      updatedAtMs: Date.now(),
    })

    return {
      activeBrowserClientCount: this.activeBrowserClientCount(),
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
    if (this.hasActiveBrowserClientForThread(threadId)) {
      return
    }

    const turn = asRecord(params?.turn)
    const turnId = asString(turn?.id)
    const status = asString(turn?.status)
    const errorMessage = asString(asRecord(turn?.error)?.message)

    const threadLabel = await this.resolveThreadLabel(threadId)
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
      const result = await sendWebPushRequest(state, subscription, payload)
      if (!result.ok) {
        if (result.status === 404 || result.status === 410) {
          staleEndpoints.add(subscription.endpoint)
        }
        console.warn('[web-push]', 'Notification delivery failed', {
          endpoint: subscription.endpoint,
          threadId,
          turnId,
          status: result.status,
          error: result.body,
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
    this.browserClientStateById.clear()
  }
}
