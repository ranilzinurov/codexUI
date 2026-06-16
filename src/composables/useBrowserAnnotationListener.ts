import { computed, onUnmounted, ref, type ComputedRef, type Ref } from 'vue'
import {
  startBrowserAnnotationBindingPairing,
  type BrowserAnnotationBindingPairing,
} from '../api/codexGateway'
import { useUiLanguage } from './useUiLanguage'

type BusyPhase = 'idle' | 'starting' | 'stopping' | 'checking'
type CopiedField = 'url' | 'token' | ''
type ListenerRef<T> = Ref<T> | ComputedRef<T>

export type BrowserAnnotationListenerController = {
  session: Ref<BrowserAnnotationBindingPairing | null>
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
  void threadId
  void threadTitle
  const session = ref<BrowserAnnotationBindingPairing | null>(null)
  const pairingToken = ref('')
  const phase = ref<BusyPhase>('idle')
  const errorMessage = ref('')
  const copiedField = ref<CopiedField>('')
  const detailsOpen = ref(false)
  let copyResetTimeout: number | null = null
  let sessionGeneration = 0

  const isBusy = computed(() => phase.value !== 'idle')
  const isActive = computed(() => session.value?.status === 'active' && pairingToken.value.length > 0)
  const targetThreadTitle = computed(() => t('Browser binding'))
  const listenerUrl = computed(() => {
    const current = session.value
    if (!current) return ''
    return current.serverUrl || window.location.origin
  })
  const expiresLabel = computed(() => formatDateTime(session.value?.expiresAtIso ?? ''))
  const lastBatchLabel = computed(() => '')
  const lastBatchContextLabel = computed(() => '')
  const statusText = computed(() => {
    if (phase.value === 'starting') return t('Creating a browser binding code.')
    if (phase.value === 'stopping') return t('Clearing the browser binding code.')
    if (phase.value === 'checking') return t('Checking browser binding status.')
    if (isActive.value) return t('Paste this code into the browser extension settings.')
    if (session.value?.status === 'revoked') return t('Browser binding code cleared.')
    if (session.value?.status === 'expired') return t('Browser binding code expired.')
    return t('Create a browser binding code for the extension.')
  })
  const buttonTitle = computed(() => {
    if (phase.value === 'starting') return t('Creating browser binding code')
    if (phase.value === 'stopping') return t('Clearing browser binding code')
    if (phase.value === 'checking') return t('Checking browser binding')
    if (isActive.value) return t('Clear browser binding code')
    return t('Create browser binding code')
  })
  const settingsStatusLabel = computed(() => {
    if (phase.value !== 'idle') return t('Busy')
    if (isActive.value) return t('Active')
    if (session.value?.status === 'expired') return t('Expired')
    if (session.value?.status === 'revoked') return t('Stopped')
    return t('Idle')
  })

  onUnmounted(() => {
    clearActiveSession()
    clearCopyReset()
  })

  async function start(): Promise<void> {
    if (phase.value !== 'idle') return
    const generation = sessionGeneration
    phase.value = 'starting'
    errorMessage.value = ''
    copiedField.value = ''
    try {
      const nextSession = await startBrowserAnnotationBindingPairing()
      if (generation !== sessionGeneration) {
        return
      }
      if (!nextSession.pairingCode) {
        throw new Error(t('Browser binding started without a pairing code.'))
      }
      session.value = nextSession
      pairingToken.value = nextSession.pairingCode
      detailsOpen.value = true
    } catch (error) {
      if (generation !== sessionGeneration) return
      clearActiveSession()
      errorMessage.value = error instanceof Error ? error.message : t('Failed to start browser binding.')
    } finally {
      if (generation === sessionGeneration) {
        phase.value = 'idle'
      }
    }
  }

  async function stop(): Promise<void> {
    const currentSession = session.value
    if (!currentSession || phase.value !== 'idle') return
    const generation = sessionGeneration
    phase.value = 'stopping'
    errorMessage.value = ''
    try {
      if (generation === sessionGeneration && session.value?.pairingId === currentSession.pairingId) {
        clearActiveSession()
      }
    } catch (error) {
      if (generation === sessionGeneration && session.value?.pairingId === currentSession.pairingId) {
        errorMessage.value = error instanceof Error ? error.message : t('Failed to clear browser binding.')
      }
    } finally {
      if (generation === sessionGeneration) {
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

  async function refreshStatus(): Promise<void> {
    return undefined
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
