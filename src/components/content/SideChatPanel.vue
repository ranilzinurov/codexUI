<template>
  <aside class="side-chat-panel" aria-label="Side chat">
    <header class="side-chat-header">
      <div class="side-chat-heading">
        <p class="side-chat-title">Side</p>
        <p v-if="pendingRequests.length > 0" class="side-chat-meta">{{ pendingRequests.length }} pending</p>
      </div>
      <button class="side-chat-icon-button" type="button" aria-label="Close side chat" @click="$emit('close')">
        <IconTablerX />
      </button>
    </header>

    <div class="side-chat-messages" role="log" aria-live="polite">
      <p v-if="messages.length === 0 && !liveOverlay" class="side-chat-empty">Ask a quick question.</p>
      <article
        v-for="message in messages"
        :key="message.id"
        class="side-chat-message"
        :class="`is-${message.role}`"
      >
        <p class="side-chat-message-role">{{ message.role === 'user' ? 'You' : 'Codex' }}</p>
        <p class="side-chat-message-text">{{ message.text }}</p>
      </article>
      <section v-if="liveOverlay" class="side-chat-live">
        <p class="side-chat-live-label">{{ liveOverlay.activityLabel }}</p>
        <p v-if="liveOverlay.reasoningText" class="side-chat-live-text">{{ liveOverlay.reasoningText }}</p>
      </section>
    </div>

    <ThreadPendingRequestPanel
      v-if="pendingRequests[0]"
      class="side-chat-pending-request"
      :request="pendingRequests[0]"
      :request-count="pendingRequests.length"
      :has-queue-above="false"
      @respond-server-request="$emit('respondServerRequest', $event)"
    />

    <p v-if="dictationStatusText" class="side-chat-dictation-status" role="status">
      {{ dictationStatusText }}
    </p>
    <form class="side-chat-composer" @submit.prevent="onSubmit">
      <textarea
        v-model="draft"
        class="side-chat-input"
        rows="3"
        placeholder="Ask in side chat"
        @keydown.enter.exact.prevent="onSubmit"
      />
      <button
        v-if="isDictationSupported"
        class="side-chat-dictation"
        :class="{ 'is-recording': isDictationRecording }"
        type="button"
        :aria-label="dictationButtonLabel"
        :title="dictationButtonLabel"
        :disabled="liveOverlay !== null || isDictationTranscribing"
        @click="onToggleDictation"
      >
        <IconTablerPlayerStopFilled v-if="isDictationRecording" />
        <span v-else-if="isDictationTranscribing" class="side-chat-dictation-spinner" aria-hidden="true" />
        <IconTablerMicrophone v-else />
      </button>
      <button
        class="side-chat-send"
        type="submit"
        aria-label="Send side chat message"
        :disabled="draft.trim().length === 0 || liveOverlay !== null || isDictationRecording || isDictationTranscribing"
      >
        <IconTablerArrowUp />
      </button>
    </form>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import IconTablerArrowUp from '../icons/IconTablerArrowUp.vue'
import IconTablerMicrophone from '../icons/IconTablerMicrophone.vue'
import IconTablerPlayerStopFilled from '../icons/IconTablerPlayerStopFilled.vue'
import IconTablerX from '../icons/IconTablerX.vue'
import ThreadPendingRequestPanel from './ThreadPendingRequestPanel.vue'
import { useDictation, type DictationAudioInputInfo } from '../../composables/useDictation'
import type { UiLiveOverlay, UiMessage, UiServerRequest, UiServerRequestReply } from '../../types/codex'

const props = defineProps<{
  messages: UiMessage[]
  liveOverlay: UiLiveOverlay | null
  pendingRequests: UiServerRequest[]
  activeThreadId: string
  dictationLanguage?: string
}>()

const emit = defineEmits<{
  close: []
  submit: [text: string]
  respondServerRequest: [payload: UiServerRequestReply]
  'dictation-input-updated': [info: DictationAudioInputInfo]
}>()

const draft = ref('')
const dictationFeedback = ref('')

const {
  state: dictationState,
  isSupported: isDictationSupported,
  hasPendingTranscription,
  toggleRecording,
} = useDictation({
  getStorageKey: () => `side-thread:${props.activeThreadId || 'unassigned'}`,
  getLanguage: () => props.dictationLanguage ?? 'auto',
  onAudioInput: (info) => {
    emit('dictation-input-updated', info)
  },
  onTranscript: (text) => {
    const transcript = text.trim()
    if (!transcript) return
    const message = draft.value.trim() ? `${draft.value.trim()}\n${transcript}` : transcript
    draft.value = ''
    dictationFeedback.value = ''
    emit('submit', message)
  },
  onEmpty: () => {
    dictationFeedback.value = 'No speech detected. Try again.'
  },
  onError: (error) => {
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      dictationFeedback.value = 'Microphone access was denied.'
      return
    }
    dictationFeedback.value = error instanceof Error ? error.message : 'Dictation failed.'
  },
})

const isDictationRecording = computed(() => dictationState.value === 'recording' || dictationState.value === 'paused')
const isDictationTranscribing = computed(() => dictationState.value === 'transcribing')
const dictationButtonLabel = computed(() => {
  if (isDictationRecording.value) return 'Stop and send dictation'
  if (isDictationTranscribing.value) return 'Transcribing dictation'
  if (hasPendingTranscription.value) return 'Transcribe saved side chat dictation'
  return 'Start side chat dictation'
})
const dictationStatusText = computed(() => {
  if (isDictationRecording.value) return 'Recording...'
  if (isDictationTranscribing.value) return 'Transcribing...'
  return dictationFeedback.value
})

function onSubmit(): void {
  const text = draft.value.trim()
  if (!text) return
  draft.value = ''
  emit('submit', text)
}

function onToggleDictation(): void {
  if (props.liveOverlay !== null || isDictationTranscribing.value) return
  dictationFeedback.value = ''
  toggleRecording()
}
</script>

<style scoped>
.side-chat-panel {
  display: flex;
  min-height: 0;
  width: min(360px, 34vw);
  flex-shrink: 0;
  flex-direction: column;
  overflow: hidden;
  border-left: 1px solid rgb(228 228 231);
  background: rgb(250 250 250);
}

.side-chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid rgb(228 228 231);
  padding: 10px 12px;
}

.side-chat-heading {
  min-width: 0;
}

.side-chat-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: rgb(39 39 42);
}

.side-chat-meta {
  margin: 2px 0 0;
  font-size: 12px;
  color: rgb(113 113 122);
}

.side-chat-icon-button,
.side-chat-dictation,
.side-chat-send {
  display: inline-flex;
  height: 32px;
  width: 32px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid rgb(228 228 231);
  border-radius: 999px;
  background: white;
  color: rgb(63 63 70);
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.side-chat-icon-button:hover,
.side-chat-dictation:hover:not(:disabled),
.side-chat-send:hover:not(:disabled) {
  border-color: rgb(212 212 216);
  background: rgb(244 244 245);
  color: rgb(24 24 27);
}

.side-chat-dictation.is-recording {
  border-color: rgb(254 202 202);
  background: rgb(254 242 242);
  color: rgb(220 38 38);
}

.side-chat-messages {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  padding: 12px;
}

.side-chat-empty {
  margin: auto;
  color: rgb(113 113 122);
  font-size: 13px;
}

.side-chat-message {
  max-width: 100%;
  border: 1px solid rgb(228 228 231);
  border-radius: 8px;
  background: white;
  padding: 9px 10px;
}

.side-chat-message.is-user {
  margin-left: 28px;
  border-color: rgb(191 219 254);
  background: rgb(239 246 255);
}

.side-chat-message-role {
  margin: 0 0 4px;
  font-size: 11px;
  font-weight: 700;
  color: rgb(82 82 91);
}

.side-chat-message-text,
.side-chat-live-text {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 13px;
  line-height: 1.45;
  color: rgb(39 39 42);
}

.side-chat-live {
  border-radius: 8px;
  border: 1px dashed rgb(212 212 216);
  padding: 9px 10px;
  background: rgb(244 244 245);
}

.side-chat-live-label {
  margin: 0 0 4px;
  font-size: 12px;
  font-weight: 700;
  color: rgb(63 63 70);
}

.side-chat-pending-request {
  border-top: 1px solid rgb(228 228 231);
  padding: 10px;
}

.side-chat-pending-request :deep(.thread-pending-request-shell) {
  border-radius: 8px;
}

.side-chat-dictation-status {
  margin: 0;
  border-top: 1px solid rgb(228 228 231);
  padding: 8px 10px 0;
  color: rgb(82 82 91);
  font-size: 12px;
  line-height: 1.4;
}

.side-chat-composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  border-top: 1px solid rgb(228 228 231);
  padding: 10px;
}

.side-chat-input {
  min-height: 68px;
  flex: 1;
  resize: none;
  border: 1px solid rgb(228 228 231);
  border-radius: 8px;
  background: white;
  padding: 9px 10px;
  color: rgb(39 39 42);
  font-size: 13px;
  line-height: 1.4;
  outline: none;
}

.side-chat-input:focus {
  border-color: rgb(161 161 170);
}

.side-chat-send:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.side-chat-dictation:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.side-chat-dictation-spinner {
  height: 16px;
  width: 16px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 999px;
  animation: side-chat-dictation-spin 700ms linear infinite;
}

@keyframes side-chat-dictation-spin {
  to {
    transform: rotate(360deg);
  }
}

:global(:root.dark .side-chat-panel) {
  border-left-color: rgb(63 63 70);
  background: rgb(24 24 27);
}

:global(:root.dark .side-chat-header),
:global(:root.dark .side-chat-composer),
:global(:root.dark .side-chat-dictation-status),
:global(:root.dark .side-chat-pending-request) {
  border-color: rgb(63 63 70);
}

:global(:root.dark .side-chat-title),
:global(:root.dark .side-chat-message-text),
:global(:root.dark .side-chat-live-text) {
  color: rgb(244 244 245);
}

:global(:root.dark .side-chat-meta),
:global(:root.dark .side-chat-empty),
:global(:root.dark .side-chat-message-role) {
  color: rgb(161 161 170);
}

:global(:root.dark .side-chat-icon-button),
:global(:root.dark .side-chat-dictation),
:global(.dark .side-chat-dictation),
:global(:root.dark .side-chat-send),
:global(:root.dark .side-chat-message),
:global(:root.dark .side-chat-input) {
  border-color: rgb(63 63 70);
  background: rgb(39 39 42);
  color: rgb(244 244 245);
}

:global(:root.dark .side-chat-dictation.is-recording),
:global(.dark .side-chat-dictation.is-recording) {
  border-color: rgb(127 29 29);
  background: rgb(69 10 10);
  color: rgb(254 202 202);
}

:global(:root.dark .side-chat-dictation-status) {
  color: rgb(161 161 170);
}

:global(:root.dark .side-chat-message.is-user) {
  border-color: rgb(30 64 175);
  background: rgb(23 37 84);
}

:global(:root.dark .side-chat-live) {
  border-color: rgb(82 82 91);
  background: rgb(39 39 42);
}

:global(:root.dark .side-chat-live-label) {
  color: rgb(212 212 216);
}

@media (max-width: 900px) {
  .side-chat-panel {
    width: 100%;
    min-height: 300px;
    max-height: 46vh;
    border-left: 0;
    border-top: 1px solid rgb(228 228 231);
  }
}
</style>
