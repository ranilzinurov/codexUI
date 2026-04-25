import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue'
import { updateTaskNotificationClientState } from '../api/taskNotifications'
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from '../browserCompat'

const CLIENT_ID_STORAGE_KEY = 'codex.taskNotificationBrowserClientId'
const HEARTBEAT_INTERVAL_MS = 20_000

function getBrowserClientId(): string {
  const existing = safeLocalStorageGetItem(CLIENT_ID_STORAGE_KEY)?.trim() ?? ''
  if (existing) return existing

  const nextId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  safeLocalStorageSetItem(CLIENT_ID_STORAGE_KEY, nextId)
  return nextId
}

function canReadBrowserState(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

export function useTaskNotificationClientPresence(selectedThreadId: Ref<string>): void {
  if (!canReadBrowserState()) return

  const clientId = getBrowserClientId()
  let heartbeatTimer: number | null = null

  function buildPayload(forceInactive = false) {
    const visible = document.visibilityState === 'visible'
    const focused = document.hasFocus()
    const active = !forceInactive && visible && focused

    return {
      clientId,
      threadId: selectedThreadId.value.trim() || null,
      active,
      visible: forceInactive ? false : visible,
      focused: forceInactive ? false : focused,
    }
  }

  function sendState(forceInactive = false): void {
    void updateTaskNotificationClientState(buildPayload(forceInactive)).catch(() => {
      // Presence is best-effort; stale active clients expire server-side.
    })
  }

  function sendStateBeacon(): void {
    const body = JSON.stringify(buildPayload(true))
    if (typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' })
      if (navigator.sendBeacon('/codex-api/push/client-state', blob)) return
    }

    void fetch('/codex-api/push/client-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      // Page is unloading.
    })
  }

  function handleActiveStateChange(): void {
    sendState()
  }

  onMounted(() => {
    sendState()
    heartbeatTimer = window.setInterval(() => sendState(), HEARTBEAT_INTERVAL_MS)
    document.addEventListener('visibilitychange', handleActiveStateChange)
    window.addEventListener('focus', handleActiveStateChange)
    window.addEventListener('blur', handleActiveStateChange)
    window.addEventListener('pageshow', handleActiveStateChange)
    window.addEventListener('pagehide', sendStateBeacon)
  })

  onBeforeUnmount(() => {
    if (heartbeatTimer !== null) {
      window.clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
    sendState(true)
    document.removeEventListener('visibilitychange', handleActiveStateChange)
    window.removeEventListener('focus', handleActiveStateChange)
    window.removeEventListener('blur', handleActiveStateChange)
    window.removeEventListener('pageshow', handleActiveStateChange)
    window.removeEventListener('pagehide', sendStateBeacon)
  })

  watch(
    () => selectedThreadId.value,
    () => sendState(),
  )
}
