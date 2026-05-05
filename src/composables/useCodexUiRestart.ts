import { computed, ref } from 'vue'
import { getRestartStatus, scheduleRestart, type RestartStatus } from '../api/codexGateway'

const RESTART_POLL_INTERVAL_MS = 1_500
const RESTART_POLL_TIMEOUT_MS = 300_000
const DEFAULT_RESTART_LOG_PATH = '/tmp/codexui-restart.log'

export function useCodexUiRestart() {
  const restartStatus = ref<RestartStatus | null>(null)
  const isRestartScheduling = ref(false)
  const isRestartOverlayVisible = ref(false)
  const restartOverlayStage = ref<RestartStatus['stage']>('idle')
  const restartOverlayMessage = ref('')
  const restartOverlayError = ref('')
  const restartOverlayNetworkWarning = ref('')
  let restartPollTimer: number | null = null
  let restartPollStartedAtMs = 0

  const isRestartAvailable = computed(() => restartStatus.value?.available === true)
  const restartButtonLabel = computed(() => (isRestartScheduling.value ? 'Scheduling...' : 'Restart'))
  const restartOverlayTitle = computed(() => {
    switch (restartOverlayStage.value) {
      case 'building':
        return 'Building Codex UI'
      case 'restarting':
        return 'Restarting Codex UI'
      case 'waiting':
        return 'Waiting for service'
      case 'complete':
        return 'Restart complete'
      case 'failed':
        return 'Restart failed'
      case 'scheduled':
        return 'Restart scheduled'
      default:
        return 'Restarting Codex UI'
    }
  })

  async function loadRestartStatus(): Promise<void> {
    try {
      restartStatus.value = await getRestartStatus()
    } catch {
      restartStatus.value = null
    }
  }

  function clearRestartPollTimer(): void {
    if (restartPollTimer === null) return
    window.clearInterval(restartPollTimer)
    restartPollTimer = null
  }

  function updateRestartOverlayFromStatus(status: RestartStatus): void {
    restartStatus.value = status
    restartOverlayStage.value = status.stage
    restartOverlayMessage.value = status.message || 'Restart is in progress.'
    if (status.stage !== 'failed') {
      restartOverlayError.value = ''
    }
  }

  function startRestartPolling(): void {
    clearRestartPollTimer()
    restartPollStartedAtMs = Date.now()
    restartPollTimer = window.setInterval(() => {
      void pollRestartStatus()
    }, RESTART_POLL_INTERVAL_MS)
    void pollRestartStatus()
  }

  async function pollRestartStatus(): Promise<void> {
    if (!isRestartOverlayVisible.value) {
      clearRestartPollTimer()
      return
    }

    if (Date.now() - restartPollStartedAtMs > RESTART_POLL_TIMEOUT_MS) {
      clearRestartPollTimer()
      restartOverlayStage.value = 'failed'
      restartOverlayMessage.value = 'Restart did not finish within the expected time.'
      restartOverlayError.value = `Check the restart log manually: ${restartStatus.value?.logPath || DEFAULT_RESTART_LOG_PATH}`
      return
    }

    try {
      const status = await getRestartStatus()
      updateRestartOverlayFromStatus(status)
      restartOverlayNetworkWarning.value = ''

      if (status.stage === 'failed' || status.failed) {
        clearRestartPollTimer()
        restartOverlayStage.value = 'failed'
        restartOverlayError.value = `Log: ${status.logPath || DEFAULT_RESTART_LOG_PATH}`
        return
      }

      if (status.stage === 'complete') {
        clearRestartPollTimer()
        window.setTimeout(() => {
          window.location.reload()
        }, 800)
      }
    } catch {
      restartOverlayNetworkWarning.value = 'Server is temporarily unavailable during restart. Waiting for it to come back...'
    }
  }

  async function restartCodexUi(): Promise<void> {
    if (isRestartScheduling.value || isRestartOverlayVisible.value) return
    const confirmed = window.confirm('Restart Codex UI now? The page will reconnect and reload after the service is healthy.')
    if (!confirmed) return

    isRestartScheduling.value = true
    restartOverlayError.value = ''
    restartOverlayNetworkWarning.value = ''
    isRestartOverlayVisible.value = true
    restartOverlayStage.value = 'scheduled'
    restartOverlayMessage.value = 'Scheduling detached rebuild and restart...'

    try {
      const status = await scheduleRestart()
      updateRestartOverlayFromStatus(status)
      startRestartPolling()
    } catch (error) {
      restartOverlayStage.value = 'failed'
      restartOverlayMessage.value = 'Could not schedule the restart.'
      restartOverlayError.value = error instanceof Error ? error.message : 'Failed to schedule restart.'
    } finally {
      isRestartScheduling.value = false
    }
  }

  function closeRestartOverlay(): void {
    clearRestartPollTimer()
    isRestartOverlayVisible.value = false
  }

  return {
    restartStatus,
    isRestartAvailable,
    isRestartScheduling,
    isRestartOverlayVisible,
    restartButtonLabel,
    restartOverlayStage,
    restartOverlayTitle,
    restartOverlayMessage,
    restartOverlayError,
    restartOverlayNetworkWarning,
    loadRestartStatus,
    restartCodexUi,
    closeRestartOverlay,
    clearRestartPollTimer,
  }
}
