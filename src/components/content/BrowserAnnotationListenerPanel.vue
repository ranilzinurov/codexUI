<template>
  <section class="browser-annotation-settings" aria-label="Browser annotation binding settings">
    <header class="browser-annotation-settings-header">
      <div class="browser-annotation-settings-heading">
        <p class="browser-annotation-settings-title">{{ t('Browser binding') }}</p>
        <p class="browser-annotation-settings-subtitle">{{ statusText }}</p>
      </div>
      <button
        v-if="!isActive"
        class="browser-annotation-settings-primary"
        type="button"
        :disabled="isBusy || !canListen"
        @click="$emit('start')"
      >
        {{ phase === 'starting' ? t('Creating...') : t('Create code') }}
      </button>
      <button
        v-else
        class="browser-annotation-settings-secondary"
        type="button"
        :disabled="isBusy"
        @click="$emit('stop')"
      >
        {{ phase === 'stopping' ? t('Clearing...') : t('Clear') }}
      </button>
    </header>

    <p v-if="errorMessage" class="browser-annotation-settings-error" role="alert">{{ errorMessage }}</p>

    <div v-if="session" class="browser-annotation-settings-summary" aria-live="polite">
      <span class="browser-annotation-settings-chip">
        <span class="browser-annotation-settings-chip-label">{{ t('Status') }}</span>
        <span class="browser-annotation-settings-chip-value">{{ session.status }}</span>
      </span>
      <span class="browser-annotation-settings-chip" :title="targetThreadTitle">
        <span class="browser-annotation-settings-chip-label">{{ t('Scope') }}</span>
        <span class="browser-annotation-settings-chip-value">{{ targetThreadTitle }}</span>
      </span>
      <span class="browser-annotation-settings-chip" :title="session.expiresAtIso">
        <span class="browser-annotation-settings-chip-label">{{ t('Expires') }}</span>
        <span class="browser-annotation-settings-chip-value">{{ expiresLabel }}</span>
      </span>
    </div>

    <p v-else class="browser-annotation-settings-empty">
      {{ t('Create a binding code here, then paste it into the browser extension settings.') }}
    </p>

    <button
      v-if="session"
      class="browser-annotation-settings-disclosure"
      type="button"
      :aria-expanded="detailsOpen"
      @click="$emit('update:detailsOpen', !detailsOpen)"
    >
      {{ detailsOpen ? t('Hide code') : t('Show code') }}
    </button>

    <div v-if="session && detailsOpen" class="browser-annotation-settings-details">
      <div class="browser-annotation-settings-copy-row">
        <label class="browser-annotation-settings-copy-field">
          <span class="browser-annotation-settings-label">{{ t('Server URL') }}</span>
          <input class="browser-annotation-settings-input" type="text" :value="listenerUrl" readonly />
        </label>
        <button
          class="browser-annotation-settings-copy-button"
          type="button"
          :aria-label="t('Copy server URL')"
          @click="$emit('copy-url')"
        >
          {{ copiedField === 'url' ? t('Copied') : t('Copy') }}
        </button>
      </div>
      <div v-if="isActive && pairingToken" class="browser-annotation-settings-copy-row">
        <label class="browser-annotation-settings-copy-field">
          <span class="browser-annotation-settings-label">{{ t('Browser binding code') }}</span>
          <input class="browser-annotation-settings-input browser-annotation-settings-token" type="text" :value="pairingToken" readonly />
        </label>
        <button
          class="browser-annotation-settings-copy-button"
          type="button"
          :aria-label="t('Copy browser binding code')"
          @click="$emit('copy-token')"
        >
          {{ copiedField === 'token' ? t('Copied') : t('Copy') }}
        </button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { BrowserAnnotationBindingPairing } from '../../api/codexGateway'
import { useUiLanguage } from '../../composables/useUiLanguage'

type BusyPhase = 'idle' | 'starting' | 'stopping' | 'checking'
type CopiedField = 'url' | 'token' | ''

defineProps<{
  session: BrowserAnnotationBindingPairing | null
  pairingToken: string
  phase: BusyPhase
  errorMessage: string
  copiedField: CopiedField
  detailsOpen: boolean
  isBusy: boolean
  isActive: boolean
  canListen: boolean
  targetThreadTitle: string
  listenerUrl: string
  expiresLabel: string
  lastBatchLabel: string
  lastBatchContextLabel: string
  statusText: string
}>()

defineEmits<{
  start: []
  stop: []
  'update:detailsOpen': [value: boolean]
  'copy-url': []
  'copy-token': []
}>()

const { t } = useUiLanguage()
</script>

<style scoped>
@reference "../../style.css";

.browser-annotation-settings {
  --annotation-listener-bg: oklch(98.5% 0.003 247);
  --annotation-listener-border: oklch(91.9% 0.006 247);
  --annotation-listener-text: oklch(22% 0.008 247);
  --annotation-listener-subtle: oklch(52% 0.012 247);
  --annotation-listener-panel-bg: oklch(99.2% 0.003 247);
  --annotation-listener-control-bg: oklch(99.2% 0.003 247);
  --annotation-listener-control-border: oklch(91.9% 0.006 247);
  --annotation-listener-hover-bg: oklch(96.4% 0.005 247);
  --annotation-listener-primary-bg: oklch(22% 0.008 247);
  --annotation-listener-primary-text: oklch(98.5% 0.003 247);
  --annotation-listener-error: oklch(54% 0.19 20);
  @apply border-t border-zinc-100 bg-zinc-50/70 px-3 py-3;
  color: var(--annotation-listener-text);
}

:global(:root.dark .browser-annotation-settings) {
  --annotation-listener-bg: oklch(22% 0.008 247);
  --annotation-listener-border: oklch(36% 0.01 247);
  --annotation-listener-text: oklch(98.5% 0.003 247);
  --annotation-listener-subtle: oklch(72% 0.012 247);
  --annotation-listener-panel-bg: oklch(15% 0.006 247);
  --annotation-listener-control-bg: oklch(15% 0.006 247);
  --annotation-listener-control-border: oklch(36% 0.01 247);
  --annotation-listener-hover-bg: oklch(27% 0.009 247);
  --annotation-listener-primary-bg: oklch(96.4% 0.005 247);
  --annotation-listener-primary-text: oklch(15% 0.006 247);
  --annotation-listener-error: oklch(80% 0.11 20);
  @apply border-zinc-700 bg-zinc-900/45;
}

.browser-annotation-settings-header {
  @apply flex items-start justify-between gap-3;
}

.browser-annotation-settings-heading {
  @apply min-w-0 flex-1;
}

.browser-annotation-settings-title {
  @apply m-0 truncate text-sm font-medium;
}

.browser-annotation-settings-subtitle {
  @apply m-0 mt-1 text-xs leading-5;
  color: var(--annotation-listener-subtle);
}

.browser-annotation-settings-primary,
.browser-annotation-settings-secondary,
.browser-annotation-settings-disclosure,
.browser-annotation-settings-copy-button {
  @apply shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60;
}

.browser-annotation-settings-primary {
  background: var(--annotation-listener-primary-bg);
  border-color: var(--annotation-listener-primary-bg);
  color: var(--annotation-listener-primary-text);
}

.browser-annotation-settings-secondary,
.browser-annotation-settings-disclosure,
.browser-annotation-settings-copy-button {
  background: transparent;
  border-color: var(--annotation-listener-control-border);
  color: var(--annotation-listener-text);
}

.browser-annotation-settings-secondary:hover,
.browser-annotation-settings-disclosure:hover,
.browser-annotation-settings-copy-button:hover {
  background: var(--annotation-listener-hover-bg);
}

.browser-annotation-settings-error {
  @apply m-0 mt-2 text-xs leading-5;
  color: var(--annotation-listener-error);
}

.browser-annotation-settings-empty {
  @apply m-0 mt-2 text-xs leading-5;
  color: var(--annotation-listener-subtle);
}

.browser-annotation-settings-summary {
  @apply mt-2 flex min-w-0 flex-wrap items-center gap-1.5;
}

.browser-annotation-settings-chip {
  @apply inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border px-2 py-1 text-[11px] leading-none;
  background: var(--annotation-listener-panel-bg);
  border-color: var(--annotation-listener-control-border);
  color: var(--annotation-listener-text);
}

.browser-annotation-settings-chip-label {
  @apply shrink-0 font-semibold uppercase tracking-normal;
  color: var(--annotation-listener-subtle);
}

.browser-annotation-settings-chip-value {
  @apply min-w-0 truncate;
}

.browser-annotation-settings-disclosure {
  @apply mt-2;
}

.browser-annotation-settings-details {
  @apply mt-2 grid gap-2 rounded-lg border p-2;
  background: var(--annotation-listener-bg);
  border-color: var(--annotation-listener-border);
}

.browser-annotation-settings-label {
  @apply shrink-0 text-[11px] font-semibold uppercase tracking-normal;
  color: var(--annotation-listener-subtle);
}

.browser-annotation-settings-copy-row {
  @apply flex min-w-0 items-end gap-2;
}

.browser-annotation-settings-copy-field {
  @apply flex min-w-0 flex-1 flex-col gap-1;
}

.browser-annotation-settings-input {
  @apply h-8 min-w-0 rounded-lg border px-2.5 text-xs outline-none;
  background: var(--annotation-listener-control-bg);
  border-color: var(--annotation-listener-control-border);
  color: var(--annotation-listener-text);
}

.browser-annotation-settings-token {
  @apply font-mono;
}

@media (max-width: 640px) {
  .browser-annotation-settings-header,
  .browser-annotation-settings-copy-row {
    @apply flex-wrap;
  }

  .browser-annotation-settings-copy-button {
    @apply w-full;
  }
}
</style>
