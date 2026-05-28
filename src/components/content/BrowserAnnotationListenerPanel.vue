<template>
  <section class="browser-annotation-listener" aria-label="Browser annotation listener">
    <article class="browser-annotation-listener-shell" :class="{ 'is-active': isActive }">
      <header class="browser-annotation-listener-header">
        <div class="browser-annotation-listener-heading">
          <p class="browser-annotation-listener-title">{{ t('Listen for browser annotations') }}</p>
          <p class="browser-annotation-listener-subtitle">
            {{ statusText }}
          </p>
        </div>
        <div class="browser-annotation-listener-actions">
          <button
            v-if="session"
            class="browser-annotation-listener-disclosure"
            type="button"
            :aria-expanded="detailsOpen"
            @click="detailsOpen = !detailsOpen"
          >
            {{ detailsOpen ? t('Hide setup') : t('Setup') }}
          </button>
          <button
            v-if="!isActive"
            class="browser-annotation-listener-primary"
            type="button"
            :disabled="isBusy || !threadId"
            @click="onStart"
          >
            {{ phase === 'starting' ? t('Starting...') : t('Listen') }}
          </button>
          <button
            v-else
            class="browser-annotation-listener-secondary"
            type="button"
            :disabled="isBusy"
            @click="onStop"
          >
            {{ phase === 'stopping' ? t('Stopping...') : t('Stop') }}
          </button>
        </div>
      </header>

      <p v-if="errorMessage" class="browser-annotation-listener-error" role="alert">{{ errorMessage }}</p>

      <div v-if="session" class="browser-annotation-listener-summary" aria-live="polite">
        <span class="browser-annotation-listener-chip">
          <span class="browser-annotation-listener-chip-label">{{ t('Status') }}</span>
          <span class="browser-annotation-listener-chip-value">{{ session.status }}</span>
        </span>
        <span class="browser-annotation-listener-chip" :title="targetThreadTitle">
          <span class="browser-annotation-listener-chip-label">{{ t('Thread') }}</span>
          <span class="browser-annotation-listener-chip-value">{{ targetThreadTitle }}</span>
        </span>
        <span class="browser-annotation-listener-chip" :title="session.expiresAtIso">
          <span class="browser-annotation-listener-chip-label">{{ t('Expires') }}</span>
          <span class="browser-annotation-listener-chip-value">{{ expiresLabel }}</span>
        </span>
        <span v-if="session.lastReceivedBatch" class="browser-annotation-listener-chip" :title="`${session.lastReceivedBatch.batchId} · ${lastBatchContextLabel}`">
          <span class="browser-annotation-listener-chip-label">{{ t('Last batch') }}</span>
          <span class="browser-annotation-listener-chip-value">{{ lastBatchLabel }}</span>
        </span>
      </div>

      <div v-if="session && detailsOpen" class="browser-annotation-listener-details">
        <div class="browser-annotation-listener-copy-row">
          <label class="browser-annotation-listener-copy-field">
            <span class="browser-annotation-listener-label">{{ t('Server URL') }}</span>
            <input class="browser-annotation-listener-input" type="text" :value="listenerUrl" readonly />
          </label>
          <button class="browser-annotation-listener-copy-button" type="button" @click="copyText(listenerUrl, 'url')">
            {{ copiedField === 'url' ? t('Copied') : t('Copy') }}
          </button>
        </div>
        <div v-if="isActive && pairingToken" class="browser-annotation-listener-copy-row">
          <label class="browser-annotation-listener-copy-field">
            <span class="browser-annotation-listener-label">{{ t('Pairing token') }}</span>
            <input class="browser-annotation-listener-input browser-annotation-listener-token" type="text" :value="pairingToken" readonly />
          </label>
          <button class="browser-annotation-listener-copy-button" type="button" @click="copyText(pairingToken, 'token')">
            {{ copiedField === 'token' ? t('Copied') : t('Copy') }}
          </button>
        </div>
      </div>
    </article>
  </section>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import {
  getBrowserAnnotationListenStatus,
  startBrowserAnnotationListenSession,
  stopBrowserAnnotationListenSession,
  type BrowserAnnotationListenSession,
} from '../../api/codexGateway'
import { useUiLanguage } from '../../composables/useUiLanguage'

type BusyPhase = 'idle' | 'starting' | 'stopping' | 'checking'
type CopiedField = 'url' | 'token' | ''

const props = defineProps<{
  threadId: string
  threadTitle: string
}>()

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

const isBusy = computed(() => phase.value !== 'idle')
const isActive = computed(() => session.value?.status === 'active' && pairingToken.value.length > 0)
const targetThreadTitle = computed(() => props.threadTitle.trim() || props.threadId)
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
  if (phase.value === 'starting') return t('Creating a short-lived extension pairing session.')
  if (phase.value === 'stopping') return t('Revoking the active browser listener.')
  if (phase.value === 'checking') return t('Checking listener status.')
  if (isActive.value) return t('Active for the selected thread.')
  if (session.value?.status === 'revoked') return t('Listener stopped.')
  if (session.value?.status === 'expired') return t('Listener expired.')
  return t('Create a temporary token for the browser extension.')
})

watch(
  () => props.threadId,
  () => {
    clearActiveSession()
  },
)

onUnmounted(() => {
  clearActiveSession()
  clearCopyReset()
})

async function onStart(): Promise<void> {
  if (!props.threadId || phase.value !== 'idle') return
  const requestedThreadId = props.threadId
  const generation = sessionGeneration
  phase.value = 'starting'
  errorMessage.value = ''
  copiedField.value = ''
  stopStatusPolling()
  try {
    const nextSession = await startBrowserAnnotationListenSession(requestedThreadId)
    if (generation !== sessionGeneration || props.threadId !== requestedThreadId) {
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
    if (generation !== sessionGeneration || props.threadId !== requestedThreadId) return
    clearActiveSession()
    errorMessage.value = error instanceof Error ? error.message : t('Failed to start browser annotation listener.')
  } finally {
    if (generation === sessionGeneration && props.threadId === requestedThreadId) {
      phase.value = 'idle'
    }
  }
}

async function onStop(): Promise<void> {
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

function formatDateTime(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}
</script>

<style scoped>
@reference "../../style.css";

.browser-annotation-listener {
  --annotation-listener-bg: #fff;
  --annotation-listener-border: #e4e4e7;
  --annotation-listener-text: #09090b;
  --annotation-listener-subtle: #71717a;
  --annotation-listener-panel-bg: #fafafa;
  --annotation-listener-control-bg: #fff;
  --annotation-listener-control-border: #e4e4e7;
  --annotation-listener-hover-bg: #f4f4f5;
  --annotation-listener-primary-bg: #18181b;
  --annotation-listener-primary-text: #fff;
  --annotation-listener-error: #e11d48;
}

:global(:root.dark .browser-annotation-listener) {
  --annotation-listener-bg: #18181b;
  --annotation-listener-border: #3f3f46;
  --annotation-listener-text: #fafafa;
  --annotation-listener-subtle: #a1a1aa;
  --annotation-listener-panel-bg: #09090b;
  --annotation-listener-control-bg: #09090b;
  --annotation-listener-control-border: #3f3f46;
  --annotation-listener-hover-bg: #27272a;
  --annotation-listener-primary-bg: #f4f4f5;
  --annotation-listener-primary-text: #09090b;
  --annotation-listener-error: #fda4af;
}

.browser-annotation-listener-shell {
  @apply w-full rounded-xl border px-3 py-2 shadow-sm;
  background: var(--annotation-listener-bg);
  border-color: var(--annotation-listener-border);
  color: var(--annotation-listener-text);
}

.browser-annotation-listener-header {
  @apply flex items-center justify-between gap-3;
}

.browser-annotation-listener-heading {
  @apply min-w-0 flex-1;
}

.browser-annotation-listener-title {
  @apply m-0 truncate text-sm font-semibold;
}

.browser-annotation-listener-subtitle {
  @apply m-0 mt-0.5 truncate text-xs leading-relaxed;
  color: var(--annotation-listener-subtle);
}

.browser-annotation-listener-actions {
  @apply flex shrink-0 items-center gap-2;
}

.browser-annotation-listener-primary,
.browser-annotation-listener-secondary,
.browser-annotation-listener-disclosure,
.browser-annotation-listener-copy-button {
  @apply shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60;
}

.browser-annotation-listener-primary {
  background: var(--annotation-listener-primary-bg);
  border-color: var(--annotation-listener-primary-bg);
  color: var(--annotation-listener-primary-text);
}

.browser-annotation-listener-secondary,
.browser-annotation-listener-disclosure,
.browser-annotation-listener-copy-button {
  background: transparent;
  border-color: var(--annotation-listener-control-border);
  color: var(--annotation-listener-text);
}

.browser-annotation-listener-secondary:hover,
.browser-annotation-listener-disclosure:hover,
.browser-annotation-listener-copy-button:hover {
  background: var(--annotation-listener-hover-bg);
}

.browser-annotation-listener-error {
  @apply m-0 mt-2 text-xs leading-relaxed;
  color: var(--annotation-listener-error);
}

.browser-annotation-listener-summary {
  @apply mt-2 flex min-w-0 flex-wrap items-center gap-1.5;
}

.browser-annotation-listener-chip {
  @apply inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border px-2 py-1 text-[11px] leading-none;
  background: var(--annotation-listener-panel-bg);
  border-color: var(--annotation-listener-control-border);
  color: var(--annotation-listener-text);
}

.browser-annotation-listener-chip-label {
  @apply shrink-0 font-semibold uppercase tracking-[0.12em];
  color: var(--annotation-listener-subtle);
}

.browser-annotation-listener-chip-value {
  @apply min-w-0 truncate;
}

.browser-annotation-listener-details {
  @apply mt-2 grid gap-2 rounded-xl border p-2;
  background: var(--annotation-listener-panel-bg);
  border-color: var(--annotation-listener-border);
}

.browser-annotation-listener-row {
  @apply grid grid-cols-[4.75rem_minmax(0,1fr)] items-center gap-2 text-xs;
}

.browser-annotation-listener-last-batch {
  @apply grid gap-2 rounded-lg border px-2 py-2;
  background: var(--annotation-listener-bg);
  border-color: var(--annotation-listener-control-border);
}

.browser-annotation-listener-label {
  @apply shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em];
  color: var(--annotation-listener-subtle);
}

.browser-annotation-listener-value {
  @apply min-w-0 truncate;
  color: var(--annotation-listener-text);
}

.browser-annotation-listener-copy-row {
  @apply flex min-w-0 items-end gap-2;
}

.browser-annotation-listener-copy-field {
  @apply flex min-w-0 flex-1 flex-col gap-1;
}

.browser-annotation-listener-input {
  @apply h-9 min-w-0 rounded-xl border px-2.5 text-xs outline-none;
  background: var(--annotation-listener-control-bg);
  border-color: var(--annotation-listener-control-border);
  color: var(--annotation-listener-text);
}

.browser-annotation-listener-token {
  @apply font-mono;
}

@media (max-width: 640px) {
  .browser-annotation-listener-header {
    @apply items-center;
  }

  .browser-annotation-listener-actions {
    @apply gap-1.5;
  }

  .browser-annotation-listener-disclosure,
  .browser-annotation-listener-primary,
  .browser-annotation-listener-secondary {
    @apply px-2.5;
  }

  .browser-annotation-listener-copy-row {
    @apply flex-wrap;
  }

  .browser-annotation-listener-copy-button {
    @apply w-full;
  }
}
</style>
