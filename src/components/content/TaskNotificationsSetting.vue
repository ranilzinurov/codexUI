<template>
  <div class="task-notification-setting">
    <div class="task-notification-summary">
      <span class="task-notification-label">Task notifications</span>
      <span class="task-notification-badge" :data-state="badgeState">{{ badgeText }}</span>
    </div>

    <p class="task-notification-help">{{ helpText }}</p>
    <p v-if="statusMessage" class="task-notification-info">{{ statusMessage }}</p>
    <p v-if="error" class="task-notification-error">{{ error }}</p>

    <div class="task-notification-actions">
      <button
        v-if="showEnableButton"
        class="task-notification-action is-primary"
        type="button"
        :disabled="isBusy"
        @click="enableNotifications"
      >
        {{ isBusy ? 'Working…' : 'Enable' }}
      </button>
      <button
        v-if="showDisableButton"
        class="task-notification-action"
        type="button"
        :disabled="isBusy"
        @click="disableNotifications"
      >
        Disable
      </button>
      <button
        v-if="showTestButton"
        class="task-notification-action"
        type="button"
        :disabled="isBusy"
        @click="sendTestNotification"
      >
        Send test
      </button>
      <button
        class="task-notification-action"
        type="button"
        :disabled="isBusy"
        @click="refreshState"
      >
        Refresh
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  fetchTaskNotificationStatus,
  sendTaskNotificationTest,
  subscribeTaskNotifications,
  unsubscribeTaskNotifications,
  type SerializablePushSubscription,
  type TaskNotificationStatus,
} from '../../api/taskNotifications'
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from '../../browserCompat'

const DEVICE_ID_STORAGE_KEY = 'codex.taskNotificationDeviceId'

const serverStatus = ref<TaskNotificationStatus | null>(null)
const permission = ref<NotificationPermission>('default')
const subscription = ref<SerializablePushSubscription | null>(null)
const isBusy = ref(false)
const error = ref('')
const statusMessage = ref('')
const isStandalone = ref(false)
const isAppleMobile = ref(false)
const isPushCapable = ref(false)

let mediaQueryList: MediaQueryList | null = null

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || navigatorWithStandalone.standalone === true
}

function refreshEnvironmentFlags(): void {
  if (typeof window === 'undefined') return
  permission.value = typeof Notification !== 'undefined' ? Notification.permission : 'default'
  isStandalone.value = detectStandalone()
  isAppleMobile.value = /iphone|ipad|ipod/iu.test(navigator.userAgent)
  isPushCapable.value = window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

function getDeviceId(): string {
  const existing = safeLocalStorageGetItem(DEVICE_ID_STORAGE_KEY)?.trim() ?? ''
  if (existing) return existing
  const nextId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  safeLocalStorageSetItem(DEVICE_ID_STORAGE_KEY, nextId)
  return nextId
}

function decodeBase64Url(value: string): ArrayBuffer {
  const normalized = value.replace(/-/gu, '+').replace(/_/gu, '/')
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  const decoded = window.atob(normalized + padding)
  const buffer = new ArrayBuffer(decoded.length)
  const bytes = new Uint8Array(buffer)
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index)
  }
  return buffer
}

function toSerializablePushSubscription(value: PushSubscription): SerializablePushSubscription {
  const json = value.toJSON()
  const endpoint = typeof json.endpoint === 'string' ? json.endpoint : ''
  const keys = json.keys ?? {}
  if (!endpoint || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') {
    throw new Error('Browser returned an incomplete push subscription.')
  }

  return {
    endpoint,
    expirationTime: typeof json.expirationTime === 'number' ? json.expirationTime : null,
    keys: {
      p256dh: keys.p256dh,
      auth: keys.auth,
    },
  }
}

async function ensureServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service workers are unavailable in this browser.')
  }

  const existing = await navigator.serviceWorker.getRegistration('/')
  if (existing) return existing

  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  await navigator.serviceWorker.ready
  return registration
}

async function readActiveSubscription(): Promise<SerializablePushSubscription | null> {
  if (!isPushCapable.value) return null
  const registration = await ensureServiceWorkerRegistration()
  const active = await registration.pushManager.getSubscription()
  return active ? toSerializablePushSubscription(active) : null
}

async function refreshState(): Promise<void> {
  refreshEnvironmentFlags()
  error.value = ''

  if (!isPushCapable.value) {
    subscription.value = null
    return
  }

  serverStatus.value = await fetchTaskNotificationStatus()
  subscription.value = await readActiveSubscription()
}

async function runAction(action: () => Promise<void>): Promise<void> {
  if (isBusy.value) return
  isBusy.value = true
  error.value = ''
  statusMessage.value = ''

  try {
    await action()
  } catch (actionError) {
    error.value = actionError instanceof Error ? actionError.message : 'Notification action failed.'
  } finally {
    isBusy.value = false
    try {
      await refreshState()
    } catch (refreshError) {
      if (!error.value) {
        error.value = refreshError instanceof Error ? refreshError.message : 'Failed to refresh notification state.'
      }
    }
  }
}

async function enableNotifications(): Promise<void> {
  await runAction(async () => {
    refreshEnvironmentFlags()
    if (!isPushCapable.value) {
      throw new Error('This browser cannot create web push subscriptions for the current page.')
    }
    if (isAppleMobile.value && !isStandalone.value) {
      throw new Error('On iPhone, install the app to the Home Screen first. Safari tabs cannot receive push notifications.')
    }

    const status = serverStatus.value ?? await fetchTaskNotificationStatus()
    let nextPermission = permission.value
    if (nextPermission !== 'granted') {
      nextPermission = await Notification.requestPermission()
      permission.value = nextPermission
    }
    if (nextPermission !== 'granted') {
      throw new Error(nextPermission === 'denied'
        ? 'Notifications are blocked for this site. Re-enable them in browser settings and try again.'
        : 'Notification permission was not granted.')
    }

    const registration = await ensureServiceWorkerRegistration()
    const current = await registration.pushManager.getSubscription()
    const active = current ?? await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeBase64Url(status.vapidPublicKey),
    })
    const serialized = toSerializablePushSubscription(active)

    await subscribeTaskNotifications({
      subscription: serialized,
      deviceId: getDeviceId(),
      userAgent: navigator.userAgent,
      locale: navigator.language || '',
    })

    subscription.value = serialized
    statusMessage.value = 'Task completion notifications are enabled for this device.'
  })
}

async function disableNotifications(): Promise<void> {
  await runAction(async () => {
    const registration = isPushCapable.value ? await ensureServiceWorkerRegistration() : null
    const active = registration ? await registration.pushManager.getSubscription() : null
    const serialized = active ? toSerializablePushSubscription(active) : subscription.value

    await unsubscribeTaskNotifications({
      subscription: serialized ?? undefined,
      endpoint: serialized?.endpoint,
      deviceId: getDeviceId(),
    })

    if (active) {
      await active.unsubscribe()
    }

    subscription.value = null
    statusMessage.value = 'Task completion notifications are disabled for this device.'
  })
}

async function sendTestNotification(): Promise<void> {
  await runAction(async () => {
    const current = subscription.value ?? await readActiveSubscription()
    if (!current) {
      throw new Error('Enable task notifications before sending a test push.')
    }

    await sendTaskNotificationTest({ subscription: current })
    statusMessage.value = 'Test notification sent. Check this device for the push alert.'
  })
}

const badgeText = computed(() => {
  if (subscription.value) return 'On'
  if (!isPushCapable.value && isAppleMobile.value && !isStandalone.value) return 'Install PWA'
  if (!isPushCapable.value) return 'Unsupported'
  if (permission.value === 'denied') return 'Blocked'
  return 'Off'
})

const badgeState = computed(() => {
  if (subscription.value) return 'ok'
  if (permission.value === 'denied') return 'danger'
  if (!isPushCapable.value) return 'warning'
  return 'idle'
})

const helpText = computed(() => {
  if (isAppleMobile.value && !isStandalone.value) {
    return 'Install Codex Web to the iPhone Home Screen first. Safari tabs cannot receive background push notifications.'
  }
  if (!isPushCapable.value) {
    return 'This browser does not expose the Push API for the current page. Web push requires HTTPS and service worker support.'
  }
  if (permission.value === 'denied') {
    return 'Notifications are blocked for this origin. Re-enable them in browser settings, then refresh here.'
  }
  if (subscription.value) {
    return 'Codex will send a push notification when a task finishes, even if the PWA is in the background.'
  }
  return 'Enable web push to receive a notification on this device when Codex finishes a task.'
})

const showEnableButton = computed(() => isPushCapable.value && permission.value !== 'denied' && !subscription.value)
const showDisableButton = computed(() => Boolean(subscription.value))
const showTestButton = computed(() => Boolean(subscription.value))

function handleVisibilityChange(): void {
  if (document.visibilityState !== 'visible') return
  void refreshState().catch((refreshError) => {
    error.value = refreshError instanceof Error ? refreshError.message : 'Failed to refresh notification state.'
  })
}

function handleDisplayModeChange(): void {
  void refreshState().catch((refreshError) => {
    error.value = refreshError instanceof Error ? refreshError.message : 'Failed to refresh notification state.'
  })
}

onMounted(() => {
  refreshEnvironmentFlags()
  mediaQueryList = window.matchMedia('(display-mode: standalone)')
  if (typeof mediaQueryList.addEventListener === 'function') {
    mediaQueryList.addEventListener('change', handleDisplayModeChange)
  } else if (typeof mediaQueryList.addListener === 'function') {
    mediaQueryList.addListener(handleDisplayModeChange)
  }
  document.addEventListener('visibilitychange', handleVisibilityChange)
  void refreshState().catch((refreshError) => {
    error.value = refreshError instanceof Error ? refreshError.message : 'Failed to refresh notification state.'
  })
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  if (!mediaQueryList) return
  if (typeof mediaQueryList.removeEventListener === 'function') {
    mediaQueryList.removeEventListener('change', handleDisplayModeChange)
    return
  }
  if (typeof mediaQueryList.removeListener === 'function') {
    mediaQueryList.removeListener(handleDisplayModeChange)
  }
})
</script>

<style scoped>
@reference "tailwindcss";

.task-notification-setting {
  @apply flex flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2;
}

.task-notification-summary {
  @apply flex items-center justify-between gap-3;
}

.task-notification-label {
  @apply text-sm text-zinc-900;
}

.task-notification-badge {
  @apply rounded px-2 py-0.5 text-[11px] font-medium;
}

.task-notification-badge[data-state='ok'] {
  @apply bg-emerald-100 text-emerald-700;
}

.task-notification-badge[data-state='warning'] {
  @apply bg-amber-100 text-amber-700;
}

.task-notification-badge[data-state='danger'] {
  @apply bg-rose-100 text-rose-700;
}

.task-notification-badge[data-state='idle'] {
  @apply bg-zinc-200 text-zinc-700;
}

.task-notification-help {
  @apply text-xs leading-5 text-zinc-600;
}

.task-notification-info {
  @apply rounded-lg bg-emerald-50 px-2 py-1 text-xs text-emerald-700;
}

.task-notification-error {
  @apply rounded-lg bg-rose-50 px-2 py-1 text-xs text-rose-700;
}

.task-notification-actions {
  @apply flex flex-wrap gap-2;
}

.task-notification-action {
  @apply rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-default disabled:opacity-50;
}

.task-notification-action.is-primary {
  @apply border-zinc-900 bg-zinc-900 text-white hover:bg-zinc-800;
}

:root.dark .task-notification-setting {
  @apply border-zinc-700 bg-zinc-900;
}

:root.dark .task-notification-label {
  @apply text-zinc-100;
}

:root.dark .task-notification-badge[data-state='idle'] {
  @apply bg-zinc-700 text-zinc-200;
}

:root.dark .task-notification-help {
  @apply text-zinc-400;
}

:root.dark .task-notification-action {
  @apply border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700;
}

:root.dark .task-notification-action.is-primary {
  @apply border-zinc-100 bg-zinc-100 text-zinc-900 hover:bg-zinc-200;
}
</style>
