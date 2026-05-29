import { computed, onUnmounted, ref, watch, type ComputedRef, type Ref } from 'vue'
import {
  getBrowserAnnotationListenStatus,
  startBrowserAnnotationListenSession,
  stopBrowserAnnotationListenSession,
  type BrowserAnnotationListenSession,
} from '../api/codexGateway'
import { useUiLanguage } from './useUiLanguage'

type BusyPhase = 'idle' | 'starting' | 'stopping' | 'checking'
type CopiedField = 'url' | 'token' | ''
type ListenerRef<T> = Ref<T> | ComputedRef<T>

export type BrowserAnnotationListenerController = {
  session: Ref<BrowserAnnotationListenSession | null>
  pairingToken: Ref<string>
  phase: Ref<BusyPhase>
  errorMessage: Ref<string>
  copiedField: Ref<CopiedField>
  detailsOpen: Ref<boolean>
  isBusy: ComputedRef<boolean>
  isActive: ComputedRef<boolean>
  targetThreadTitle: ComputedRef<string>
  listenerUrl: ComputedRef<string>
  expiresLabel: ComputedRef<string>
  lastBatchLabel: ComputedRef<string>
  lastBatchContextLabel: ComputedRef<string>
  statusText: ComputedRef<string>
  buttonTitle: ComputedRef<string>
  settingsStatusLabel: ComputedRef<string>
  start: () => Promise<void>
  stop: () => Promise<void>
  toggle: () => Promise<void>
  refreshStatus: () => Promise<void>
  copyText: (value: string, field: CopiedField) => Promise<void>
  clearActiveSession: () => void
}

export function useBrowserAnnotationListener(
  threadId: ListenerRef<string>,
  threadTitle: ListenerRef<string>,
): BrowserAnnotationListenerController {
  const { t } = useUiLanguage()
  const session = ref<BrowserAnnotationListenSession | null>(null)
  const pairingToken = ref('')
  const phase = ref<BusyPhase>('idle')
  const errorMessage = ref('')
  const copiedField = ref<CopiedField>('')
  const detailsOpen = ref(false)
  let statusInterval: number | null = null
  let copyResetTimeout: number | null = null
  let sessionGeneration = 0

  const currentThreadId = computed(() => threadId.value.trim())
  const isBusy = computed(() => phase.value !== 'idle')
  const isActive = computed(() => session.value?.status === 'active' && pairingToken.value.length > 0)
  const targetThreadTitle = computed(() => threadTitle.value.trim() || currentThreadId.value)
  const listenerUrl = computed(() => {
    const current = session.value
    if (!current) return ''
    const path = current.serverPath || '/codex-api/extension/listen'
    if (!current.serverUrl) return path
    return `${current.serverUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`
  })
  const expiresLabel = computed(() => formatDateTime(session.value?.expiresAtIso ?? ''))
  const lastBatchLabel = computed(() => {
    const batch = session.value?.lastReceivedBatch
    if (!batch) return ''
    const receivedAt = formatDateTime(batch.receivedAtIso)
    const count = countLabel(batch.annotationCount, t('annotation'), t('annotations'))
    return receivedAt ? `${count} at ${receivedAt}` : count
  })
  const lastBatchContextLabel = computed(() => {
    const batch = session.value?.lastReceivedBatch
    if (!batch) return ''
    return [
      countLabel(batch.imageCount, t('image'), t('images')),
      countLabel(batch.consoleCount, t('console row'), t('console rows')),
      countLabel(batch.networkCount, t('network request'), t('network requests')),
    ].join(' · ')
  })
  const statusText = computed(() => {
    if (!currentThreadId.value) return t('Choose a thread to receive browser annotations.')
    if (phase.value === 'starting') return t('Creating a short-lived extension pairing session.')
    if (phase.value === 'stopping') return t('Revoking the active browser listener.')
    if (phase.value === 'checking') return t('Checking listener status.')
    if (isActive.value) return t('Active for the selected thread.')
    if (session.value?.status === 'revoked') return t('Listener stopped.')
    if (session.value?.status === 'expired') return t('Listener expired.')
    return t('Create a temporary token for the browser extension.')
  })
  const buttonTitle = computed(() => {
    if (!currentThreadId.value) return t('Choose a thread before listening for browser annotations.')
    if (phase.value === 'starting') return t('Starting browser annotation listener')
    if (phase.value === 'stopping') return t('Stopping browser annotation listener')
    if (phase.value === 'checking') return t('Checking browser annotation listener')
    if (isActive.value) return t('Stop browser annotation listener')
    return t('Listen for browser annotations')
  })
  const settingsStatusLabel = computed(() => {
    if (!currentThreadId.value) return t('No thread')
    if (phase.value !== 'idle') return t('Busy')
    if (isActive.value) return t('Active')
    if (session.value?.status === 'expired') return t('Expired')
    if (session.value?.status === 'revoked') return t('Stopped')
    return t('Idle')
  })

  watch(currentThreadId, () => {
    clearActiveSession()
  })

  onUnmounted(() => {
    clearActiveSession()
    clearCopyReset()
  })

  async function start(): Promise<void> {
    const requestedThreadId = currentThreadId.value
    if (!requestedThreadId || phase.value !== 'idle') return
    const generation = sessionGeneration
    phase.value = 'starting'
    errorMessage.value = ''
    copiedField.value = ''
    stopStatusPolling()
    try {
      const nextSession = await startBrowserAnnotationListenSession(requestedThreadId)
      if (generation !== sessionGeneration || currentThreadId.value !== requestedThreadId) {
        if (nextSession.pairingToken) {
          void stopBrowserAnnotationListenSession(nextSession.pairingToken, {
            sessionId: nextSession.sessionId,
            threadId: nextSession.threadId,
          }).catch(() => undefined)
        }
        return
      }
      if (!nextSession.pairingToken) {
        throw new Error(t('Listener started without a pairing token.'))
      }
      session.value = nextSession
      pairingToken.value = nextSession.pairingToken
      detailsOpen.value = false
      startStatusPolling()
    } catch (error) {
      if (generation !== sessionGeneration || currentThreadId.value !== requestedThreadId) return
      clearActiveSession()
      errorMessage.value = error instanceof Error ? error.message : t('Failed to start browser annotation listener.')
    } finally {
      if (generation === sessionGeneration && currentThreadId.value === requestedThreadId) {
        phase.value = 'idle'
      }
    }
  }

  async function stop(): Promise<void> {
    const currentToken = pairingToken.value
    const currentSession = session.value
    if (!currentToken || !currentSession || phase.value !== 'idle') return
    const generation = sessionGeneration
    phase.value = 'stopping'
    errorMessage.value = ''
    try {
      const stoppedSession = await stopBrowserAnnotationListenSession(currentToken, {
        sessionId: currentSession.sessionId,
        threadId: currentSession.threadId,
      })
      if (generation === sessionGeneration && session.value?.sessionId === currentSession.sessionId) {
        session.value = stoppedSession
      }
    } catch (error) {
      if (generation === sessionGeneration && session.value?.sessionId === currentSession.sessionId) {
        errorMessage.value = error instanceof Error ? error.message : t('Failed to stop browser annotation listener.')
      }
    } finally {
      if (generation === sessionGeneration && session.value?.sessionId === currentSession.sessionId) {
        pairingToken.value = ''
        stopStatusPolling()
        phase.value = 'idle'
      }
    }
  }

  async function toggle(): Promise<void> {
    if (isActive.value) {
      await stop()
      return
    }
    await start()
  }

  function startStatusPolling(): void {
    stopStatusPolling()
    statusInterval = window.setInterval(() => {
      void refreshStatus()
    }, 15_000)
  }

  function stopStatusPolling(): void {
    if (statusInterval !== null) {
      window.clearInterval(statusInterval)
      statusInterval = null
    }
  }

  async function refreshStatus(): Promise<void> {
    const currentToken = pairingToken.value
    const currentSession = session.value
    if (!currentToken || !currentSession || phase.value !== 'idle') return
    const generation = sessionGeneration
    phase.value = 'checking'
    try {
      const nextSession = await getBrowserAnnotationListenStatus(currentToken, {
        sessionId: currentSession.sessionId,
        threadId: currentSession.threadId,
      })
      if (generation !== sessionGeneration || session.value?.sessionId !== currentSession.sessionId) return
      session.value = nextSession
      if (nextSession.status !== 'active') {
        pairingToken.value = ''
        stopStatusPolling()
      }
    } catch {
      if (generation !== sessionGeneration || session.value?.sessionId !== currentSession.sessionId) return
      pairingToken.value = ''
      stopStatusPolling()
      session.value = {
        ...currentSession,
        status: 'expired',
      }
    } finally {
      if (generation === sessionGeneration && session.value?.sessionId === currentSession.sessionId) {
        phase.value = 'idle'
      }
    }
  }

  async function copyText(value: string, field: CopiedField): Promise<void> {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      copiedField.value = field
      clearCopyReset()
      copyResetTimeout = window.setTimeout(() => {
        copiedField.value = ''
        copyResetTimeout = null
      }, 1500)
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : t('Copy failed.')
    }
  }

  function clearActiveSession(): void {
    sessionGeneration += 1
    session.value = null
    pairingToken.value = ''
    errorMessage.value = ''
    copiedField.value = ''
    detailsOpen.value = false
    phase.value = 'idle'
    stopStatusPolling()
  }

  function clearCopyReset(): void {
    if (copyResetTimeout !== null) {
      window.clearTimeout(copyResetTimeout)
      copyResetTimeout = null
    }
  }

  return {
    session,
    pairingToken,
    phase,
    errorMessage,
    copiedField,
    detailsOpen,
    isBusy,
    isActive,
    targetThreadTitle,
    listenerUrl,
    expiresLabel,
    lastBatchLabel,
    lastBatchContextLabel,
    statusText,
    buttonTitle,
    settingsStatusLabel,
    start,
    stop,
    toggle,
    refreshStatus,
    copyText,
    clearActiveSession,
  }
}

function formatDateTime(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}
