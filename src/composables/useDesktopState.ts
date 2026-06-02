import { computed, ref } from 'vue'
import { resolveBackendHttpUrl } from '../backendUrl'
import {

  archiveThread,
  forkThread,
  getAvailableCollaborationModes,
  getAccountRateLimits,
  renameThread,
  getAvailableModelIds,
  getCurrentModelConfig,
  getPendingServerRequests,
  getSkillsList,
  getThreadDetail,
  getThreadSummary,
  getOlderThreadMessages,
  getBackgroundThreadListLimit,
  interruptThreadTurn,
  pickCodexRateLimitSnapshot,
  replyToServerRequest,
  revertThreadFileChanges,
  rollbackThread,
  getThreadGroupsPage,
  getThreadReadState,
  getThreadQueueState,
  getWorkspaceRootsState,
  setCodexSpeedMode,
  setThreadQueueState,
  setWorkspaceRootsState,
  getThreadTitleCache,
  persistThreadTitle,
  persistThreadReadState,
  resumeThread,

  startThread,
  startSideThread,
  subscribeCodexNotifications,
  startThreadTurn,
  type RpcNotification,
  type SkillInfo,
  type ThreadQueueState,
  type WorkspaceRootsState,
} from '../api/codexGateway'
import {
  normalizeCollabAgentsFromItems,
  normalizeFileChangeStatus,
  readThreadAgentDisplayName,
  readThreadSubagentParentId,
  toUiFileChanges,
} from '../api/normalizers/v2'
import { safeLocalStorageGetItem, safeLocalStorageRemoveItem, safeLocalStorageSetItem } from '../browserCompat'
import { classifyPreviousResponseNotFound } from '../api/previousResponseErrors'
import type {
  CollaborationModeKind,
  CollaborationModeOption,
  CommandExecutionData,
  UiPendingRequestState,
  ReasoningEffort,
  SpeedMode,
  UiFileChange,
  UiCollabAgentStatus,
  UiLiveOverlay,
  UiMessage,
  UiMcpActivity,
  UiPlanData,
  UiPlanStep,
  UiProjectGroup,
  UiRateLimitSnapshot,
  UiServerRequest,
  UiServerRequestReply,
  UiThreadTokenUsage,
  UiTokenUsageBreakdown,
  UiThread,
} from '../types/codex'
import { getPathParent, isProjectlessChatPath, normalizePathForUi, toProjectName } from '../pathUtils.js'

function flattenThreads(groups: UiProjectGroup[]): UiThread[] {
  return groups.flatMap((group) => group.threads)
}

export function findAdjacentThreadId(threads: UiThread[], threadId: string): string {
  const targetIndex = threads.findIndex((thread) => thread.id === threadId)
  if (targetIndex < 0) return ''
  return threads[targetIndex + 1]?.id ?? threads[targetIndex - 1]?.id ?? ''
}

const READ_STATE_STORAGE_KEY = 'codex-web-local.thread-read-state.v1'
const MANUAL_UNREAD_STORAGE_KEY = 'codex-web-local.thread-manual-unread-state.v1'
const UNREAD_CUTOFF_STORAGE_KEY = 'codex-web-local.thread-unread-cutoff.v1'
const THREAD_TOKEN_USAGE_STORAGE_KEY = 'codex-web-local.thread-token-usage.v1'
const THREAD_TERMINAL_OPEN_STORAGE_KEY = 'codex-web-local.thread-terminal-open.v1'
const SELECTED_THREAD_STORAGE_KEY = 'codex-web-local.selected-thread-id.v1'
const SELECTED_MODEL_BY_CONTEXT_STORAGE_KEY = 'codex-web-local.selected-model-by-context.v1'
const LEGACY_SELECTED_MODEL_STORAGE_KEY = 'codex-web-local.selected-model-id.v1'
const PROJECT_ORDER_STORAGE_KEY = 'codex-web-local.project-order.v1'
const PROJECT_DISPLAY_NAME_STORAGE_KEY = 'codex-web-local.project-display-name.v1'
const COLLABORATION_MODE_STORAGE_KEY = 'codex-web-local.collaboration-mode-by-context.v1'
const LEGACY_COLLABORATION_MODE_STORAGE_KEY = 'codex-web-local.collaboration-mode.v1'
const NEW_THREAD_COLLABORATION_MODE_CONTEXT = '__new-thread__'
const NEW_THREAD_PROVIDER_MODEL_CONTEXT_PREFIX = '__new-thread-provider__::'
const EVENT_SYNC_DEBOUNCE_MS = 220
const BACKGROUND_THREAD_PAGINATION_DELAY_MS = 10_000
const RATE_LIMIT_REFRESH_DEBOUNCE_MS = 500
const TURN_START_FOLLOW_UP_SYNC_DELAY_MS = 3000
const RECENT_THREAD_MESSAGE_LOAD_REUSE_MS = 2000
const PREVIOUS_RESPONSE_AUTO_CONTINUE_DELAY_MS = 900
const PREVIOUS_RESPONSE_AUTO_CONTINUE_PREFIX = 'У нас была ошибка'
const REASONING_EFFORT_OPTIONS: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
const GLOBAL_SERVER_REQUEST_SCOPE = '__global__'
const MODEL_FALLBACK_ID = 'gpt-5.4-mini'
const CODEX_CLI_MISSING_MESSAGE = 'Codex CLI not found. Install @openai/codex or set CODEXUI_CODEX_COMMAND.'

function isCodexCliMissingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return message.includes('Codex CLI is not available')
}

function isTurnStartThreadNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return message.includes('turn/start') && /thread not found/iu.test(message)
}

function truncateAutoContinueErrorMessage(message: string): string {
  const normalized = message.replace(/\s+/gu, ' ').trim()
  return normalized.length > 500 ? `${normalized.slice(0, 500)}...` : normalized
}

function buildPreviousResponseAutoContinueMessage(errorMessage: string): string {
  const message = truncateAutoContinueErrorMessage(errorMessage)
  return `${PREVIOUS_RESPONSE_AUTO_CONTINUE_PREFIX} "${message}". Продолжи с того места, где остановился.`
}

function loadReadStateMap(): Record<string, string> {
  if (typeof window === 'undefined') return {}

  try {
    const raw = safeLocalStorageGetItem(READ_STATE_STORAGE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, string>
  } catch {
    return {}
  }
}

function saveReadStateMap(state: Record<string, string>): void {
  if (typeof window === 'undefined') return
  safeLocalStorageSetItem(READ_STATE_STORAGE_KEY, JSON.stringify(state))
}

function loadManualUnreadMap(): Record<string, boolean> {
  if (typeof window === 'undefined') return {}

  try {
    const raw = safeLocalStorageGetItem(MANUAL_UNREAD_STORAGE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const normalized: Record<string, boolean> = {}
    for (const [threadId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (threadId && value === true) normalized[threadId] = true
    }
    return normalized
  } catch {
    return {}
  }
}

function saveManualUnreadMap(state: Record<string, boolean>): void {
  if (typeof window === 'undefined') return
  safeLocalStorageSetItem(MANUAL_UNREAD_STORAGE_KEY, JSON.stringify(state))
}

function areReadStateMapsEqual(first: Record<string, string>, second: Record<string, string>): boolean {
  const firstEntries = Object.entries(first)
  if (firstEntries.length !== Object.keys(second).length) return false
  return firstEntries.every(([threadId, readAtIso]) => second[threadId] === readAtIso)
}

function mergeReadStateMaps(
  first: Record<string, string>,
  second: Record<string, string>,
): Record<string, string> {
  let changed = false
  const next = { ...first }
  for (const [threadId, readAtIso] of Object.entries(second)) {
    if (!threadId || !readAtIso) continue
    const previous = next[threadId]
    if (!previous || readAtIso > previous) {
      next[threadId] = readAtIso
      changed = true
    }
  }
  return changed ? next : first
}

function loadUnreadCutoffIso(): string {
  if (typeof window === 'undefined') return ''

  const existing = safeLocalStorageGetItem(UNREAD_CUTOFF_STORAGE_KEY)
  if (existing) return existing

  const initialCutoff = new Date().toISOString()
  safeLocalStorageSetItem(UNREAD_CUTOFF_STORAGE_KEY, initialCutoff)
  return initialCutoff
}

function saveUnreadCutoffIso(cutoffIso: string): void {
  if (typeof window === 'undefined') return
  safeLocalStorageSetItem(UNREAD_CUTOFF_STORAGE_KEY, cutoffIso)
}

function isThreadUpdatedAfterCutoff(updatedAtIso: string, cutoffIso: string): boolean {
  if (!updatedAtIso || !cutoffIso) return false
  const updatedAtMs = new Date(updatedAtIso).getTime()
  const cutoffMs = new Date(cutoffIso).getTime()
  if (!Number.isFinite(updatedAtMs) || !Number.isFinite(cutoffMs)) return false
  return updatedAtMs > cutoffMs
}

export function isThreadUnreadByLastRead(
  updatedAtIso: string,
  threadReadStateIso: string | undefined,
  unreadCutoffIso: string,
): boolean {
  const effectiveLastReadIso = threadReadStateIso ?? unreadCutoffIso
  return isThreadUpdatedAfterCutoff(updatedAtIso, effectiveLastReadIso)
}

function normalizeCollaborationMode(value: unknown): CollaborationModeKind {
  return value === 'plan' ? 'plan' : 'default'
}

function normalizeStoredModelId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function createStringKeyedRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>
}

function cloneStringKeyedRecord<T>(record: Record<string, T>): Record<string, T> {
  const next = createStringKeyedRecord<T>()
  for (const [key, value] of Object.entries(record)) {
    next[key] = value
  }
  return next
}

function omitStringKeyedRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const next = createStringKeyedRecord<T>()
  for (const [entryKey, value] of Object.entries(record)) {
    if (entryKey !== key) {
      next[entryKey] = value
    }
  }
  return next
}

function pruneThreadContextStateMap<T>(
  stateMap: Record<string, T>,
  threadIds: Set<string>,
): Record<string, T> {
  let changed = false
  const next = createStringKeyedRecord<T>()
  for (const [contextId, value] of Object.entries(stateMap)) {
    if (
      contextId === NEW_THREAD_COLLABORATION_MODE_CONTEXT
      || contextId.startsWith(NEW_THREAD_PROVIDER_MODEL_CONTEXT_PREFIX)
      || threadIds.has(contextId)
    ) {
      next[contextId] = value
      continue
    }
    changed = true
  }
  return changed ? next : stateMap
}

function normalizeProviderContextId(providerId: string): string {
  const normalized = providerId.trim().toLowerCase()
  return normalized || 'codex'
}

function isNewThreadContextId(contextId: string): boolean {
  return contextId === NEW_THREAD_COLLABORATION_MODE_CONTEXT
}

function toProviderModelContextId(providerId: string): string {
  const normalizedProviderId = normalizeProviderContextId(providerId)
  if (!normalizedProviderId) return ''
  return `${NEW_THREAD_PROVIDER_MODEL_CONTEXT_PREFIX}${normalizedProviderId}`
}

function toThreadContextId(threadId: string): string {
  const normalizedThreadId = threadId.trim()
  return normalizedThreadId || NEW_THREAD_COLLABORATION_MODE_CONTEXT
}

function loadSelectedModelMap(): Record<string, string> {
  if (typeof window === 'undefined') return createStringKeyedRecord<string>()

  try {
    const raw = safeLocalStorageGetItem(SELECTED_MODEL_BY_CONTEXT_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return createStringKeyedRecord<string>()

      const next = createStringKeyedRecord<string>()
      for (const [contextId, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof contextId !== 'string' || contextId.length === 0) continue
        const normalizedModelId = normalizeStoredModelId(value)
        if (normalizedModelId) {
          next[contextId] = normalizedModelId
        }
      }
      return next
    }
  } catch {
    // Fall back to the legacy global preference below.
  }

  const legacyModelId = normalizeStoredModelId(safeLocalStorageGetItem(LEGACY_SELECTED_MODEL_STORAGE_KEY))
  const next = createStringKeyedRecord<string>()
  if (legacyModelId) {
    next[NEW_THREAD_COLLABORATION_MODE_CONTEXT] = legacyModelId
  }
  return next
}

function readSelectedModel(
  state: Record<string, string>,
  threadId: string,
): string {
  const contextId = toThreadContextId(threadId)
  const contextModelId = normalizeStoredModelId(state[contextId])
  if (contextModelId) return contextModelId
  return normalizeStoredModelId(state[NEW_THREAD_COLLABORATION_MODE_CONTEXT])
}

function saveSelectedModelMap(state: Record<string, string>): void {
  if (typeof window === 'undefined') return
  try {
    if (Object.keys(state).length === 0) {
      safeLocalStorageRemoveItem(SELECTED_MODEL_BY_CONTEXT_STORAGE_KEY)
    } else {
      safeLocalStorageSetItem(SELECTED_MODEL_BY_CONTEXT_STORAGE_KEY, JSON.stringify(state))
    }
    safeLocalStorageRemoveItem(LEGACY_SELECTED_MODEL_STORAGE_KEY)
  } catch {
    // Keep in-memory selection working even if localStorage writes fail.
  }
}

function loadSelectedCollaborationModeMap(): Record<string, CollaborationModeKind> {
  if (typeof window === 'undefined') return createStringKeyedRecord<CollaborationModeKind>()

  try {
    const raw = safeLocalStorageGetItem(COLLABORATION_MODE_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return createStringKeyedRecord<CollaborationModeKind>()
      }

      const next = createStringKeyedRecord<CollaborationModeKind>()
      for (const [contextId, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof contextId !== 'string' || contextId.length === 0) continue
        const normalizedMode = normalizeCollaborationMode(value)
        if (normalizedMode === 'plan') {
          next[contextId] = normalizedMode
        }
      }
      return next
    }
  } catch {
    // Fall back to the legacy global preference below.
  }

  return createStringKeyedRecord<CollaborationModeKind>()
}

function readSelectedCollaborationMode(
  state: Record<string, CollaborationModeKind>,
  threadId: string,
): CollaborationModeKind {
  const contextId = toThreadContextId(threadId)
  return normalizeCollaborationMode(state[contextId])
}

function writeSelectedCollaborationModeForContext(
  state: Record<string, CollaborationModeKind>,
  threadId: string,
  mode: CollaborationModeKind,
): Record<string, CollaborationModeKind> {
  const contextId = toThreadContextId(threadId)
  if (isNewThreadContextId(contextId)) {
    return omitStringKeyedRecordKey(state, contextId)
  }
  if (mode === 'plan') {
    const next = cloneStringKeyedRecord(state)
    next[contextId] = 'plan'
    return next
  }
  return omitStringKeyedRecordKey(state, contextId)
}

function saveSelectedCollaborationModeMap(state: Record<string, CollaborationModeKind>): void {
  if (typeof window === 'undefined') return
  try {
    if (Object.keys(state).length === 0) {
      safeLocalStorageRemoveItem(COLLABORATION_MODE_STORAGE_KEY)
    } else {
      safeLocalStorageSetItem(COLLABORATION_MODE_STORAGE_KEY, JSON.stringify(state))
    }
    safeLocalStorageRemoveItem(LEGACY_COLLABORATION_MODE_STORAGE_KEY)
  } catch {
    // Keep in-memory mode selection working even if localStorage writes fail.
  }
}

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.min(Math.max(value, minValue), maxValue)
}

function normalizeStoredTokenCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value))
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.trunc(parsed))
    }
  }

  return null
}

function normalizeTokenUsageBreakdown(value: unknown): UiThreadTokenUsage['last'] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const record = value as Record<string, unknown>
  return {
    totalTokens: normalizeStoredTokenCount(record.totalTokens) ?? 0,
    inputTokens: normalizeStoredTokenCount(record.inputTokens) ?? 0,
    cachedInputTokens: normalizeStoredTokenCount(record.cachedInputTokens) ?? 0,
    outputTokens: normalizeStoredTokenCount(record.outputTokens) ?? 0,
    reasoningOutputTokens: normalizeStoredTokenCount(record.reasoningOutputTokens) ?? 0,
  }
}

function normalizeThreadTokenUsage(value: unknown): UiThreadTokenUsage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const record = value as Record<string, unknown>
  const total = normalizeTokenUsageBreakdown(record.total)
  const last = normalizeTokenUsageBreakdown(record.last)
  if (!total || !last) return null

  const modelContextWindow = normalizeStoredTokenCount(record.modelContextWindow)
  const currentContextTokens = last.totalTokens
  const remainingContextTokens = typeof modelContextWindow === 'number'
    ? Math.max(modelContextWindow - currentContextTokens, 0)
    : null
  const remainingContextPercent = typeof modelContextWindow === 'number' && modelContextWindow > 0
    ? clamp(Math.round((remainingContextTokens ?? 0) / modelContextWindow * 100), 0, 100)
    : null

  return {
    total,
    last,
    modelContextWindow,
    currentContextTokens,
    remainingContextTokens,
    remainingContextPercent,
  }
}

function loadThreadTokenUsageMap(): Record<string, UiThreadTokenUsage> {
  if (typeof window === 'undefined') return {}

  try {
    const raw = safeLocalStorageGetItem(THREAD_TOKEN_USAGE_STORAGE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const normalizedMap: Record<string, UiThreadTokenUsage> = {}
    for (const [threadId, usage] of Object.entries(parsed as Record<string, unknown>)) {
      if (!threadId) continue
      const normalizedUsage = normalizeThreadTokenUsage(usage)
      if (normalizedUsage) {
        normalizedMap[threadId] = normalizedUsage
      }
    }
    return normalizedMap
  } catch {
    return {}
  }
}

function saveThreadTokenUsageMap(state: Record<string, UiThreadTokenUsage>): void {
  if (typeof window === 'undefined') return
  safeLocalStorageSetItem(THREAD_TOKEN_USAGE_STORAGE_KEY, JSON.stringify(state))
}

function loadThreadTerminalOpenMap(): Record<string, boolean> {
  if (typeof window === 'undefined') return {}

  try {
    const raw = safeLocalStorageGetItem(THREAD_TERMINAL_OPEN_STORAGE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const normalizedMap: Record<string, boolean> = {}
    for (const [threadId, isOpen] of Object.entries(parsed as Record<string, unknown>)) {
      if (threadId && typeof isOpen === 'boolean') {
        normalizedMap[threadId] = isOpen
      }
    }
    return normalizedMap
  } catch {
    return {}
  }
}

function saveThreadTerminalOpenMap(state: Record<string, boolean>): void {
  if (typeof window === 'undefined') return
  safeLocalStorageSetItem(THREAD_TERMINAL_OPEN_STORAGE_KEY, JSON.stringify(state))
}

function loadSelectedThreadId(): string {
  if (typeof window === 'undefined') return ''
  const raw = safeLocalStorageGetItem(SELECTED_THREAD_STORAGE_KEY)
  return raw ?? ''
}

function saveSelectedThreadId(threadId: string): void {
  if (typeof window === 'undefined') return
  if (!threadId) {
    safeLocalStorageRemoveItem(SELECTED_THREAD_STORAGE_KEY)
    return
  }
  safeLocalStorageSetItem(SELECTED_THREAD_STORAGE_KEY, threadId)
}

function loadProjectOrder(): string[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = safeLocalStorageGetItem(PROJECT_ORDER_STORAGE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const order: string[] = []
    for (const item of parsed) {
      if (typeof item !== 'string' || item.length === 0) continue
      const normalizedItem = toProjectName(item)
      if (normalizedItem.length > 0 && !order.includes(normalizedItem)) {
        order.push(normalizedItem)
      }
    }
    return order
  } catch {
    return []
  }
}

function saveProjectOrder(order: string[]): void {
  if (typeof window === 'undefined') return
  safeLocalStorageSetItem(PROJECT_ORDER_STORAGE_KEY, JSON.stringify(order))
}

function loadProjectDisplayNames(): Record<string, string> {
  if (typeof window === 'undefined') return {}

  try {
    const raw = safeLocalStorageGetItem(PROJECT_DISPLAY_NAME_STORAGE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const displayNames: Record<string, string> = {}
    for (const [projectName, displayName] of Object.entries(parsed as Record<string, unknown>)) {
      const normalizedProjectName = typeof projectName === 'string' ? toProjectName(projectName) : ''
      if (normalizedProjectName.length > 0 && typeof displayName === 'string') {
        displayNames[normalizedProjectName] = displayName
      }
    }
    return displayNames
  } catch {
    return {}
  }
}

function saveProjectDisplayNames(displayNames: Record<string, string>): void {
  if (typeof window === 'undefined') return
  safeLocalStorageSetItem(PROJECT_DISPLAY_NAME_STORAGE_KEY, JSON.stringify(displayNames))
}

function mergeProjectOrder(previousOrder: string[], incomingGroups: UiProjectGroup[]): string[] {
  const nextOrder: string[] = []

  for (const projectName of previousOrder) {
    if (!nextOrder.includes(projectName)) {
      nextOrder.push(projectName)
    }
  }

  for (const group of incomingGroups) {
    if (!nextOrder.includes(group.projectName)) {
      nextOrder.push(group.projectName)
    }
  }

  return areStringArraysEqual(previousOrder, nextOrder) ? previousOrder : nextOrder
}

function orderGroupsByProjectOrder(incoming: UiProjectGroup[], projectOrder: string[]): UiProjectGroup[] {
  const incomingByName = new Map(incoming.map((group) => [group.projectName, group]))
  const ordered: UiProjectGroup[] = projectOrder
    .map((projectName) => incomingByName.get(projectName) ?? null)
    .filter((group): group is UiProjectGroup => group !== null)

  for (const group of incoming) {
    if (!projectOrder.includes(group.projectName)) {
      ordered.push(group)
    }
  }

  return ordered
}

function areStringArraysEqual(first?: string[], second?: string[]): boolean {
  const left = Array.isArray(first) ? first : []
  const right = Array.isArray(second) ? second : []
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function reorderStringArray(items: string[], fromIndex: number, toIndex: number): string[] {
  if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length) {
    return items
  }

  if (fromIndex === toIndex) {
    return items
  }

  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

function areCommandExecutionsEqual(first?: CommandExecutionData, second?: CommandExecutionData): boolean {
  if (!first && !second) return true
  if (!first || !second) return false
  return first.status === second.status && first.aggregatedOutput === second.aggregatedOutput && first.exitCode === second.exitCode
}

function arePlanStepsEqual(first: UiPlanStep[] = [], second: UiPlanStep[] = []): boolean {
  if (first.length !== second.length) return false
  for (let index = 0; index < first.length; index += 1) {
    if (first[index]?.step !== second[index]?.step || first[index]?.status !== second[index]?.status) {
      return false
    }
  }
  return true
}

function arePlanDataEqual(first?: UiPlanData, second?: UiPlanData): boolean {
  if (!first && !second) return true
  if (!first || !second) return false
  return (
    first.explanation === second.explanation &&
    first.isStreaming === second.isStreaming &&
    arePlanStepsEqual(first.steps, second.steps)
  )
}

function isUnsupportedChatGptModelError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return (
    message.includes('not supported when using codex with a chatgpt account') ||
    message.includes('model is not supported') ||
    message.includes('requires a newer version of codex')
  )
}

function areMessageFieldsEqual(first: UiMessage, second: UiMessage): boolean {
  return (
    first.id === second.id &&
    first.role === second.role &&
    first.text === second.text &&
    areStringArraysEqual(first.images, second.images) &&
    areUiFileChangesEqual(first.fileChanges, second.fileChanges) &&
    first.fileChangeStatus === second.fileChangeStatus &&
    first.messageType === second.messageType &&
    first.rawPayload === second.rawPayload &&
    first.isUnhandled === second.isUnhandled &&
    areCommandExecutionsEqual(first.commandExecution, second.commandExecution) &&
    arePlanDataEqual(first.plan, second.plan) &&
    first.turnId === second.turnId &&
    first.turnIndex === second.turnIndex &&
    first.isAutomationRun === second.isAutomationRun &&
    first.automationDisplayName === second.automationDisplayName
  )
}

function areMessageArraysEqual(first: UiMessage[], second: UiMessage[]): boolean {
  if (first.length !== second.length) return false
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false
  }
  return true
}

function mergeMessages(
  previous: UiMessage[],
  incoming: UiMessage[],
  options: { preserveMissing?: boolean } = {},
): UiMessage[] {
  const previousById = new Map(previous.map((message) => [message.id, message]))
  const incomingById = new Map(incoming.map((message) => [message.id, message]))

  const mergedIncoming = incoming.map((incomingMessage) => {
    const previousMessage = previousById.get(incomingMessage.id)
    if (previousMessage && areMessageFieldsEqual(previousMessage, incomingMessage)) {
      return previousMessage
    }
    return incomingMessage
  })

  if (options.preserveMissing !== true) {
    return areMessageArraysEqual(previous, mergedIncoming) ? previous : mergedIncoming
  }

  const mergedFromPrevious = previous.map((previousMessage) => {
    const nextMessage = incomingById.get(previousMessage.id)
    if (!nextMessage) {
      return previousMessage
    }
    if (areMessageFieldsEqual(previousMessage, nextMessage)) {
      return previousMessage
    }
    return nextMessage
  })

  const previousIdSet = new Set(previous.map((message) => message.id))
  const appended = mergedIncoming.filter((message) => !previousIdSet.has(message.id))
  const merged = [...mergedFromPrevious, ...appended]

  return areMessageArraysEqual(previous, merged) ? previous : merged
}

function areUiFileChangesEqual(first?: UiFileChange[], second?: UiFileChange[]): boolean {
  if (!first && !second) return true
  if (!first || !second) return false
  if (first.length !== second.length) return false
  for (let index = 0; index < first.length; index += 1) {
    const firstChange = first[index]
    const secondChange = second[index]
    if (
      firstChange.path !== secondChange.path ||
      firstChange.operation !== secondChange.operation ||
      firstChange.movedToPath !== secondChange.movedToPath ||
      firstChange.diff !== secondChange.diff ||
      firstChange.addedLineCount !== secondChange.addedLineCount ||
      firstChange.removedLineCount !== secondChange.removedLineCount
    ) {
      return false
    }
  }
  return true
}

function normalizeMessageText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function removeRedundantLiveAgentMessages(previous: UiMessage[], incoming: UiMessage[]): UiMessage[] {
  const incomingMessageIds = new Set(incoming.map((message) => message.id))
  const incomingAssistantTexts = new Set(
    incoming
      .filter((message) => message.role === 'assistant')
      .map((message) => normalizeMessageText(message.text))
      .filter((text) => text.length > 0),
  )

  if (incomingAssistantTexts.size === 0) {
    return previous
  }

  const next = previous.filter((message) => {
    if (message.messageType !== 'agentMessage.live') return true
    if (incomingMessageIds.has(message.id)) return false
    const normalized = normalizeMessageText(message.text)
    if (normalized.length === 0) return false
    return !incomingAssistantTexts.has(normalized)
  })

  return next.length === previous.length ? previous : next
}

function removePersistedLiveMessages(previous: UiMessage[], incoming: UiMessage[]): UiMessage[] {
  const incomingIds = new Set(incoming.map((message) => message.id))
  const next = previous.filter((message) => !incomingIds.has(message.id))
  return next.length === previous.length ? previous : next
}

function upsertMessage(previous: UiMessage[], nextMessage: UiMessage): UiMessage[] {
  const existingIndex = previous.findIndex((message) => message.id === nextMessage.id)
  if (existingIndex < 0) {
    return [...previous, nextMessage]
  }

  const existing = previous[existingIndex]
  if (areMessageFieldsEqual(existing, nextMessage)) {
    return previous
  }

  const next = [...previous]
  next.splice(existingIndex, 1, nextMessage)
  return next
}

type TurnSummaryState = {
  turnId: string
  durationMs: number
  turnIndex?: number
  changedFileCount?: number
  addedLineCount?: number
  removedLineCount?: number
}

type TurnChangeSummary = {
  changedFileCount: number
  addedLineCount: number
  removedLineCount: number
}

type TurnActivityState = {
  label: string
  details: string[]
}

type TurnErrorState = {
  message: string
  transient: boolean
}

type TurnStartedInfo = {
  threadId: string
  turnId: string
  startedAtMs: number
}

type TurnCompletedInfo = {
  threadId: string
  turnId: string
  completedAtMs: number
  startedAtMs?: number
}

const WORKED_MESSAGE_TYPE = 'worked'

function parseIsoTimestamp(value: string): number | null {
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}

function formatTurnDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return '<1s'
  }

  const totalSeconds = Math.max(1, Math.round(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const parts: string[] = []

  if (hours > 0) {
    parts.push(`${hours}h`)
  }

  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}m`)
  }

  const displaySeconds = seconds > 0 || parts.length === 0 ? seconds : 0
  parts.push(`${displaySeconds}s`)
  return parts.join(' ')
}

function areTurnSummariesEqual(first?: TurnSummaryState, second?: TurnSummaryState): boolean {
  if (!first && !second) return true
  if (!first || !second) return false
  return (
    first.turnId === second.turnId &&
    first.durationMs === second.durationMs &&
    first.turnIndex === second.turnIndex &&
    first.changedFileCount === second.changedFileCount &&
    first.addedLineCount === second.addedLineCount &&
    first.removedLineCount === second.removedLineCount
  )
}

function areTurnActivitiesEqual(first?: TurnActivityState, second?: TurnActivityState): boolean {
  if (!first && !second) return true
  if (!first || !second) return false
  if (first.label !== second.label) return false
  if (first.details.length !== second.details.length) return false
  for (let index = 0; index < first.details.length; index += 1) {
    if (first.details[index] !== second.details[index]) return false
  }
  return true
}

function areCollabAgentRowsEqual(first: UiCollabAgentStatus[], second: UiCollabAgentStatus[]): boolean {
  if (first.length !== second.length) return false
  for (let index = 0; index < first.length; index += 1) {
    const a = first[index]
    const b = second[index]
    if (a.id !== b.id || a.name !== b.name || a.task !== b.task || a.status !== b.status) return false
  }
  return true
}

function countUnifiedDiffLines(value: string): { addedLineCount: number; removedLineCount: number } {
  let addedLineCount = 0
  let removedLineCount = 0

  for (const line of value.replace(/\r\n/g, '\n').split('\n')) {
    if (!line || line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) continue
    if (line.startsWith('+')) {
      addedLineCount += 1
      continue
    }
    if (line.startsWith('-')) {
      removedLineCount += 1
    }
  }

  return { addedLineCount, removedLineCount }
}

function countUnifiedDiffFiles(value: string): number {
  const normalized = value.replace(/\r\n/g, '\n')
  const diffGitMatches = normalized.match(/^diff --git\s+/gmu)
  if (diffGitMatches && diffGitMatches.length > 0) return diffGitMatches.length

  const paths = new Set<string>()
  for (const line of normalized.split('\n')) {
    if (!line.startsWith('+++ ')) continue
    const path = line.slice(4).trim()
    if (path && path !== '/dev/null') paths.add(path)
  }
  return paths.size
}

function summarizeUnifiedDiff(value: string): TurnChangeSummary {
  const counts = countUnifiedDiffLines(value)
  return {
    changedFileCount: countUnifiedDiffFiles(value),
    ...counts,
  }
}

function summarizeTurnFileChanges(messages: UiMessage[], summary: TurnSummaryState): TurnChangeSummary | null {
  let changedFileCount = 0
  let addedLineCount = 0
  let removedLineCount = 0
  const seenChanges = new Set<string>()

  for (const message of messages) {
    if (!Array.isArray(message.fileChanges) || message.fileChanges.length === 0) continue
    const sameTurnId = Boolean(summary.turnId && message.turnId === summary.turnId)
    const sameTurnIndex =
      typeof summary.turnIndex === 'number' &&
      typeof message.turnIndex === 'number' &&
      message.turnIndex === summary.turnIndex
    if (!sameTurnId && !sameTurnIndex) continue

    for (const change of message.fileChanges) {
      const key = `${change.path}\u0000${change.movedToPath ?? ''}\u0000${change.operation}`
      if (seenChanges.has(key)) continue
      seenChanges.add(key)
      changedFileCount += 1
      addedLineCount += change.addedLineCount
      removedLineCount += change.removedLineCount
    }
  }

  if (changedFileCount === 0 && addedLineCount === 0 && removedLineCount === 0) return null
  return { changedFileCount, addedLineCount, removedLineCount }
}

function readTurnChangeSummary(summary: TurnSummaryState, messages: UiMessage[]): TurnChangeSummary | null {
  const fromFileChanges = summarizeTurnFileChanges(messages, summary)
  if (fromFileChanges) return fromFileChanges

  const changedFileCount = summary.changedFileCount ?? 0
  const addedLineCount = summary.addedLineCount ?? 0
  const removedLineCount = summary.removedLineCount ?? 0
  if (changedFileCount === 0 && addedLineCount === 0 && removedLineCount === 0) return null
  return { changedFileCount, addedLineCount, removedLineCount }
}

function formatTurnChangeSummary(changes: TurnChangeSummary | null): string {
  if (!changes) return ''
  const parts: string[] = []
  if (changes.changedFileCount > 0) {
    parts.push(changes.changedFileCount === 1 ? '1 file' : `${changes.changedFileCount} files`)
  }
  if (changes.addedLineCount > 0) parts.push(`+${changes.addedLineCount}`)
  if (changes.removedLineCount > 0) parts.push(`-${changes.removedLineCount}`)
  return parts.join(' ')
}

function buildTurnSummaryMessage(summary: TurnSummaryState, messages: UiMessage[]): UiMessage {
  const turnChangeSummary = readTurnChangeSummary(summary, messages)
  const changeSummary = formatTurnChangeSummary(turnChangeSummary)
  const parts = [`Worked for ${formatTurnDuration(summary.durationMs)}`]
  if (changeSummary) parts.push(changeSummary)

  return {
    id: `turn-summary:${summary.turnId}`,
    role: 'system',
    text: parts.join(' · '),
    messageType: WORKED_MESSAGE_TYPE,
    turnSummary: {
      durationMs: summary.durationMs,
      changedFileCount: turnChangeSummary?.changedFileCount,
      addedLineCount: turnChangeSummary?.addedLineCount,
      removedLineCount: turnChangeSummary?.removedLineCount,
    },
    turnId: summary.turnId,
    turnIndex: summary.turnIndex,
  }
}

function findTurnSummaryInsertIndex(messages: UiMessage[], summary: TurnSummaryState): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    const sameTurnId = Boolean(summary.turnId && message.turnId === summary.turnId)
    const sameTurnIndex =
      typeof summary.turnIndex === 'number' &&
      typeof message.turnIndex === 'number' &&
      message.turnIndex === summary.turnIndex
    if ((sameTurnId || sameTurnIndex) && message.role === 'user') {
      return index
    }
  }

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    const sameTurnId = Boolean(summary.turnId && message.turnId === summary.turnId)
    const sameTurnIndex =
      typeof summary.turnIndex === 'number' &&
      typeof message.turnIndex === 'number' &&
      message.turnIndex === summary.turnIndex
    if (sameTurnId || sameTurnIndex) {
      return Math.max(0, index - 1)
    }
  }

  return -1
}

function insertTurnSummaryMessage(messages: UiMessage[], summary: TurnSummaryState): UiMessage[] {
  const sanitizedMessages = messages.filter((message) => message.messageType !== WORKED_MESSAGE_TYPE)
  const summaryMessage = buildTurnSummaryMessage(summary, sanitizedMessages)
  const insertIndex = findTurnSummaryInsertIndex(sanitizedMessages, summary)
  if (insertIndex < 0) {
    return [...sanitizedMessages, summaryMessage]
  }
  const next = [...sanitizedMessages]
  next.splice(insertIndex + 1, 0, summaryMessage)
  return next
}

function omitKey<TValue>(record: Record<string, TValue>, key: string): Record<string, TValue> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

function omitKeys<TValue>(record: Record<string, TValue>, keys: Set<string>): Record<string, TValue> {
  if (keys.size === 0) return record
  let changed = false
  const next: Record<string, TValue> = {}
  for (const [key, value] of Object.entries(record)) {
    if (keys.has(key)) {
      changed = true
      continue
    }
    next[key] = value
  }
  return changed ? next : record
}

function areThreadFieldsEqual(first: UiThread, second: UiThread): boolean {
  return (
    first.id === second.id &&
    first.title === second.title &&
    first.projectName === second.projectName &&
    first.cwd === second.cwd &&
    first.agentDisplayName === second.agentDisplayName &&
    first.createdAtIso === second.createdAtIso &&
    first.updatedAtIso === second.updatedAtIso &&
    first.preview === second.preview &&
    first.unread === second.unread &&
    first.inProgress === second.inProgress &&
    first.pendingRequestState === second.pendingRequestState
  )
}

function areThreadArraysEqual(first: UiThread[], second: UiThread[]): boolean {
  if (first.length !== second.length) return false
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false
  }
  return true
}

function areGroupArraysEqual(first: UiProjectGroup[], second: UiProjectGroup[]): boolean {
  if (first.length !== second.length) return false
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false
  }
  return true
}

function pruneThreadStateMap<T>(stateMap: Record<string, T>, threadIds: Set<string>): Record<string, T> {
  const nextEntries = Object.entries(stateMap).filter(([threadId]) => threadIds.has(threadId))
  if (nextEntries.length === Object.keys(stateMap).length) {
    return stateMap
  }
  return Object.fromEntries(nextEntries) as Record<string, T>
}

export function removeThreadFromGroups(groups: UiProjectGroup[], threadId: string): UiProjectGroup[] {
  const normalizedThreadId = threadId.trim()
  if (!normalizedThreadId) return groups

  let changed = false
  const nextGroups: UiProjectGroup[] = []

  for (const group of groups) {
    const nextThreads = group.threads.filter((thread) => thread.id !== normalizedThreadId)
    const removedFromGroup = nextThreads.length !== group.threads.length
    if (removedFromGroup) {
      changed = true
    }
    if (nextThreads.length > 0) {
      nextGroups.push(removedFromGroup ? { ...group, threads: nextThreads } : group)
    } else if (group.threads.length === 0) {
      nextGroups.push(group)
    }
  }

  return changed ? nextGroups : groups
}

function mergeThreadGroups(
  previous: UiProjectGroup[],
  incoming: UiProjectGroup[],
): UiProjectGroup[] {
  const previousGroupsByName = new Map(previous.map((group) => [group.projectName, group]))
  const mergedGroups: UiProjectGroup[] = incoming.map((incomingGroup) => {
    const previousGroup = previousGroupsByName.get(incomingGroup.projectName)
    const previousThreadsById = new Map(previousGroup?.threads.map((thread) => [thread.id, thread]) ?? [])

    const mergedThreads = incomingGroup.threads.map((incomingThread) => {
      const previousThread = previousThreadsById.get(incomingThread.id)
      if (previousThread && areThreadFieldsEqual(previousThread, incomingThread)) {
        return previousThread
      }
      return incomingThread
    })

    if (
      previousGroup &&
      previousGroup.projectName === incomingGroup.projectName &&
      areThreadArraysEqual(previousGroup.threads, mergedThreads)
    ) {
      return previousGroup
    }

    return {
      projectName: incomingGroup.projectName,
      threads: mergedThreads,
    }
  })

  return areGroupArraysEqual(previous, mergedGroups) ? previous : mergedGroups
}

function filterThreadGroupsByExcludedIds(groups: UiProjectGroup[], excludedThreadIds: Set<string>): UiProjectGroup[] {
  if (excludedThreadIds.size === 0) return groups

  let changed = false
  const nextGroups: UiProjectGroup[] = []
  for (const group of groups) {
    const nextThreads = group.threads.filter((thread) => !excludedThreadIds.has(thread.id))
    if (nextThreads.length !== group.threads.length) {
      changed = true
    }
    if (nextThreads.length > 0) {
      nextGroups.push(nextThreads === group.threads ? group : { ...group, threads: nextThreads })
    } else if (group.threads.length > 0) {
      changed = true
    }
  }

  return changed ? nextGroups : groups
}

function mergeIncomingWithLocalInProgressThreads(
  previous: UiProjectGroup[],
  incoming: UiProjectGroup[],
  inProgressById: Record<string, boolean>,
): UiProjectGroup[] {
  const incomingThreadIds = new Set(flattenThreads(incoming).map((thread) => thread.id))
  const localInProgressThreads = flattenThreads(previous).filter(
    (thread) => inProgressById[thread.id] === true && !incomingThreadIds.has(thread.id),
  )

  if (localInProgressThreads.length === 0) {
    return incoming
  }

  const incomingByProjectName = new Map(incoming.map((group) => [group.projectName, group]))
  const merged: UiProjectGroup[] = incoming.map((group) => ({
    projectName: group.projectName,
    threads: [...group.threads],
  }))

  for (const thread of localInProgressThreads) {
    const existingGroup = incomingByProjectName.get(thread.projectName)
    if (existingGroup) {
      const mergedGroupIndex = merged.findIndex((group) => group.projectName === thread.projectName)
      if (mergedGroupIndex >= 0) {
        merged[mergedGroupIndex] = {
          projectName: merged[mergedGroupIndex].projectName,
          threads: [thread, ...merged[mergedGroupIndex].threads],
        }
      }
      continue
    }

    merged.push({
      projectName: thread.projectName,
      threads: [thread],
    })
  }

  return merged
}

function toProjectNameFromWorkspaceRoot(value: string): string {
  return toProjectName(value)
}

function getRemoteProjectHostLabel(hostId: string): string {
  const normalized = hostId.trim()
  if (!normalized) return ''
  const separatorIndex = normalized.lastIndexOf(':')
  return separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) : normalized
}

function getRemoteProjectDisplayName(remoteProject: NonNullable<WorkspaceRootsState['remoteProjects']>[number]): string {
  const label = remoteProject.label || toProjectName(remoteProject.remotePath) || remoteProject.id
  const hostLabel = getRemoteProjectHostLabel(remoteProject.hostId)
  return hostLabel ? `${label} ${hostLabel}` : label
}

function getRemoteProjectById(rootsState: WorkspaceRootsState | null): Map<string, NonNullable<WorkspaceRootsState['remoteProjects']>[number]> {
  const remoteProjects = rootsState?.remoteProjects ?? []
  return new Map(remoteProjects.map((project) => [project.id, project]))
}

function getWorkspaceProjectOrderPaths(rootsState: WorkspaceRootsState | null): string[] {
  if (!rootsState) return []
  const savedRoots = new Set(rootsState.order)
  const remoteProjectIds = new Set((rootsState.remoteProjects ?? []).map((project) => project.id))
  const orderedRoots = rootsState.projectOrder.filter((item) => savedRoots.has(item) || remoteProjectIds.has(item))
  for (const rootPath of rootsState.order) {
    if (!orderedRoots.includes(rootPath)) orderedRoots.push(rootPath)
  }
  for (const remoteProjectId of remoteProjectIds) {
    if (!orderedRoots.includes(remoteProjectId)) orderedRoots.push(remoteProjectId)
  }
  return orderedRoots
}

function getWorkspaceProjectOrderNames(
  rootsState: WorkspaceRootsState | null,
  duplicateLeafNames: Set<string>,
): string[] {
  const remoteProjectsById = getRemoteProjectById(rootsState)
  return getWorkspaceProjectOrderPaths(rootsState).map((rootPath) => {
    if (remoteProjectsById.has(rootPath)) return rootPath
    const normalizedRootPath = normalizePathForUi(rootPath).trim()
    const leafName = toProjectNameFromWorkspaceRoot(normalizedRootPath)
    return duplicateLeafNames.has(leafName) ? normalizedRootPath : leafName
  })
}

function matchesWorkspaceRootProject(rootPath: string, projectName: string): boolean {
  const normalizedRootPath = normalizePathForUi(rootPath).trim()
  return normalizedRootPath === projectName || toProjectNameFromWorkspaceRoot(rootPath) === projectName
}

export function collectWorkspaceRootPathsForProjectRemoval(
  rootsState: WorkspaceRootsState,
  projectName: string,
): Set<string> {
  const removedRootPaths = new Set<string>()
  for (const rootPath of rootsState.order) {
    if (matchesWorkspaceRootProject(rootPath, projectName)) {
      removedRootPaths.add(rootPath)
    }
  }
  for (const rootPath of rootsState.active) {
    if (matchesWorkspaceRootProject(rootPath, projectName)) {
      removedRootPaths.add(rootPath)
    }
  }
  for (const rootPath of Object.keys(rootsState.labels)) {
    if (matchesWorkspaceRootProject(rootPath, projectName)) {
      removedRootPaths.add(rootPath)
    }
  }
  return removedRootPaths
}

export function buildWorkspaceRootsProjectOrderState(
  rootsState: WorkspaceRootsState,
  orderedProjectNames: string[],
  groups: UiProjectGroup[],
): Pick<WorkspaceRootsState, 'order' | 'active' | 'projectOrder'> {
  const remoteProjectIds = new Set((rootsState.remoteProjects ?? []).map((project) => project.id))
  const rootByProjectName = new Map<string, string>()
  for (const rootPath of rootsState.order) {
    const projectName = toProjectNameFromWorkspaceRoot(rootPath)
    if (!rootByProjectName.has(projectName)) {
      rootByProjectName.set(projectName, rootPath)
    }
  }
  for (const group of groups) {
    const cwd = group.threads[0]?.cwd?.trim() ?? ''
    if (!cwd) continue
    rootByProjectName.set(group.projectName, cwd)
  }

  const nextProjectOrder: string[] = []
  const pushProjectOrderItem = (item: string): void => {
    if (item && !nextProjectOrder.includes(item)) {
      nextProjectOrder.push(item)
    }
  }

  for (const projectName of orderedProjectNames) {
    if (remoteProjectIds.has(projectName)) {
      pushProjectOrderItem(projectName)
      continue
    }
    const rootPath = rootByProjectName.get(projectName)
    if (rootPath) {
      pushProjectOrderItem(rootPath)
    }
  }
  for (const item of getWorkspaceProjectOrderPaths(rootsState)) {
    pushProjectOrderItem(item)
  }

  const nextOrder = nextProjectOrder.filter((item) => rootsState.order.includes(item))
  for (const rootPath of rootsState.order) {
    if (!nextOrder.includes(rootPath)) {
      nextOrder.push(rootPath)
    }
  }

  const nextActive = rootsState.active.filter((rootPath) => nextOrder.includes(rootPath))
  if (nextActive.length === 0 && nextOrder.length > 0) {
    nextActive.push(nextOrder[0])
  }

  return {
    order: nextOrder,
    active: nextActive,
    projectOrder: nextProjectOrder,
  }
}

function orderGroupsByWorkspaceProjectOrder(
  groups: UiProjectGroup[],
  rootsState: WorkspaceRootsState | null,
  duplicateLeafNames: Set<string>,
): UiProjectGroup[] {
  const order = getWorkspaceProjectOrderNames(rootsState, duplicateLeafNames)
  if (order.length === 0) return groups
  const orderIndexByName = new Map(order.map((name, index) => [name, index]))
  return [...groups].sort((first, second) => {
    if (isProjectlessGroup(first) || isProjectlessGroup(second)) return 0
    const firstIndex = orderIndexByName.get(first.projectName) ?? Number.POSITIVE_INFINITY
    const secondIndex = orderIndexByName.get(second.projectName) ?? Number.POSITIVE_INFINITY
    if (firstIndex === secondIndex) return 0
    return firstIndex - secondIndex
  })
}

function collectDuplicateProjectLeafNames(groups: UiProjectGroup[], rootsState: WorkspaceRootsState | null): Set<string> {
  const rootByLeafName = new Map<string, Set<string>>()
  const canonicalWorkspaceRootCountsByLeafName = new Map<string, number>()
  const addPath = (value: string): void => {
    const normalizedPath = normalizePathForUi(value).trim()
    if (!normalizedPath) return
    const leafName = toProjectName(normalizedPath)
    const existing = rootByLeafName.get(leafName) ?? new Set<string>()
    existing.add(normalizedPath)
    rootByLeafName.set(leafName, existing)
  }

  for (const rootPath of rootsState?.order ?? []) {
    const normalizedRootPath = normalizePathForUi(rootPath).trim()
    if (!normalizedRootPath) continue
    const leafName = toProjectName(normalizedRootPath)
    if (!isManagedCodexWorktreePath(normalizedRootPath)) {
      canonicalWorkspaceRootCountsByLeafName.set(leafName, (canonicalWorkspaceRootCountsByLeafName.get(leafName) ?? 0) + 1)
    }
    addPath(rootPath)
  }
  for (const group of groups) {
    for (const thread of group.threads) {
      const normalizedCwd = normalizePathForUi(thread.cwd).trim()
      const leafName = toProjectName(normalizedCwd)
      const isRegisteredRoot = rootsState?.order.some((rootPath) => normalizePathForUi(rootPath).trim() === normalizedCwd) === true
      if (isManagedCodexWorktreePath(normalizedCwd) && !isRegisteredRoot && canonicalWorkspaceRootCountsByLeafName.get(leafName) === 1) continue
      addPath(thread.cwd)
    }
  }

  const duplicateLeafNames = new Set<string>()
  for (const [leafName, paths] of rootByLeafName.entries()) {
    if (paths.size > 1) duplicateLeafNames.add(leafName)
  }
  return duplicateLeafNames
}

function isManagedCodexWorktreePath(value: string): boolean {
  return value.includes('/.codex/worktrees/')
}

function disambiguateProjectGroupsByCwd(
  groups: UiProjectGroup[],
  rootsState: WorkspaceRootsState | null,
): UiProjectGroup[] {
  const duplicateLeafNames = collectDuplicateProjectLeafNames(groups, rootsState)
  if (duplicateLeafNames.size === 0) return groups

  const uniqueCanonicalWorkspaceRootLeafNames = new Set<string>()
  const duplicateCanonicalWorkspaceRootLeafNames = new Set<string>()
  const canonicalWorkspaceRootByLeafName = new Map<string, string>()
  const registeredWorkspaceRoots = new Set<string>()
  for (const rootPath of rootsState?.order ?? []) {
    const normalizedRootPath = normalizePathForUi(rootPath).trim()
    if (!normalizedRootPath) continue
    registeredWorkspaceRoots.add(normalizedRootPath)
    if (isManagedCodexWorktreePath(normalizedRootPath)) continue
    const leafName = toProjectName(normalizedRootPath)
    if (uniqueCanonicalWorkspaceRootLeafNames.has(leafName)) {
      uniqueCanonicalWorkspaceRootLeafNames.delete(leafName)
      duplicateCanonicalWorkspaceRootLeafNames.add(leafName)
      canonicalWorkspaceRootByLeafName.delete(leafName)
    } else if (!duplicateCanonicalWorkspaceRootLeafNames.has(leafName)) {
      uniqueCanonicalWorkspaceRootLeafNames.add(leafName)
      canonicalWorkspaceRootByLeafName.set(leafName, normalizedRootPath)
    }
  }

  const disambiguatedGroups: UiProjectGroup[] = []
  const groupsByProjectName = new Map<string, UiProjectGroup>()
  for (const group of groups) {
    for (const thread of group.threads) {
      const normalizedCwd = normalizePathForUi(thread.cwd).trim()
      const leafName = toProjectName(normalizedCwd)
      const isRegisteredRoot = registeredWorkspaceRoots.has(normalizedCwd)
      const isCanonicalWorktreeThread = isManagedCodexWorktreePath(normalizedCwd)
        && !isRegisteredRoot
        && uniqueCanonicalWorkspaceRootLeafNames.has(leafName)
      let projectName = group.projectName
      if (isCanonicalWorktreeThread && duplicateLeafNames.has(leafName)) {
        projectName = canonicalWorkspaceRootByLeafName.get(leafName) ?? group.projectName
      } else if (normalizedCwd && duplicateLeafNames.has(leafName)) {
        projectName = normalizedCwd
      }
      const nextThread = thread.projectName === projectName ? thread : { ...thread, projectName }
      const existingGroup = groupsByProjectName.get(projectName)
      if (existingGroup) {
        existingGroup.threads.push(nextThread)
      } else {
        const nextGroup = { projectName, threads: [nextThread] }
        groupsByProjectName.set(projectName, nextGroup)
        disambiguatedGroups.push(nextGroup)
      }
    }
  }

  return disambiguatedGroups
}

function addWorkspaceRootPlaceholderGroups(
  groups: UiProjectGroup[],
  rootsState: WorkspaceRootsState | null,
  duplicateLeafNames: Set<string>,
): UiProjectGroup[] {
  if (!rootsState || (rootsState.order.length === 0 && (rootsState.remoteProjects ?? []).length === 0)) return groups
  const existingProjectNames = new Set(groups.map((group) => group.projectName))
  const nextGroups = [...groups]
  const remoteProjectsById = getRemoteProjectById(rootsState)

  for (const rootPath of getWorkspaceProjectOrderPaths(rootsState)) {
    if (remoteProjectsById.has(rootPath)) {
      if (existingProjectNames.has(rootPath)) continue
      nextGroups.push({ projectName: rootPath, threads: [] })
      existingProjectNames.add(rootPath)
      continue
    }
    const normalizedRootPath = normalizePathForUi(rootPath).trim()
    if (!normalizedRootPath) continue
    const leafName = toProjectNameFromWorkspaceRoot(normalizedRootPath)
    const projectName = duplicateLeafNames.has(leafName) ? normalizedRootPath : leafName
    if (existingProjectNames.has(projectName)) continue
    nextGroups.push({ projectName, threads: [] })
    existingProjectNames.add(projectName)
  }

  return nextGroups
}

function toOptimisticThreadTitle(message: string): string {
  const firstLine = message
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)

  if (!firstLine) return 'Untitled thread'
  return firstLine.slice(0, 80)
}

function toForkedThreadTitle(title: string): string {
  const normalizedTitle = title.trim() || 'Untitled thread'
  return /^fork:\s+/iu.test(normalizedTitle) ? normalizedTitle : `Fork: ${normalizedTitle}`
}

function isProjectlessGroup(group: UiProjectGroup): boolean {
  return group.threads.some((thread) => thread.cwd.trim().length === 0 || isProjectlessChatPath(thread.cwd))
}

export function filterGroupsByWorkspaceRoots(
  groups: UiProjectGroup[],
  rootsState: WorkspaceRootsState | null,
): UiProjectGroup[] {
  const duplicateLeafNames = collectDuplicateProjectLeafNames(groups, rootsState)
  const disambiguatedGroups = disambiguateProjectGroupsByCwd(groups, rootsState)
  const groupsWithWorkspaceRoots = addWorkspaceRootPlaceholderGroups(disambiguatedGroups, rootsState, duplicateLeafNames)
  if (!rootsState || (rootsState.order.length === 0 && (rootsState.remoteProjects ?? []).length === 0)) return groupsWithWorkspaceRoots
  const allowedProjectNames = new Set<string>()
  for (const projectName of getWorkspaceProjectOrderNames(rootsState, duplicateLeafNames)) {
    allowedProjectNames.add(projectName)
  }
  const filteredGroups = groupsWithWorkspaceRoots.filter((group) => allowedProjectNames.has(group.projectName) || isProjectlessGroup(group))
  return orderGroupsByWorkspaceProjectOrder(filteredGroups, rootsState, duplicateLeafNames)
}

export function useDesktopState() {
  const projectGroups = ref<UiProjectGroup[]>([])
  const sourceGroups = ref<UiProjectGroup[]>([])
  const selectedThreadId = ref(loadSelectedThreadId())
  const sideThreadId = ref('')
  const persistedMessagesByThreadId = ref<Record<string, UiMessage[]>>({})
  const livePlanMessagesByThreadId = ref<Record<string, UiMessage[]>>({})
  const liveAgentMessagesByThreadId = ref<Record<string, UiMessage[]>>({})
  const sideUserMessagesByThreadId = ref<Record<string, UiMessage[]>>({})
  const liveReasoningTextByThreadId = ref<Record<string, string>>({})
  const liveCommandsByThreadId = ref<Record<string, UiMessage[]>>({})
  const liveFileChangeMessagesByThreadId = ref<Record<string, UiMessage[]>>({})
  const liveCollabAgentsByThreadId = ref<Record<string, UiCollabAgentStatus[]>>({})
  const liveMcpActivitiesByThreadId = ref<Record<string, UiMcpActivity[]>>({})
  const collabAgentDisplayNameByThreadId = ref<Record<string, string>>({})
  const collabAgentParentThreadIdByThreadId = ref<Record<string, string>>({})
  const collabAgentReasoningSummaryByThreadId = ref<Record<string, string>>({})
  const inProgressById = ref<Record<string, boolean>>({})
  type FileAttachment = { label: string; path: string; fsPath: string }
  type QueuedMessage = {
    id: string
    text: string
    imageUrls: string[]
    skills: Array<{ name: string; path: string }>
    fileAttachments: FileAttachment[]
    collaborationMode: CollaborationModeKind
  }
  type SendMessageResult = 'ignored' | 'answered-request' | 'queued' | 'started'
  type SendMessageToThreadOptions = {
    imageUrls?: string[]
    skills?: Array<{ name: string; path: string }>
    fileAttachments?: FileAttachment[]
    queueInsertIndex?: number
    mode?: 'steer' | 'queue'
    collaborationModeOverride?: CollaborationModeKind
  }
  type PendingTurnRequest = {
    text: string
    imageUrls: string[]
    skills: Array<{ name: string; path: string }>
    fileAttachments: FileAttachment[]
    effort: ReasoningEffort | ''
    collaborationMode: CollaborationModeKind
    fallbackRetried: boolean
  }
  const queuedMessagesByThreadId = ref<Record<string, QueuedMessage[]>>({})
  const queueProcessingByThreadId = ref<Record<string, boolean>>({})
  let hasLoadedPersistedQueueState = false
  const eventUnreadByThreadId = ref<Record<string, boolean>>({})
  const manualUnreadByThreadId = ref<Record<string, boolean>>(loadManualUnreadMap())
  const availableModelIds = ref<string[]>([])
  const availableCollaborationModes = ref<CollaborationModeOption[]>([
    { value: 'default', label: 'Default' },
    { value: 'plan', label: 'Plan' },
  ])
  const selectedCollaborationModeByContext = ref<Record<string, CollaborationModeKind>>(
    loadSelectedCollaborationModeMap(),
  )
  const selectedModelIdByContext = ref<Record<string, string>>(loadSelectedModelMap())
  const selectedCollaborationMode = ref<CollaborationModeKind>(
    readSelectedCollaborationMode(selectedCollaborationModeByContext.value, selectedThreadId.value),
  )
  const selectedModelId = ref(readSelectedModel(selectedModelIdByContext.value, selectedThreadId.value))
  const selectedReasoningEffort = ref<ReasoningEffort | ''>('medium')
  const selectedSpeedMode = ref<SpeedMode>('standard')
  const activeProviderId = ref('')
  const codexCliMissingError = ref('')
  const readStateByThreadId = ref<Record<string, string>>(loadReadStateMap())
  const unreadCutoffIso = ref(loadUnreadCutoffIso())
  const projectOrder = ref<string[]>(loadProjectOrder())
  const projectDisplayNameById = ref<Record<string, string>>(loadProjectDisplayNames())
  const loadedVersionByThreadId = ref<Record<string, string>>({})
  const loadedMessagesByThreadId = ref<Record<string, boolean>>({})
  const hasMoreOlderMessagesByThreadId = ref<Record<string, boolean>>({})
  const loadingOlderMessagesByThreadId = ref<Record<string, boolean>>({})
  const resumedThreadById = ref<Record<string, boolean>>({})
  const turnIndexByTurnIdByThreadId = ref<Record<string, Record<string, number>>>({})
  const turnSummaryByThreadId = ref<Record<string, TurnSummaryState>>({})
  const turnActivityByThreadId = ref<Record<string, TurnActivityState>>({})
  const turnErrorByThreadId = ref<Record<string, TurnErrorState>>({})
  const activeTurnIdByThreadId = ref<Record<string, string>>({})
  const interruptBlockedUntilPersistedByThreadId = ref<Record<string, boolean>>({})
  const threadListedByServerById = ref<Record<string, boolean>>({})
  const persistedUserMessageByThreadId = ref<Record<string, boolean>>({})
  const pendingServerRequestsByThreadId = ref<Record<string, UiServerRequest[]>>({})
  const pendingTurnRequestByThreadId = ref<Record<string, PendingTurnRequest>>({})
  const codexRateLimit = ref<UiRateLimitSnapshot | null>(null)
  const threadTokenUsageByThreadId = ref<Record<string, UiThreadTokenUsage>>(loadThreadTokenUsageMap())
  const terminalOpenByThreadId = ref<Record<string, boolean>>(loadThreadTerminalOpenMap())

  const threadTitleById = ref<Record<string, string>>({})

  const installedSkills = ref<SkillInfo[]>([])
  const accountRateLimitSnapshots = ref<UiRateLimitSnapshot[]>([])

  const isLoadingThreads = ref(false)
  const isLoadingMessages = ref(false)
  const isThreadListFullyLoaded = ref(false)
  const isSendingMessage = ref(false)
  const isInterruptingTurn = ref(false)
  const isUpdatingSpeedMode = ref(false)
  const isRollingBack = ref(false)

  const error = ref('')
  const isPolling = ref(false)
  const hasLoadedThreads = ref(false)

  function extractLocalImagePathFromUrl(value: string): string {
    try {
      const parsed = new URL(value, 'http://localhost')
      if (parsed.pathname !== '/codex-local-image') return ''
      return parsed.searchParams.get('path')?.trim() ?? ''
    } catch {
      return ''
    }
  }

  function shouldReuseAttachedImageFromPrompt(promptText: string): boolean {
    const normalized = promptText.trim().toLowerCase()
    if (!normalized) return false
    return /\b(attached image|attached screenshot|save the attached|copy (the )?screenshot|save screenshot)\b/i.test(normalized)
  }

  function findLatestUserLocalImageUrl(threadId: string): string {
    const persisted = persistedMessagesByThreadId.value[threadId] ?? []
    for (let index = persisted.length - 1; index >= 0; index -= 1) {
      const message = persisted[index]
      if (message.role !== 'user' || !Array.isArray(message.images) || message.images.length === 0) continue
      for (let imageIndex = message.images.length - 1; imageIndex >= 0; imageIndex -= 1) {
        const imageUrl = message.images[imageIndex]?.trim() ?? ''
        if (!imageUrl) continue
        if (extractLocalImagePathFromUrl(imageUrl)) return imageUrl
      }
    }
    return ''
  }
  let stopNotificationStream: (() => void) | null = null
  let eventSyncTimer: number | null = null
  let rateLimitRefreshTimer: number | null = null
  const delayedTurnSyncTimerByThreadId = new Map<string, number>()
  let loadThreadsPromise: Promise<void> | null = null
  const loadMessagePromiseByThreadId = new Map<string, Promise<void>>()
  let refreshSkillsPromise: Promise<void> | null = null
  let rateLimitRefreshPromise: Promise<void> | null = null
  let pendingThreadsRefresh = false
  const pendingThreadMessageRefresh = new Set<string>()
  const lastMessageLoadAtByThreadId = new Map<string, number>()
  let threadListNextCursor: string | null = null
  let threadListBackgroundTimer: number | null = null
  let isLoadingRemainingThreadPages = false
  let hasLoadedAllThreadPages = false
  let loadedThreadListGroups: UiProjectGroup[] = []
  let loadedThreadListRootsState: WorkspaceRootsState | null = null
  let hasHydratedWorkspaceRootsState = false
  let hasUploadedLegacyReadState = false
  let activeReasoningItemId = ''
  let shouldAutoScrollOnNextAgentEvent = false
  const pendingTurnStartsById = new Map<string, TurnStartedInfo>()
  const turnDiffSummaryByTurnId = new Map<string, TurnChangeSummary>()
  const fallbackRetryInFlightThreadIds = new Set<string>()
  const previousResponseAutoContinueSignatures = new Set<string>()
  const previousResponseAutoContinueAttemptByThreadId = new Map<string, number>()
  const previousResponseAutoContinueTimerByThreadId = new Map<string, number>()
  const locallyArchivedThreadIds = new Set<string>()
  let sideUserMessageCounter = 0


  const allThreads = computed(() => flattenThreads(projectGroups.value))
  const selectedThread = computed(() =>
    allThreads.value.find((thread) => thread.id === selectedThreadId.value) ?? null,
  )
  const selectedThreadTerminalOpen = computed(() => {
    const threadId = selectedThreadId.value
    return Boolean(threadId && terminalOpenByThreadId.value[threadId] === true)
  })
  const isSelectedThreadInterruptPending = computed(() => {
    const threadId = selectedThreadId.value
    if (!threadId) return false
    return interruptBlockedUntilPersistedByThreadId.value[threadId] === true
  })
  function serverRequestsForThread(threadId: string): UiServerRequest[] {
    const rows: UiServerRequest[] = []
    const normalizedThreadId = threadId.trim()
    if (normalizedThreadId && Array.isArray(pendingServerRequestsByThreadId.value[normalizedThreadId])) {
      rows.push(...pendingServerRequestsByThreadId.value[normalizedThreadId])
    }
    if (Array.isArray(pendingServerRequestsByThreadId.value[GLOBAL_SERVER_REQUEST_SCOPE])) {
      rows.push(...pendingServerRequestsByThreadId.value[GLOBAL_SERVER_REQUEST_SCOPE])
    }
    return rows.sort((first, second) => first.receivedAtIso.localeCompare(second.receivedAtIso))
  }

  function liveOverlayForThread(threadId: string): UiLiveOverlay | null {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return null

    const requests = serverRequestsForThread(normalizedThreadId)
    const isInProgress = inProgressById.value[normalizedThreadId] === true
    const activity = isInProgress ? turnActivityByThreadId.value[normalizedThreadId] : undefined
    const reasoningText = isInProgress
      ? (liveReasoningTextByThreadId.value[normalizedThreadId] ?? '').trim()
      : ''
    const errorText = (turnErrorByThreadId.value[normalizedThreadId]?.message ?? '').trim()
    const collabAgents = isInProgress ? (liveCollabAgentsByThreadId.value[normalizedThreadId] ?? []) : []
    const mcpActivities = [
      ...(isInProgress ? (liveMcpActivitiesByThreadId.value[normalizedThreadId] ?? []) : []),
      ...buildMcpActivities(requests),
    ]

    if (!activity && !reasoningText && !errorText && collabAgents.length === 0 && mcpActivities.length === 0) return null
    return {
      activityLabel: activity?.label || 'Thinking',
      activityDetails: activity?.details ?? [],
      reasoningText,
      errorText,
      collabAgents,
      mcpActivities,
    }
  }

  const selectedThreadServerRequests = computed<UiServerRequest[]>(() => serverRequestsForThread(selectedThreadId.value))
  const selectedLiveOverlay = computed<UiLiveOverlay | null>(() => liveOverlayForThread(selectedThreadId.value))
  const sideLiveOverlay = computed<UiLiveOverlay | null>(() => liveOverlayForThread(sideThreadId.value))

  function messagesForThread(threadId: string): UiMessage[] {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return []

    const persisted = persistedMessagesByThreadId.value[normalizedThreadId] ?? []
    const persistedUserTexts = new Set(
      persisted
        .filter((message) => message.role === 'user')
        .map((message) => normalizeMessageText(message.text)),
    )
    const sideUser = (sideUserMessagesByThreadId.value[normalizedThreadId] ?? [])
      .filter((message) => !persistedUserTexts.has(normalizeMessageText(message.text)))
    const livePlan = livePlanMessagesByThreadId.value[normalizedThreadId] ?? []
    const liveAgent = liveAgentMessagesByThreadId.value[normalizedThreadId] ?? []
    const liveCommands = liveCommandsByThreadId.value[normalizedThreadId] ?? []
    const liveFileChanges = liveFileChangeMessagesByThreadId.value[normalizedThreadId] ?? []
    const combined = [...persisted, ...sideUser, ...livePlan, ...liveCommands, ...liveFileChanges, ...liveAgent]

    const summary = turnSummaryByThreadId.value[normalizedThreadId]
    if (!summary) return combined
    return insertTurnSummaryMessage(combined, summary)
  }

  const sideMessages = computed<UiMessage[]>(() => messagesForThread(sideThreadId.value))
  const sideThreadServerRequests = computed<UiServerRequest[]>(() => serverRequestsForThread(sideThreadId.value))
  const codexQuota = computed<UiRateLimitSnapshot | null>(() => codexRateLimit.value)
  const selectedThreadTokenUsage = computed<UiThreadTokenUsage | null>(() => {
    const threadId = selectedThreadId.value
    if (!threadId) return null
    return threadTokenUsageByThreadId.value[threadId] ?? null
  })
  const messages = computed<UiMessage[]>(() => messagesForThread(selectedThreadId.value))
  const hasMoreOlderMessages = computed(() => {
    const threadId = selectedThreadId.value
    return threadId ? hasMoreOlderMessagesByThreadId.value[threadId] === true : false
  })
  const isLoadingOlderMessages = computed(() => {
    const threadId = selectedThreadId.value
    return threadId ? loadingOlderMessagesByThreadId.value[threadId] === true : false
  })

  function getFirstPersistedTurnId(threadId: string): string {
    const persisted = persistedMessagesByThreadId.value[threadId] ?? []
    for (const message of persisted) {
      const turnId = message.turnId?.trim() ?? ''
      if (turnId) return turnId
    }
    return ''
  }

  function readModelIdForThread(threadId: string): string {
    const contextId = toThreadContextId(threadId)
    if (contextId === NEW_THREAD_COLLABORATION_MODE_CONTEXT) {
      const normalizedProviderId = normalizeProviderContextId(activeProviderId.value)
      if (normalizedProviderId !== 'codex') {
        const providerContextId = toProviderModelContextId(normalizedProviderId)
        return providerContextId
          ? normalizeStoredModelId(selectedModelIdByContext.value[providerContextId])
          : ''
      }
    }
    return readSelectedModel(selectedModelIdByContext.value, threadId).trim()
  }

  function ensureAvailableModelIds(...modelIds: string[]): void {
    const nextModelIds = [...availableModelIds.value]
    for (const modelId of modelIds) {
      const normalizedModelId = modelId.trim()
      if (normalizedModelId && !nextModelIds.includes(normalizedModelId)) {
        nextModelIds.push(normalizedModelId)
      }
    }
    if (!areStringArraysEqual(availableModelIds.value, nextModelIds)) {
      availableModelIds.value = nextModelIds
    }
  }

  function setSelectedThreadId(nextThreadId: string): void {
    if (selectedThreadId.value === nextThreadId) return
    selectedThreadId.value = nextThreadId
    saveSelectedThreadId(nextThreadId)
    selectedModelId.value = readModelIdForThread(nextThreadId)
    ensureAvailableModelIds(selectedModelId.value)
    selectedCollaborationMode.value = readSelectedCollaborationMode(
      selectedCollaborationModeByContext.value,
      nextThreadId,
    )
    activeReasoningItemId = ''
    shouldAutoScrollOnNextAgentEvent = false
  }

  function setSelectedModelIdForThread(threadId: string, modelId: string): void {
    const normalizedModelId = modelId.trim()
    const contextId = toThreadContextId(threadId)
    const normalizedProviderId = normalizeProviderContextId(activeProviderId.value)
    const providerContextId =
      contextId === NEW_THREAD_COLLABORATION_MODE_CONTEXT && normalizedProviderId !== 'codex'
        ? toProviderModelContextId(normalizedProviderId)
        : ''
    const selectedContextId = providerContextId || contextId
    if (normalizedModelId) {
      const nextModelMap = cloneStringKeyedRecord(selectedModelIdByContext.value)
      nextModelMap[selectedContextId] = normalizedModelId
      if (providerContextId) {
        delete nextModelMap[contextId]
      }
      selectedModelIdByContext.value = nextModelMap
    } else {
      let nextModelMap = omitStringKeyedRecordKey(selectedModelIdByContext.value, selectedContextId)
      if (providerContextId) {
        nextModelMap = omitStringKeyedRecordKey(nextModelMap, contextId)
      }
      selectedModelIdByContext.value = nextModelMap
    }
    if (threadId.trim() === selectedThreadId.value) {
      selectedModelId.value = readModelIdForThread(selectedThreadId.value)
      ensureAvailableModelIds(selectedModelId.value)
    } else {
      ensureAvailableModelIds(normalizedModelId)
    }
    saveSelectedModelMap(selectedModelIdByContext.value)
  }

  function setSelectedModelId(modelId: string): void {
    setSelectedModelIdForThread(selectedThreadId.value, modelId)
  }

  function setThreadModelId(threadId: string, modelId: string): void {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return

    const normalizedModelId = modelId.trim()
    if (normalizedModelId) {
      const nextModelMap = cloneStringKeyedRecord(selectedModelIdByContext.value)
      nextModelMap[normalizedThreadId] = normalizedModelId
      selectedModelIdByContext.value = nextModelMap
    } else {
      selectedModelIdByContext.value = omitStringKeyedRecordKey(selectedModelIdByContext.value, normalizedThreadId)
    }
    ensureAvailableModelIds(normalizedModelId)
    if (selectedThreadId.value === normalizedThreadId) {
      selectedModelId.value = readModelIdForThread(selectedThreadId.value)
    }
    saveSelectedModelMap(selectedModelIdByContext.value)
  }

  function setThreadTokenUsage(threadId: string, usage: UiThreadTokenUsage | null): void {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return

    if (!usage) {
      if (!(normalizedThreadId in threadTokenUsageByThreadId.value)) return
      threadTokenUsageByThreadId.value = omitKey(threadTokenUsageByThreadId.value, normalizedThreadId)
      saveThreadTokenUsageMap(threadTokenUsageByThreadId.value)
      return
    }

    const current = threadTokenUsageByThreadId.value[normalizedThreadId]
    if (current && JSON.stringify(current) === JSON.stringify(usage)) return

    threadTokenUsageByThreadId.value = {
      ...threadTokenUsageByThreadId.value,
      [normalizedThreadId]: usage,
    }
    saveThreadTokenUsageMap(threadTokenUsageByThreadId.value)
  }

  function setSelectedCollaborationMode(mode: CollaborationModeKind): void {
    const nextMode: CollaborationModeKind = mode === 'plan' ? 'plan' : 'default'
    const contextId = toThreadContextId(selectedThreadId.value)
    const currentMode = readSelectedCollaborationMode(selectedCollaborationModeByContext.value, selectedThreadId.value)
    if (currentMode === nextMode && selectedCollaborationMode.value === nextMode) return
    selectedCollaborationMode.value = nextMode
    selectedCollaborationModeByContext.value = writeSelectedCollaborationModeForContext(
      selectedCollaborationModeByContext.value,
      contextId,
      nextMode,
    )
    saveSelectedCollaborationModeMap(selectedCollaborationModeByContext.value)
  }

  function setSelectedCollaborationModeForThread(threadId: string, mode: CollaborationModeKind): void {
    const nextMode = mode === 'plan' ? 'plan' : 'default'
    selectedCollaborationModeByContext.value = writeSelectedCollaborationModeForContext(
      selectedCollaborationModeByContext.value,
      threadId,
      nextMode,
    )
    if (threadId.trim() === selectedThreadId.value) {
      selectedCollaborationMode.value = nextMode
    }
    saveSelectedCollaborationModeMap(selectedCollaborationModeByContext.value)
  }

  function setCodexRateLimit(nextSnapshot: UiRateLimitSnapshot | null): void {
    codexRateLimit.value = nextSnapshot
  }

  async function applyFallbackModelSelection(threadId: string = selectedThreadId.value): Promise<void> {
    if (threadId.trim()) {
      setThreadModelId(threadId, MODEL_FALLBACK_ID)
    } else {
      setSelectedModelId(MODEL_FALLBACK_ID)
    }
    ensureAvailableModelIds(MODEL_FALLBACK_ID)
  }

  function setPendingTurnRequest(threadId: string, request: PendingTurnRequest): void {
    pendingTurnRequestByThreadId.value = {
      ...pendingTurnRequestByThreadId.value,
      [threadId]: request,
    }
  }

  function clearPendingTurnRequest(threadId: string): void {
    if (!pendingTurnRequestByThreadId.value[threadId]) return
    pendingTurnRequestByThreadId.value = omitKey(pendingTurnRequestByThreadId.value, threadId)
  }



  async function retryPendingTurnWithFallback(threadId: string): Promise<void> {
    if (fallbackRetryInFlightThreadIds.has(threadId)) return
    const pending = pendingTurnRequestByThreadId.value[threadId]
    if (!pending || pending.fallbackRetried) return

    fallbackRetryInFlightThreadIds.add(threadId)
    setPendingTurnRequest(threadId, {
      ...pending,
      fallbackRetried: true,
    })

    try {
      await applyFallbackModelSelection(threadId)
      // Remove the failed user turn before replaying on fallback model to avoid duplicated user messages.
      try {
        const rolledBackMessages = await rollbackThread(threadId, 1)
        setPersistedMessagesForThread(threadId, rolledBackMessages)
        clearLivePlansForThread(threadId)
        setLiveAgentMessagesForThread(threadId, [])
        clearLiveReasoningForThread(threadId)
        clearLiveCollabAgentsForThread(threadId)
        clearLiveMcpActivitiesForThread(threadId)
        if (liveCommandsByThreadId.value[threadId]) {
          liveCommandsByThreadId.value = omitKey(liveCommandsByThreadId.value, threadId)
        }
      } catch {
        // If rollback fails, continue with retry rather than dropping the turn.
      }
      setTurnErrorForThread(threadId, null)
      error.value = ''
      setTurnSummaryForThread(threadId, null)
      setTurnActivityForThread(threadId, {
        label: 'Thinking',
        details: buildPendingTurnDetails(MODEL_FALLBACK_ID, pending.effort, pending.collaborationMode),
      })
      setThreadInProgress(threadId, true)

      if (resumedThreadById.value[threadId] !== true) {
        await resumeThread(threadId)
      }

      await startThreadTurn(
        threadId,
        pending.text,
        pending.imageUrls,
        MODEL_FALLBACK_ID,
        pending.effort || undefined,
        pending.skills.length > 0 ? pending.skills : undefined,
        pending.fileAttachments,
        pending.collaborationMode,
      )

      resumedThreadById.value = {
        ...resumedThreadById.value,
        [threadId]: true,
      }

      scheduleRateLimitRefresh()
      pendingThreadMessageRefresh.add(threadId)
      await syncFromNotifications()
    } catch (unknownError) {
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
      setTurnErrorForThread(threadId, errorMessage)
      error.value = errorMessage
      setThreadInProgress(threadId, false)
      setTurnActivityForThread(threadId, null)
    } finally {
      fallbackRetryInFlightThreadIds.delete(threadId)
    }
  }

  function clearPreviousResponseAutoContinueAttempt(threadId: string): void {
    previousResponseAutoContinueAttemptByThreadId.delete(threadId)
  }

  function schedulePreviousResponseAutoContinue(threadId: string, errorPayload: unknown): void {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId || typeof window === 'undefined') return
    if (previousResponseAutoContinueTimerByThreadId.has(normalizedThreadId)) return

    const match = classifyPreviousResponseNotFound(errorPayload)
    if (!match) return

    const signature = `${normalizedThreadId}:${match.signature}`
    if (previousResponseAutoContinueSignatures.has(signature)) return

    const attemptCount = previousResponseAutoContinueAttemptByThreadId.get(normalizedThreadId) ?? 0
    if (attemptCount > 0) return

    previousResponseAutoContinueSignatures.add(signature)
    previousResponseAutoContinueAttemptByThreadId.set(normalizedThreadId, attemptCount + 1)

    const timeoutId = window.setTimeout(() => {
      previousResponseAutoContinueTimerByThreadId.delete(normalizedThreadId)
      const autoContinueMessage = buildPreviousResponseAutoContinueMessage(match.message)
      void sendMessageToThreadInternal(
        normalizedThreadId,
        autoContinueMessage,
        [],
        [],
        'steer',
        [],
        undefined,
        undefined,
        {
          refreshThreadStatus: false,
          surfaceGlobalError: normalizedThreadId === selectedThreadId.value,
          enableAutoScroll: normalizedThreadId === selectedThreadId.value,
          requireQueuePersistence: false,
        },
      ).catch(() => {
        // Keep the original visible error; the user can still continue manually.
      })
    }, PREVIOUS_RESPONSE_AUTO_CONTINUE_DELAY_MS)

    previousResponseAutoContinueTimerByThreadId.set(normalizedThreadId, timeoutId)
  }

  function setSelectedReasoningEffort(effort: ReasoningEffort | ''): void {
    if (effort && !REASONING_EFFORT_OPTIONS.includes(effort)) {
      return
    }
    selectedReasoningEffort.value = effort
  }

  async function updateSelectedSpeedMode(mode: SpeedMode): Promise<void> {
    const nextMode: SpeedMode = mode === 'fast' ? 'fast' : 'standard'
    if (isUpdatingSpeedMode.value || selectedSpeedMode.value === nextMode) {
      return
    }

    const previousMode = selectedSpeedMode.value
    selectedSpeedMode.value = nextMode
    isUpdatingSpeedMode.value = true
    error.value = ''

    try {
      await setCodexSpeedMode(nextMode)
    } catch (unknownError) {
      selectedSpeedMode.value = previousMode
      error.value = unknownError instanceof Error ? unknownError.message : 'Failed to update Fast mode'
    } finally {
      isUpdatingSpeedMode.value = false
    }
  }

  async function refreshCollaborationModes(): Promise<void> {
    try {
      const modes = await getAvailableCollaborationModes()
      availableCollaborationModes.value = modes
      if (!modes.some((mode) => mode.value === selectedCollaborationMode.value)) {
        setSelectedCollaborationMode('default')
      }
    } catch {
      // Keep the last known collaboration mode choices on transient failures.
    }
  }

  function buildPendingTurnDetails(
    modelId: string,
    effort: ReasoningEffort | '',
    collaborationMode: CollaborationModeKind = selectedCollaborationMode.value,
  ): string[] {
    const modelLabel = modelId.trim() || 'default'
    const effortLabel = effort || 'default'
    const modeLabel = collaborationMode === 'plan' ? 'Plan' : 'Default'
    const speedLabel = selectedSpeedMode.value === 'fast' ? 'Fast' : 'Standard'
    return [`Mode: ${modeLabel}`, `Model: ${modelLabel}`, `Thinking: ${effortLabel}`, `Speed: ${speedLabel}`]
  }

  async function refreshModelPreferences(options?: { providerChanged?: boolean; includeProviderModels?: boolean }): Promise<void> {
    codexCliMissingError.value = ''
    try {
      const currentConfig = await getCurrentModelConfig()
      const normalizedConfiguredModelId = currentConfig.model.trim()
      const normalizedProviderId = normalizeProviderContextId(currentConfig.providerId)
      const isProviderBacked = normalizedProviderId !== 'codex'
      activeProviderId.value = normalizedProviderId
      const normalizedSelectedModelId = readModelIdForThread(selectedThreadId.value)
      const modelIds = await getAvailableModelIds({
        includeProviderModels: options?.includeProviderModels !== false || isProviderBacked,
        requireProviderModels: isProviderBacked,
      })
      const providerModelContextId = toProviderModelContextId(normalizedProviderId)
      const providerScopedModelId = providerModelContextId
        ? normalizeStoredModelId(selectedModelIdByContext.value[providerModelContextId])
        : ''
      const nextModelIds = [...modelIds]
      if (!options?.providerChanged) {
        const extraModelIds = isProviderBacked ? [normalizedConfiguredModelId] : [normalizedSelectedModelId, normalizedConfiguredModelId]
        for (const modelId of extraModelIds) {
          if (modelId && !nextModelIds.includes(modelId)) {
            nextModelIds.push(modelId)
          }
        }
      }
      availableModelIds.value = nextModelIds

      const currentModelInNewList = normalizedSelectedModelId && modelIds.includes(normalizedSelectedModelId)
      if (!normalizedSelectedModelId || !currentModelInNewList || options?.providerChanged) {
        if (options?.providerChanged && nextModelIds.length > 0) {
          if (providerScopedModelId && modelIds.includes(providerScopedModelId)) {
            setSelectedModelId(providerScopedModelId)
          } else if (normalizedConfiguredModelId && nextModelIds.includes(normalizedConfiguredModelId)) {
            setSelectedModelId(normalizedConfiguredModelId)
          } else {
            setSelectedModelId(nextModelIds[0])
          }
        } else if (normalizedConfiguredModelId && nextModelIds.includes(normalizedConfiguredModelId)) {
          setSelectedModelId(currentConfig.model)
        } else if (nextModelIds.length > 0) {
          setSelectedModelId(nextModelIds[0])
        } else {
          setSelectedModelId('')
        }
      } else if (selectedModelId.value.trim() !== normalizedSelectedModelId) {
        setSelectedModelId(normalizedSelectedModelId)
      }
      if (providerModelContextId && selectedModelId.value.trim().length > 0) {
        const nextModelMap = cloneStringKeyedRecord(selectedModelIdByContext.value)
        nextModelMap[providerModelContextId] = selectedModelId.value.trim()
        selectedModelIdByContext.value = nextModelMap
        saveSelectedModelMap(selectedModelIdByContext.value)
      }

      if (
        currentConfig.reasoningEffort &&
        REASONING_EFFORT_OPTIONS.includes(currentConfig.reasoningEffort)
      ) {
        selectedReasoningEffort.value = currentConfig.reasoningEffort
      }
      selectedSpeedMode.value = currentConfig.speedMode
    } catch (unknownError) {
      if (isCodexCliMissingError(unknownError)) {
        codexCliMissingError.value = CODEX_CLI_MISSING_MESSAGE
      } else {
        codexCliMissingError.value = ''
      }
      // Keep chat UI usable even if model metadata is temporarily unavailable.
    }
  }

  async function refreshRateLimits(): Promise<void> {
    if (rateLimitRefreshPromise) {
      await rateLimitRefreshPromise
      return
    }

    rateLimitRefreshPromise = (async () => {
      try {
        const snapshot = await getAccountRateLimits()
        setCodexRateLimit(snapshot)
        accountRateLimitSnapshots.value = snapshot ? [snapshot] : []
      } catch {
        // Keep the last known rate-limit state if the endpoint is temporarily unavailable.
      } finally {
        rateLimitRefreshPromise = null
      }
    })()

    await rateLimitRefreshPromise
  }

  function scheduleRateLimitRefresh(): void {
    if (typeof window === 'undefined') {
      void refreshRateLimits()
      return
    }

    if (rateLimitRefreshTimer !== null) {
      window.clearTimeout(rateLimitRefreshTimer)
    }

    rateLimitRefreshTimer = window.setTimeout(() => {
      rateLimitRefreshTimer = null
      void refreshRateLimits()
    }, RATE_LIMIT_REFRESH_DEBOUNCE_MS)
  }

  function clearDelayedTurnSync(threadId: string): void {
    if (!threadId || typeof window === 'undefined') return
    const timerId = delayedTurnSyncTimerByThreadId.get(threadId)
    if (timerId === undefined) return
    window.clearTimeout(timerId)
    delayedTurnSyncTimerByThreadId.delete(threadId)
  }

  function scheduleDelayedTurnSync(threadId: string): void {
    if (!threadId || typeof window === 'undefined') return
    clearDelayedTurnSync(threadId)
    const timerId = window.setTimeout(() => {
      delayedTurnSyncTimerByThreadId.delete(threadId)
      pendingThreadMessageRefresh.add(threadId)
      void syncFromNotifications()
    }, TURN_START_FOLLOW_UP_SYNC_DELAY_MS)
    delayedTurnSyncTimerByThreadId.set(threadId, timerId)
  }

  function applyCachedTitlesToGroups(groups: UiProjectGroup[]): UiProjectGroup[] {
    const titles = threadTitleById.value
    if (Object.keys(titles).length === 0) return groups
    return groups.map((group) => ({
      projectName: group.projectName,
      threads: group.threads.map((thread) => {
        const cached = titles[thread.id]
        return cached ? { ...thread, title: cached } : thread
      }),
    }))
  }

  function getThreadPendingRequests(threadId: string): UiServerRequest[] {
    if (!threadId) return []
    return Array.isArray(pendingServerRequestsByThreadId.value[threadId])
      ? pendingServerRequestsByThreadId.value[threadId]
      : []
  }

  function isApprovalRequestMethod(method: string): boolean {
    return (
      method === 'item/commandExecution/requestApproval' ||
      method === 'item/fileChange/requestApproval' ||
      method === 'item/permissions/requestApproval' ||
      method === 'execCommandApproval' ||
      method === 'applyPatchApproval'
    )
  }

  function readPendingRequestState(requests: UiServerRequest[]): UiPendingRequestState | null {
    if (requests.some((request) => isApprovalRequestMethod(request.method))) {
      return 'approval'
    }
    return requests.length > 0 ? 'response' : null
  }

  function findSourceThread(threadId: string): UiThread | null {
    if (!threadId) return null
    for (const thread of flattenThreads(sourceGroups.value)) {
      if (thread.id === threadId) return thread
    }
    return null
  }

  function persistManualUnreadState(nextState: Record<string, boolean>): void {
    manualUnreadByThreadId.value = nextState
    saveManualUnreadMap(nextState)
  }

  function setManualUnread(threadId: string, isUnread: boolean): void {
    if (isUnread) {
      if (manualUnreadByThreadId.value[threadId] === true) return
      persistManualUnreadState({
        ...manualUnreadByThreadId.value,
        [threadId]: true,
      })
      return
    }

    if (!manualUnreadByThreadId.value[threadId]) return
    persistManualUnreadState(omitKey(manualUnreadByThreadId.value, threadId))
  }

  function applyThreadFlags(): void {
    const withTitles = applyCachedTitlesToGroups(sourceGroups.value)
    const flaggedGroups: UiProjectGroup[] = withTitles.map((group) => ({
      projectName: group.projectName,
      threads: group.threads.map((thread) => {
        const inProgress = inProgressById.value[thread.id] === true
        const pendingRequestState = readPendingRequestState(getThreadPendingRequests(thread.id))
        const isSelected = selectedThreadId.value === thread.id
        const unreadByEvent = eventUnreadByThreadId.value[thread.id] === true
        const unreadByManualAction = manualUnreadByThreadId.value[thread.id] === true
        const unreadByTime = isThreadUnreadByLastRead(
          thread.updatedAtIso,
          readStateByThreadId.value[thread.id],
          unreadCutoffIso.value,
        )
        const unread = !isSelected && !inProgress && (unreadByManualAction || unreadByEvent || unreadByTime)

        return {
          ...thread,
          inProgress,
          unread,
          pendingRequestState,
        }
      }),
    }))
    projectGroups.value = mergeThreadGroups(projectGroups.value, flaggedGroups)
  }

  function insertOptimisticThread(threadId: string, cwd: string, firstMessageText: string): void {
    const nowIso = new Date().toISOString()
    const normalizedCwd = normalizePathForUi(cwd)
    const projectName = toProjectName(normalizedCwd)
    const nextThread: UiThread = {
      id: threadId,
      title: toOptimisticThreadTitle(firstMessageText),
      projectName,
      cwd: normalizedCwd,
      hasWorktree: normalizedCwd.includes('/.codex/worktrees/') || normalizedCwd.includes('/.git/worktrees/'),
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
      preview: firstMessageText,
      unread: false,
      inProgress: false,
    }

    const existingGroupIndex = sourceGroups.value.findIndex((group) => group.projectName === projectName)
    if (existingGroupIndex >= 0) {
      const existingGroup = sourceGroups.value[existingGroupIndex]
      const remainingThreads = existingGroup.threads.filter((thread) => thread.id !== threadId)
      const nextGroup: UiProjectGroup = {
        projectName,
        threads: [nextThread, ...remainingThreads],
      }
      const nextGroups = [...sourceGroups.value]
      nextGroups.splice(existingGroupIndex, 1, nextGroup)
      sourceGroups.value = nextGroups
    } else {
      sourceGroups.value = [{ projectName, threads: [nextThread] }, ...sourceGroups.value]
    }

    const nextProjectOrder = mergeProjectOrder(projectOrder.value, sourceGroups.value)
    if (!areStringArraysEqual(projectOrder.value, nextProjectOrder)) {
      projectOrder.value = nextProjectOrder
      saveProjectOrder(projectOrder.value)
    }
    applyThreadFlags()
  }

  function pruneThreadScopedState(flatThreads: UiThread[]): void {
    const activeThreadIds = new Set(flatThreads.map((thread) => thread.id))
    const currentThreadId = selectedThreadId.value.trim()
    if (currentThreadId) {
      activeThreadIds.add(currentThreadId)
    }
    const activeSideThreadId = sideThreadId.value.trim()
    if (activeSideThreadId) {
      activeThreadIds.add(activeSideThreadId)
    }
    const nextSelectedModelMap = pruneThreadContextStateMap(selectedModelIdByContext.value, activeThreadIds)
    if (nextSelectedModelMap !== selectedModelIdByContext.value) {
      selectedModelIdByContext.value = nextSelectedModelMap
      selectedModelId.value = readModelIdForThread(selectedThreadId.value)
      ensureAvailableModelIds(selectedModelId.value)
      saveSelectedModelMap(nextSelectedModelMap)
    }
    const nextSelectedCollaborationModeMap = pruneThreadContextStateMap(
      selectedCollaborationModeByContext.value,
      activeThreadIds,
    )
    if (nextSelectedCollaborationModeMap !== selectedCollaborationModeByContext.value) {
      selectedCollaborationModeByContext.value = nextSelectedCollaborationModeMap
      selectedCollaborationMode.value = readSelectedCollaborationMode(
        nextSelectedCollaborationModeMap,
        selectedThreadId.value,
      )
      saveSelectedCollaborationModeMap(nextSelectedCollaborationModeMap)
    }
    const nextReadState = pruneThreadStateMap(readStateByThreadId.value, activeThreadIds)
    if (nextReadState !== readStateByThreadId.value) {
      readStateByThreadId.value = nextReadState
      saveReadStateMap(nextReadState)
    }
    loadedMessagesByThreadId.value = pruneThreadStateMap(loadedMessagesByThreadId.value, activeThreadIds)
    loadedVersionByThreadId.value = pruneThreadStateMap(loadedVersionByThreadId.value, activeThreadIds)
    resumedThreadById.value = pruneThreadStateMap(resumedThreadById.value, activeThreadIds)
    turnIndexByTurnIdByThreadId.value = pruneThreadStateMap(turnIndexByTurnIdByThreadId.value, activeThreadIds)
    persistedMessagesByThreadId.value = pruneThreadStateMap(persistedMessagesByThreadId.value, activeThreadIds)
    sideUserMessagesByThreadId.value = pruneThreadStateMap(sideUserMessagesByThreadId.value, activeThreadIds)
    liveAgentMessagesByThreadId.value = pruneThreadStateMap(liveAgentMessagesByThreadId.value, activeThreadIds)
    liveReasoningTextByThreadId.value = pruneThreadStateMap(liveReasoningTextByThreadId.value, activeThreadIds)
    liveCommandsByThreadId.value = pruneThreadStateMap(liveCommandsByThreadId.value, activeThreadIds)
    liveFileChangeMessagesByThreadId.value = pruneThreadStateMap(liveFileChangeMessagesByThreadId.value, activeThreadIds)
    liveCollabAgentsByThreadId.value = pruneThreadStateMap(liveCollabAgentsByThreadId.value, activeThreadIds)
    liveMcpActivitiesByThreadId.value = pruneThreadStateMap(liveMcpActivitiesByThreadId.value, activeThreadIds)
    turnSummaryByThreadId.value = pruneThreadStateMap(turnSummaryByThreadId.value, activeThreadIds)
    turnActivityByThreadId.value = pruneThreadStateMap(turnActivityByThreadId.value, activeThreadIds)
    turnErrorByThreadId.value = pruneThreadStateMap(turnErrorByThreadId.value, activeThreadIds)
    activeTurnIdByThreadId.value = pruneThreadStateMap(activeTurnIdByThreadId.value, activeThreadIds)
    interruptBlockedUntilPersistedByThreadId.value = pruneThreadStateMap(
      interruptBlockedUntilPersistedByThreadId.value,
      activeThreadIds,
    )
    threadListedByServerById.value = pruneThreadStateMap(threadListedByServerById.value, activeThreadIds)
    persistedUserMessageByThreadId.value = pruneThreadStateMap(persistedUserMessageByThreadId.value, activeThreadIds)
    const nextQueuedMessages = pruneThreadStateMap(queuedMessagesByThreadId.value, activeThreadIds)
    if (nextQueuedMessages !== queuedMessagesByThreadId.value) {
      queuedMessagesByThreadId.value = nextQueuedMessages
      persistQueueState()
    }
    threadTokenUsageByThreadId.value = pruneThreadStateMap(threadTokenUsageByThreadId.value, activeThreadIds)
    eventUnreadByThreadId.value = pruneThreadStateMap(eventUnreadByThreadId.value, activeThreadIds)
    const nextManualUnread = pruneThreadStateMap(manualUnreadByThreadId.value, activeThreadIds)
    if (nextManualUnread !== manualUnreadByThreadId.value) {
      persistManualUnreadState(nextManualUnread)
    }
    inProgressById.value = pruneThreadStateMap(inProgressById.value, activeThreadIds)
    const nextPending: Record<string, UiServerRequest[]> = {}
    for (const [threadId, requests] of Object.entries(pendingServerRequestsByThreadId.value)) {
      if (threadId === GLOBAL_SERVER_REQUEST_SCOPE || activeThreadIds.has(threadId)) {
        nextPending[threadId] = requests
      }
    }
    pendingServerRequestsByThreadId.value = nextPending
  }

  function markThreadAsRead(threadId: string): void {
    const thread = findSourceThread(threadId)
    if (!thread) return

    if (readStateByThreadId.value[threadId] !== thread.updatedAtIso) {
      readStateByThreadId.value = {
        ...readStateByThreadId.value,
        [threadId]: thread.updatedAtIso,
      }
      saveReadStateMap(readStateByThreadId.value)
      void persistThreadReadState({ threadId, readAtIso: thread.updatedAtIso })
    }
    if (eventUnreadByThreadId.value[threadId]) {
      eventUnreadByThreadId.value = omitKey(eventUnreadByThreadId.value, threadId)
    }
    setManualUnread(threadId, false)
    applyThreadFlags()
  }

  function markThreadAsUnread(threadId: string): void {
    if (!findSourceThread(threadId)) return
    setManualUnread(threadId, true)
    applyThreadFlags()
  }

  function setTurnSummaryForThread(threadId: string, summary: TurnSummaryState | null): void {
    if (!threadId) return

    const previous = turnSummaryByThreadId.value[threadId]
    if (summary) {
      if (areTurnSummariesEqual(previous, summary)) return
      turnSummaryByThreadId.value = {
        ...turnSummaryByThreadId.value,
        [threadId]: summary,
      }
    } else {
      if (previous) {
        turnSummaryByThreadId.value = omitKey(turnSummaryByThreadId.value, threadId)
      }
    }
  }

  function setThreadInProgress(threadId: string, nextInProgress: boolean): void {
    if (!threadId) return
    const currentValue = inProgressById.value[threadId] === true
    if (currentValue === nextInProgress) return
    if (nextInProgress) {
      inProgressById.value = {
        ...inProgressById.value,
        [threadId]: true,
      }
    } else {
      inProgressById.value = omitKey(inProgressById.value, threadId)
      clearCompletedTurnLiveState(threadId)
      clearInterruptPersistenceGate(threadId)
    }
    applyThreadFlags()
    if (!nextInProgress && !hasActiveInProgressThreads() && threadListNextCursor) {
      scheduleRemainingThreadPages()
    }
  }

  function clearInterruptPersistenceGate(threadId: string): void {
    if (!threadId) return
    if (interruptBlockedUntilPersistedByThreadId.value[threadId]) {
      interruptBlockedUntilPersistedByThreadId.value = omitKey(interruptBlockedUntilPersistedByThreadId.value, threadId)
    }
    if (threadListedByServerById.value[threadId]) {
      threadListedByServerById.value = omitKey(threadListedByServerById.value, threadId)
    }
    if (persistedUserMessageByThreadId.value[threadId]) {
      persistedUserMessageByThreadId.value = omitKey(persistedUserMessageByThreadId.value, threadId)
    }
  }

  function blockInterruptUntilThreadIsPersisted(threadId: string): void {
    if (!threadId) return
    interruptBlockedUntilPersistedByThreadId.value = {
      ...interruptBlockedUntilPersistedByThreadId.value,
      [threadId]: true,
    }
    if (threadListedByServerById.value[threadId]) {
      threadListedByServerById.value = omitKey(threadListedByServerById.value, threadId)
    }
    if (persistedUserMessageByThreadId.value[threadId]) {
      persistedUserMessageByThreadId.value = omitKey(persistedUserMessageByThreadId.value, threadId)
    }
  }

  function maybeUnblockInterruptForPersistedThread(threadId: string): void {
    if (!threadId) return
    if (interruptBlockedUntilPersistedByThreadId.value[threadId] !== true) return
    if (threadListedByServerById.value[threadId] !== true) return
    if (persistedUserMessageByThreadId.value[threadId] !== true) return
    clearInterruptPersistenceGate(threadId)
  }

  function maybeUnblockInterruptForActiveTurn(threadId: string, turnId: string): void {
    if (!threadId || !turnId) return
    if (interruptBlockedUntilPersistedByThreadId.value[threadId] !== true) return
    clearInterruptPersistenceGate(threadId)
  }

  function markServerListedThreads(serverThreadIds: Set<string>): void {
    const pendingThreadIds = Object.keys(interruptBlockedUntilPersistedByThreadId.value)
    if (pendingThreadIds.length === 0) return

    let nextListedState = threadListedByServerById.value
    let changed = false
    for (const threadId of pendingThreadIds) {
      if (!serverThreadIds.has(threadId) || nextListedState[threadId] === true) continue
      nextListedState = {
        ...nextListedState,
        [threadId]: true,
      }
      changed = true
    }

    if (!changed) return
    threadListedByServerById.value = nextListedState
    for (const threadId of pendingThreadIds) {
      maybeUnblockInterruptForPersistedThread(threadId)
    }
  }

  function markThreadMessagesPersisted(threadId: string, messages: UiMessage[]): void {
    if (!threadId) return
    if (interruptBlockedUntilPersistedByThreadId.value[threadId] !== true) return
    if (!messages.some((message) => message.role === 'user')) return
    if (persistedUserMessageByThreadId.value[threadId] !== true) {
      persistedUserMessageByThreadId.value = {
        ...persistedUserMessageByThreadId.value,
        [threadId]: true,
      }
    }
    maybeUnblockInterruptForPersistedThread(threadId)
  }

  function markThreadUnreadByEvent(threadId: string): void {
    if (!threadId) return
    if (threadId === selectedThreadId.value) return
    if (eventUnreadByThreadId.value[threadId] === true) return
    eventUnreadByThreadId.value = {
      ...eventUnreadByThreadId.value,
      [threadId]: true,
    }
    applyThreadFlags()
  }

  function setTurnActivityForThread(threadId: string, activity: TurnActivityState | null): void {
    if (!threadId) return

    const previous = turnActivityByThreadId.value[threadId]
    if (!activity) {
      if (previous) {
        turnActivityByThreadId.value = omitKey(turnActivityByThreadId.value, threadId)
      }
      return
    }

    const normalizedLabel = sanitizeDisplayText(activity.label) || 'Thinking'
    const incomingDetails = activity.details
      .map((line) => sanitizeDisplayText(line))
      .filter((line) => line.length > 0 && line !== normalizedLabel)
    const mergedDetails = Array.from(new Set([...(previous?.details ?? []), ...incomingDetails])).slice(-3)
    const nextActivity: TurnActivityState = {
      label: normalizedLabel,
      details: mergedDetails,
    }

    if (areTurnActivitiesEqual(previous, nextActivity)) return
    turnActivityByThreadId.value = {
      ...turnActivityByThreadId.value,
      [threadId]: nextActivity,
    }
  }

  function setTurnErrorForThread(
    threadId: string,
    message: string | null,
    options: { transient?: boolean } = {},
  ): void {
    if (!threadId) return

    const previous = turnErrorByThreadId.value[threadId]
    const normalizedMessage = message ? normalizeMessageText(message) : ''
    if (!normalizedMessage) {
      if (previous) {
        turnErrorByThreadId.value = omitKey(turnErrorByThreadId.value, threadId)
      }
      return
    }

    const transient = options.transient === true
    if (previous?.message === normalizedMessage && previous.transient === transient) return

    turnErrorByThreadId.value = {
      ...turnErrorByThreadId.value,
      [threadId]: { message: normalizedMessage, transient },
    }
  }

  function clearTransientTurnErrorForThread(threadId: string): void {
    if (!threadId) return
    if (!turnErrorByThreadId.value[threadId]?.transient) return
    setTurnErrorForThread(threadId, null)
  }

  function clearAllTransientTurnErrors(): void {
    const transientThreadIds = Object.entries(turnErrorByThreadId.value)
      .filter(([, state]) => state?.transient)
      .map(([threadId]) => threadId)
    if (transientThreadIds.length === 0) return

    let nextState = turnErrorByThreadId.value
    for (const threadId of transientThreadIds) {
      nextState = omitKey(nextState, threadId)
    }
    turnErrorByThreadId.value = nextState
  }

  function currentThreadVersion(threadId: string): string {
    const thread = flattenThreads(sourceGroups.value).find((row) => row.id === threadId)
    return thread?.updatedAtIso ?? ''
  }

  function setThreadTerminalOpen(threadId: string, isOpen: boolean): void {
    if (!threadId) return
    const next = { ...terminalOpenByThreadId.value }
    if (isOpen) {
      next[threadId] = true
    } else {
      delete next[threadId]
    }
    terminalOpenByThreadId.value = next
    saveThreadTerminalOpenMap(next)
  }

  function toggleSelectedThreadTerminal(): void {
    const threadId = selectedThreadId.value
    if (!threadId) return
    setThreadTerminalOpen(threadId, !selectedThreadTerminalOpen.value)
  }

  function setPersistedMessagesForThread(threadId: string, nextMessages: UiMessage[]): void {
    const previous = persistedMessagesByThreadId.value[threadId] ?? []
    if (areMessageArraysEqual(previous, nextMessages)) return
    persistedMessagesByThreadId.value = {
      ...persistedMessagesByThreadId.value,
      [threadId]: nextMessages,
    }
  }

  function appendSideUserMessage(threadId: string, text: string): string {
    const normalizedThreadId = threadId.trim()
    const normalizedText = text.trim()
    if (!normalizedThreadId || !normalizedText) return ''
    sideUserMessageCounter += 1
    const messageId = `side-user:${normalizedThreadId}:${sideUserMessageCounter}`
    const previous = sideUserMessagesByThreadId.value[normalizedThreadId] ?? []
    sideUserMessagesByThreadId.value = {
      ...sideUserMessagesByThreadId.value,
      [normalizedThreadId]: [
        ...previous,
        {
          id: messageId,
          role: 'user',
          text: normalizedText,
          messageType: 'sideUser.optimistic',
        },
      ],
    }
    return messageId
  }

  function removeSideUserMessage(threadId: string, messageId: string): void {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId || !messageId) return
    const previous = sideUserMessagesByThreadId.value[normalizedThreadId] ?? []
    const next = previous.filter((message) => message.id !== messageId)
    if (next.length === previous.length) return
    sideUserMessagesByThreadId.value = next.length > 0
      ? { ...sideUserMessagesByThreadId.value, [normalizedThreadId]: next }
      : omitKey(sideUserMessagesByThreadId.value, normalizedThreadId)
  }

  function setLiveAgentMessagesForThread(threadId: string, nextMessages: UiMessage[]): void {
    const previous = liveAgentMessagesByThreadId.value[threadId] ?? []
    if (areMessageArraysEqual(previous, nextMessages)) return
    liveAgentMessagesByThreadId.value = {
      ...liveAgentMessagesByThreadId.value,
      [threadId]: nextMessages,
    }
  }

  function clearLiveAgentMessagesForThread(threadId: string): void {
    if (!threadId) return
    if (!(threadId in liveAgentMessagesByThreadId.value)) return
    liveAgentMessagesByThreadId.value = omitKey(liveAgentMessagesByThreadId.value, threadId)
  }

  function setLiveFileChangeMessagesForThread(threadId: string, nextMessages: UiMessage[]): void {
    const previous = liveFileChangeMessagesByThreadId.value[threadId] ?? []
    if (areMessageArraysEqual(previous, nextMessages)) return
    liveFileChangeMessagesByThreadId.value = {
      ...liveFileChangeMessagesByThreadId.value,
      [threadId]: nextMessages,
    }
  }

  function setLivePlanMessagesForThread(threadId: string, nextMessages: UiMessage[]): void {
    const previous = livePlanMessagesByThreadId.value[threadId] ?? []
    if (areMessageArraysEqual(previous, nextMessages)) return
    livePlanMessagesByThreadId.value = {
      ...livePlanMessagesByThreadId.value,
      [threadId]: nextMessages,
    }
  }

  function upsertLivePlanMessage(threadId: string, nextMessage: UiMessage): void {
    const previous = livePlanMessagesByThreadId.value[threadId] ?? []
    const next = upsertMessage(previous, nextMessage)
    setLivePlanMessagesForThread(threadId, next)
  }

  function upsertLiveAgentMessage(threadId: string, nextMessage: UiMessage): void {
    const previous = liveAgentMessagesByThreadId.value[threadId] ?? []
    const next = upsertMessage(previous, nextMessage)
    setLiveAgentMessagesForThread(threadId, next)
  }

  function upsertLiveFileChangeMessage(threadId: string, nextMessage: UiMessage): void {
    const previous = liveFileChangeMessagesByThreadId.value[threadId] ?? []
    const next = upsertMessage(previous, nextMessage)
    setLiveFileChangeMessagesForThread(threadId, next)
  }

  function setLiveCollabAgentsForThread(threadId: string, agents: UiCollabAgentStatus[]): void {
    if (!threadId) return
    const previous = liveCollabAgentsByThreadId.value[threadId] ?? []
    if (areCollabAgentRowsEqual(previous, agents)) return
    if (agents.length === 0) {
      liveCollabAgentsByThreadId.value = omitKey(liveCollabAgentsByThreadId.value, threadId)
      return
    }
    liveCollabAgentsByThreadId.value = {
      ...liveCollabAgentsByThreadId.value,
      [threadId]: agents,
    }
  }

  function clearLiveCollabAgentsForThread(threadId: string): void {
    if (!threadId || !(threadId in liveCollabAgentsByThreadId.value)) return
    liveCollabAgentsByThreadId.value = omitKey(liveCollabAgentsByThreadId.value, threadId)
  }

  const pendingCollabAgentNameLookupIds = new Set<string>()

  function setCollabAgentDisplayName(agentThreadId: string, displayName: string): void {
    const normalizedAgentThreadId = agentThreadId.trim()
    const normalizedDisplayName = sanitizeDisplayText(displayName)
    if (!normalizedAgentThreadId || !normalizedDisplayName) return
    if (collabAgentDisplayNameByThreadId.value[normalizedAgentThreadId] === normalizedDisplayName) return

    collabAgentDisplayNameByThreadId.value = {
      ...collabAgentDisplayNameByThreadId.value,
      [normalizedAgentThreadId]: normalizedDisplayName,
    }

    let changed = false
    const nextByThread: Record<string, UiCollabAgentStatus[]> = {}
    for (const [threadId, agents] of Object.entries(liveCollabAgentsByThreadId.value)) {
      nextByThread[threadId] = agents.map((agent) => {
        if (agent.id !== normalizedAgentThreadId || agent.name === normalizedDisplayName) return agent
        changed = true
        return { ...agent, name: normalizedDisplayName }
      })
    }
    if (changed) {
      liveCollabAgentsByThreadId.value = nextByThread
    }
  }

  function rememberCollabAgentMetadata(thread: unknown): void {
    const record = asRecord(thread)
    const threadId = readString(record?.id)
    if (!threadId) return

    const displayName = readThreadAgentDisplayName(thread)
    if (displayName) {
      setCollabAgentDisplayName(threadId, displayName)
    }

    const parentThreadId = readThreadSubagentParentId(thread)
    if (parentThreadId && collabAgentParentThreadIdByThreadId.value[threadId] !== parentThreadId) {
      collabAgentParentThreadIdByThreadId.value = {
        ...collabAgentParentThreadIdByThreadId.value,
        [threadId]: parentThreadId,
      }
    }
  }

  function rememberCollabAgentMetadataFromGroups(groups: UiProjectGroup[]): void {
    for (const thread of flattenThreads(groups)) {
      if (thread.agentDisplayName) {
        setCollabAgentDisplayName(thread.id, thread.agentDisplayName)
      }
    }
  }

  function rememberCollabAgentParents(parentThreadId: string, item: Record<string, unknown>): void {
    const senderThreadId = readString(item.senderThreadId) || parentThreadId
    const receiverThreadIds = Array.isArray(item.receiverThreadIds)
      ? item.receiverThreadIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : []
    if (!senderThreadId || receiverThreadIds.length === 0) return

    let changed = false
    const next = { ...collabAgentParentThreadIdByThreadId.value }
    for (const receiverThreadId of receiverThreadIds) {
      if (next[receiverThreadId] === senderThreadId) continue
      next[receiverThreadId] = senderThreadId
      changed = true
    }
    if (changed) {
      collabAgentParentThreadIdByThreadId.value = next
    }
  }

  function updateLiveCollabAgent(
    agentThreadId: string,
    update: { task?: string; status?: UiCollabAgentStatus['status'] },
  ): void {
    const parentThreadId = collabAgentParentThreadIdByThreadId.value[agentThreadId]
    if (!parentThreadId) return
    const currentAgents = liveCollabAgentsByThreadId.value[parentThreadId] ?? []
    if (currentAgents.length === 0) return

    const displayName = collabAgentDisplayNameByThreadId.value[agentThreadId] ?? ''
    const nextTask = update.task !== undefined ? sanitizeDisplayText(update.task) : undefined
    const nextAgents = currentAgents.map((agent) => {
      if (agent.id !== agentThreadId) return agent
      return {
        ...agent,
        ...(displayName ? { name: displayName } : {}),
        ...(nextTask ? { task: nextTask } : {}),
        ...(update.status ? { status: update.status } : {}),
      }
    })
    setLiveCollabAgentsForThread(parentThreadId, nextAgents)
  }

  function scheduleCollabAgentNameLookup(agentThreadId: string): void {
    const normalizedAgentThreadId = agentThreadId.trim()
    if (!normalizedAgentThreadId || collabAgentDisplayNameByThreadId.value[normalizedAgentThreadId]) return
    if (pendingCollabAgentNameLookupIds.has(normalizedAgentThreadId)) return
    pendingCollabAgentNameLookupIds.add(normalizedAgentThreadId)
    void getThreadSummary(normalizedAgentThreadId)
      .then((thread) => {
        if (thread.agentDisplayName) {
          setCollabAgentDisplayName(normalizedAgentThreadId, thread.agentDisplayName)
        }
      })
      .catch(() => {
        // Some sub-agent threads may already be closed or omitted from the list.
      })
      .finally(() => {
        pendingCollabAgentNameLookupIds.delete(normalizedAgentThreadId)
      })
  }

  function setLiveReasoningText(threadId: string, text: string): void {
    if (!threadId) return
    const normalized = text.trim()
    const previous = liveReasoningTextByThreadId.value[threadId] ?? ''
    if (normalized.length === 0) {
      if (!previous) return
      liveReasoningTextByThreadId.value = omitKey(liveReasoningTextByThreadId.value, threadId)
      return
    }
    if (previous === normalized) return
    liveReasoningTextByThreadId.value = {
      ...liveReasoningTextByThreadId.value,
      [threadId]: normalized,
    }
  }

  function appendLiveReasoningText(threadId: string, delta: string): void {
    if (!threadId) return
    const previous = liveReasoningTextByThreadId.value[threadId] ?? ''
    setLiveReasoningText(threadId, `${previous}${delta}`)
  }

  function clearLiveReasoningForThread(threadId: string): void {
    if (!threadId) return
    if (!(threadId in liveReasoningTextByThreadId.value)) return
    liveReasoningTextByThreadId.value = omitKey(liveReasoningTextByThreadId.value, threadId)
  }

  function clearLivePlansForThread(threadId: string): void {
    if (!threadId) return
    if (!(threadId in livePlanMessagesByThreadId.value)) return
    livePlanMessagesByThreadId.value = omitKey(livePlanMessagesByThreadId.value, threadId)
  }

  function clearLiveFileChangesForThread(threadId: string): void {
    if (!threadId) return
    if (!(threadId in liveFileChangeMessagesByThreadId.value)) return
    liveFileChangeMessagesByThreadId.value = omitKey(liveFileChangeMessagesByThreadId.value, threadId)
  }

  function setLiveMcpActivitiesForThread(threadId: string, activities: UiMcpActivity[]): void {
    if (!threadId) return
    if (activities.length === 0) {
      if (threadId in liveMcpActivitiesByThreadId.value) {
        liveMcpActivitiesByThreadId.value = omitKey(liveMcpActivitiesByThreadId.value, threadId)
      }
      return
    }
    liveMcpActivitiesByThreadId.value = {
      ...liveMcpActivitiesByThreadId.value,
      [threadId]: activities,
    }
  }

  function upsertLiveMcpActivity(threadId: string, activity: UiMcpActivity): void {
    const previous = liveMcpActivitiesByThreadId.value[threadId] ?? []
    const index = previous.findIndex((row) => row.id === activity.id)
    const next = [...previous]
    if (index >= 0) next.splice(index, 1, activity)
    else next.push(activity)
    setLiveMcpActivitiesForThread(threadId, next)
  }

  function clearLiveMcpActivitiesForThread(threadId: string): void {
    setLiveMcpActivitiesForThread(threadId, [])
  }

  function clearCompletedTurnLiveState(threadId: string): void {
    if (!threadId) return
    clearLivePlansForThread(threadId)
    clearLiveReasoningForThread(threadId)
    clearLiveCollabAgentsForThread(threadId)
    clearLiveMcpActivitiesForThread(threadId)
    setTurnActivityForThread(threadId, null)
    if (threadId === selectedThreadId.value) {
      activeReasoningItemId = ''
    }
    if (liveCommandsByThreadId.value[threadId]) {
      liveCommandsByThreadId.value = omitKey(liveCommandsByThreadId.value, threadId)
    }
    if (activeTurnIdByThreadId.value[threadId]) {
      activeTurnIdByThreadId.value = omitKey(activeTurnIdByThreadId.value, threadId)
    }
    clearPendingTurnRequest(threadId)
  }

  function normalizePlanStepStatus(value: unknown): UiPlanStep['status'] {
    if (value === 'completed') return 'completed'
    if (value === 'inProgress' || value === 'in_progress') return 'inProgress'
    return 'pending'
  }

  function buildPlanMessageText(plan: UiPlanData): string {
    const lines: string[] = []
    if (plan.explanation?.trim()) {
      lines.push(plan.explanation.trim())
    }
    for (const step of plan.steps) {
      const marker = step.status === 'completed' ? 'x' : step.status === 'inProgress' ? '~' : ' '
      lines.push(`- [${marker}] ${step.step}`)
    }
    return lines.join('\n').trim()
  }

  function readPlanUpdate(notification: RpcNotification): { threadId: string; message: UiMessage } | null {
    if (notification.method !== 'turn/plan/updated') return null
    const params = asRecord(notification.params)
    const threadId = extractThreadIdFromNotification(notification)
    const turnId = readString(params?.turnId) || readString(params?.turn_id)
    const rawSteps = Array.isArray(params?.plan) ? params?.plan : []
    const steps: UiPlanStep[] = rawSteps
      .map((row) => asRecord(row))
      .map((row) => ({
        step: readString(row?.step),
        status: normalizePlanStepStatus(row?.status),
      }))
      .filter((row) => row.step.length > 0)

    if (!threadId || !turnId) return null

    const explanation = readString(params?.explanation).trim()
    const plan: UiPlanData = {
      explanation: explanation || undefined,
      steps,
      isStreaming: true,
    }

    return {
      threadId,
      message: {
        id: `${turnId}:plan`,
        role: 'assistant',
        text: buildPlanMessageText(plan),
        messageType: 'plan.live',
        plan,
      },
    }
  }

  function readPlanDelta(notification: RpcNotification): { threadId: string; message: UiMessage } | null {
    if (notification.method !== 'item/plan/delta') return null
    const params = asRecord(notification.params)
    const threadId = extractThreadIdFromNotification(notification)
    const turnId = readString(params?.turnId) || readString(params?.turn_id)
    const delta = readString(params?.delta)
    if (!threadId || !turnId || !delta) return null

    const messageId = `${turnId}:plan`
    const existing = (livePlanMessagesByThreadId.value[threadId] ?? []).find((message) => message.id === messageId)
    const nextText = `${existing?.text ?? ''}${delta}`
    const nextPlan: UiPlanData | undefined = existing?.plan
      ? { ...existing.plan, isStreaming: true }
      : undefined

    return {
      threadId,
      message: {
        id: messageId,
        role: 'assistant',
        text: nextText,
        messageType: 'plan.live',
        plan: nextPlan,
      },
    }
  }

  function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  }

  function readString(value: unknown): string {
    return typeof value === 'string' ? value : ''
  }

  function readNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }

  function readOptionalDurationMs(record: Record<string, unknown> | null | undefined): number | undefined {
    if (!record) return undefined
    const value = (
      readNumber(record.durationMs) ??
      readNumber(record.duration_ms) ??
      readNumber(record.elapsedMs) ??
      readNumber(record.elapsed_ms)
    )
    return typeof value === 'number' ? Math.max(0, Math.round(value)) : undefined
  }

  function readOptionalErrorMessage(record: Record<string, unknown> | null | undefined): string {
    if (!record) return ''
    return sanitizeDisplayText(
      readString(record.errorMessage) ||
      readString(record.error_message) ||
      readString(asRecord(record.error)?.message),
    )
  }

  function getRateLimitSnapshotKey(snapshot: UiRateLimitSnapshot): string {
    return snapshot.limitId?.trim() || snapshot.limitName?.trim() || '__default__'
  }

  function normalizeRateLimitWindow(value: unknown): UiRateLimitSnapshot['primary'] {
    const record = asRecord(value)
    if (!record) return null

    const windowValue = readNumber(record.windowDurationMins)
    return {
      usedPercent: clamp(readNumber(record.usedPercent) ?? 0, 0, 100),
      windowDurationMins: windowValue,
      windowMinutes: windowValue,
      resetsAt: readNumber(record.resetsAt),
    }
  }

  function normalizeRateLimitSnapshot(value: unknown): UiRateLimitSnapshot | null {
    const record = asRecord(value)
    if (!record) return null

    const credits = asRecord(record.credits)
    return {
      limitId: readString(record.limitId) || null,
      limitName: readString(record.limitName) || null,
      primary: normalizeRateLimitWindow(record.primary),
      secondary: normalizeRateLimitWindow(record.secondary),
      credits: credits
        ? {
            hasCredits: credits.hasCredits === true,
            unlimited: credits.unlimited === true,
            balance: readString(credits.balance) || null,
          }
        : null,
      planType: readString(record.planType) || null,
    }
  }

  function normalizeRateLimitSnapshotsPayload(value: unknown): UiRateLimitSnapshot[] {
    const record = asRecord(value)
    if (!record) return []

    const next: UiRateLimitSnapshot[] = []
    const seen = new Set<string>()
    const pushSnapshot = (snapshot: UiRateLimitSnapshot | null): void => {
      if (!snapshot) return
      const key = getRateLimitSnapshotKey(snapshot)
      if (seen.has(key)) return
      seen.add(key)
      next.push(snapshot)
    }

    pushSnapshot(normalizeRateLimitSnapshot(record.rateLimits))

    const byLimitId = asRecord(record.rateLimitsByLimitId)
    if (byLimitId) {
      for (const snapshot of Object.values(byLimitId)) {
        pushSnapshot(normalizeRateLimitSnapshot(snapshot))
      }
    }

    return next
  }

  function normalizeTokenUsageBreakdown(value: unknown): UiTokenUsageBreakdown | null {
    const record = asRecord(value)
    if (!record) return null

    const totalTokens = readNumber(record.totalTokens ?? record.total_tokens)
    const inputTokens = readNumber(record.inputTokens ?? record.input_tokens)
    const cachedInputTokens = readNumber(record.cachedInputTokens ?? record.cached_input_tokens)
    const outputTokens = readNumber(record.outputTokens ?? record.output_tokens)
    const reasoningOutputTokens = readNumber(record.reasoningOutputTokens ?? record.reasoning_output_tokens)
    if (
      totalTokens === null ||
      inputTokens === null ||
      cachedInputTokens === null ||
      outputTokens === null ||
      reasoningOutputTokens === null
    ) {
      return null
    }

    return {
      totalTokens,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningOutputTokens,
    }
  }

  function normalizeThreadTokenUsage(value: unknown): UiThreadTokenUsage | null {
    const record = asRecord(value)
    if (!record) return null

    const total = normalizeTokenUsageBreakdown(record.total)
    const last = normalizeTokenUsageBreakdown(record.last)
    if (!total || !last) return null

    const modelContextWindow = readNumber(record.modelContextWindow ?? record.model_context_window)
    const currentContextTokens = last.totalTokens
    const remainingContextTokens = typeof modelContextWindow === 'number'
      ? Math.max(modelContextWindow - currentContextTokens, 0)
      : null
    const remainingContextPercent = typeof modelContextWindow === 'number' && modelContextWindow > 0
      ? clamp(Math.round((remainingContextTokens ?? 0) / modelContextWindow * 100), 0, 100)
      : null

    return {
      total,
      last,
      modelContextWindow,
      currentContextTokens,
      remainingContextTokens,
      remainingContextPercent,
    }
  }

  function readThreadTokenUsageUpdate(notification: RpcNotification): { threadId: string; usage: UiThreadTokenUsage } | null {
    if (notification.method !== 'thread/tokenUsage/updated') return null
    const params = asRecord(notification.params)
    const threadId = extractThreadIdFromNotification(notification)
    const usage = normalizeThreadTokenUsage(params?.tokenUsage ?? params?.token_usage)
    if (!threadId || !usage) return null
    return { threadId, usage }
  }

  function extractThreadIdFromNotification(notification: RpcNotification): string {
    const params = asRecord(notification.params)
    if (!params) return ''

    const directThreadId = readString(params.threadId)
    if (directThreadId) return directThreadId
    const snakeThreadId = readString(params.thread_id)
    if (snakeThreadId) return snakeThreadId

    const conversationId = readString(params.conversationId)
    if (conversationId) return conversationId
    const snakeConversationId = readString(params.conversation_id)
    if (snakeConversationId) return snakeConversationId

    const thread = asRecord(params.thread)
    const nestedThreadId = readString(thread?.id)
    if (nestedThreadId) return nestedThreadId

    const turn = asRecord(params.turn)
    const turnThreadId = readString(turn?.threadId)
    if (turnThreadId) return turnThreadId
    const turnSnakeThreadId = readString(turn?.thread_id)
    if (turnSnakeThreadId) return turnSnakeThreadId

    return ''
  }

  function readTurnErrorMessage(notification: RpcNotification): string {
    if (notification.method !== 'turn/completed') return ''
    const params = asRecord(notification.params)
    const turn = asRecord(params?.turn)
    if (!turn || turn.status !== 'failed') return ''
    const errorPayload = asRecord(turn.error)
    return readString(errorPayload?.message)
  }

  function readNotificationErrorState(notification: RpcNotification): { message: string; transient: boolean } | null {
    if (notification.method !== 'error') return null
    const params = asRecord(notification.params)
    const message = (
      readString(params?.message) ||
      readString(asRecord(params?.error)?.message)
    )
    if (!message) return null

    return {
      message,
      transient: params?.willRetry === true,
    }
  }

  function normalizeServerRequest(params: unknown): UiServerRequest | null {
    const row = asRecord(params)
    if (!row) return null

    const id = row.id
    const rawMethod = readString(row.method)
    const requestParams = row.params
    if (typeof id !== 'number' || !Number.isInteger(id) || !rawMethod) {
      return null
    }

    const requestParamRecord = asRecord(requestParams)
    const method = normalizePendingServerRequestMethod(rawMethod, requestParamRecord)
    const threadId = (
      readString(requestParamRecord?.threadId) ||
      readString(requestParamRecord?.thread_id) ||
      readString(requestParamRecord?.conversationId) ||
      readString(requestParamRecord?.conversation_id) ||
      GLOBAL_SERVER_REQUEST_SCOPE
    )
    const turnId = readString(requestParamRecord?.turnId) || readString(requestParamRecord?.turn_id)
    const itemId = (
      readString(requestParamRecord?.itemId) ||
      readString(requestParamRecord?.item_id) ||
      readString(requestParamRecord?.callId) ||
      readString(requestParamRecord?.call_id)
    )
    const receivedAtIso = readString(row.receivedAtIso) || new Date().toISOString()

    return {
      id,
      method,
      threadId,
      turnId,
      itemId,
      receivedAtIso,
      params: requestParams ?? null,
    }
  }

  function normalizePendingServerRequestMethod(
    method: string,
    params: Record<string, unknown> | null,
  ): string {
    const normalized = method.trim()
    if (!normalized) return normalized

    if (
      normalized === 'item/commandExecution/requestApproval' ||
      normalized === 'execCommandApproval' ||
      normalized === 'exec_approval_request' ||
      looksLikeExecApprovalRequest(params)
    ) {
      return 'item/commandExecution/requestApproval'
    }

    if (
      normalized === 'item/fileChange/requestApproval' ||
      normalized === 'applyPatchApproval' ||
      normalized === 'apply_patch_approval_request' ||
      looksLikePatchApprovalRequest(params)
    ) {
      return 'item/fileChange/requestApproval'
    }

    if (
      normalized === 'item/tool/requestUserInput' ||
      normalized === 'request_user_input' ||
      looksLikeToolUserInputRequest(params)
    ) {
      return 'item/tool/requestUserInput'
    }

    if (
      normalized === 'mcpServer/elicitation/request' ||
      normalized === 'elicitation_request' ||
      looksLikeMcpServerElicitationRequest(params)
    ) {
      return 'mcpServer/elicitation/request'
    }

    if (normalized === 'item/permissions/requestApproval' || looksLikePermissionsApprovalRequest(params)) {
      return 'item/permissions/requestApproval'
    }

    if (
      normalized === 'item/tool/call' ||
      normalized === 'dynamic_tool_call_request' ||
      looksLikeToolCallRequest(params)
    ) {
      return 'item/tool/call'
    }

    return normalized
  }

  function looksLikeExecApprovalRequest(params: Record<string, unknown> | null): boolean {
    if (!params) return false
    const command = params.command
    if (Array.isArray(command) && command.some((part) => typeof part === 'string' && part.trim().length > 0)) {
      return true
    }
    if (typeof command === 'string' && command.trim().length > 0) {
      return true
    }
    return Array.isArray(params.commandActions)
  }

  function looksLikePatchApprovalRequest(params: Record<string, unknown> | null): boolean {
    if (!params) return false
    if (typeof params.grantRoot === 'string' && params.grantRoot.trim().length > 0) return true
    if (typeof params.grant_root === 'string' && params.grant_root.trim().length > 0) return true
    if (asRecord(params.fileChanges)) return true
    return asRecord(params.changes) !== null
  }

  function looksLikeToolUserInputRequest(params: Record<string, unknown> | null): boolean {
    return Boolean(params && Array.isArray(params.questions))
  }

  function looksLikeToolCallRequest(params: Record<string, unknown> | null): boolean {
    if (!params) return false
    return (
      typeof params.toolName === 'string' ||
      typeof params.tool_name === 'string' ||
      typeof params.name === 'string' ||
      Array.isArray(params.arguments)
    )
  }

  function looksLikeMcpServerElicitationRequest(params: Record<string, unknown> | null): boolean {
    if (!params) return false
    const mode = readString(params.mode)
    return (
      typeof params.serverName === 'string' &&
      typeof params.threadId === 'string' &&
      typeof params.message === 'string' &&
      (mode === 'form' || mode === 'url')
    )
  }

  function looksLikePermissionsApprovalRequest(params: Record<string, unknown> | null): boolean {
    if (!params) return false
    return (
      typeof params.threadId === 'string' &&
      typeof params.turnId === 'string' &&
      typeof params.itemId === 'string' &&
      asRecord(params.permissions) !== null
    )
  }

  function readToolRequestUserInputQuestionIds(request: UiServerRequest): string[] {
    if (request.method !== 'item/tool/requestUserInput') return []
    const params = asRecord(request.params)
    const questions = Array.isArray(params?.questions) ? params.questions : []
    const questionIds: string[] = []

    for (const row of questions) {
      const question = asRecord(row)
      const id = readString(question?.id).trim()
      if (id) {
        questionIds.push(id)
      }
    }

    return questionIds
  }

  function buildMcpActivities(requests: UiServerRequest[]): UiMcpActivity[] {
    return requests
      .map((request): UiMcpActivity | null => {
        const params = asRecord(request.params)
        const durationMs = readOptionalDurationMs(params)
        const errorMessage = readOptionalErrorMessage(params)
        if (request.method === 'mcpServer/elicitation/request') {
          const serverName = sanitizeDisplayText(readString(params?.serverName)) || 'MCP server'
          const message = sanitizeDisplayText(readString(params?.message))
          const mode = sanitizeDisplayText(readString(params?.mode))
          return {
            id: `request:${String(request.id)}`,
            name: formatMcpServerName(serverName),
            detail: errorMessage || message || (mode === 'url' ? 'Waiting for URL confirmation' : 'Waiting for input'),
            status: 'waiting' as const,
            server: serverName,
            durationMs,
            errorMessage: errorMessage || undefined,
          }
        }

        if (request.method !== 'item/tool/call') return null
        const rawTool = sanitizeDisplayText(
          readString(params?.tool) ||
          readString(params?.toolName) ||
          readString(params?.tool_name) ||
          readString(params?.name),
        )
        const parsed = parseMcpToolName(rawTool)
        if (!parsed) return null
        return {
          id: `request:${String(request.id)}`,
          name: parsed.serverName,
          detail: errorMessage || (parsed.toolName ? `Calling ${parsed.toolName}` : 'Calling MCP tool'),
          status: 'running' as const,
          server: parsed.serverName,
          tool: parsed.toolName || rawTool,
          durationMs,
          errorMessage: errorMessage || undefined,
        }
      })
      .filter((activity): activity is UiMcpActivity => activity !== null)
  }

  function formatMcpServerName(value: string): string {
    const trimmed = sanitizeDisplayText(value)
    if (!trimmed) return 'MCP server'
    return /mcp$/iu.test(trimmed) ? trimmed : `${trimmed} MCP`
  }

  function parseMcpToolName(toolName: string): { serverName: string; toolName: string } | null {
    const normalized = sanitizeDisplayText(toolName)
    if (!normalized) return null
    if (normalized.startsWith('mcp__')) {
      const [, server = '', tool = ''] = normalized.split('__')
      return {
        serverName: formatMcpServerName(server.replace(/[_-]+/gu, ' ')),
        toolName: tool.replace(/[_-]+/gu, ' ').trim(),
      }
    }
    const match = normalized.match(/^([^:]+)\s*:\s*(.+)$/u)
    if (match && /mcp/iu.test(match[1])) {
      return {
        serverName: formatMcpServerName(match[1].replace(/mcp/giu, '')),
        toolName: match[2].trim(),
      }
    }
    return null
  }

  function upsertPendingServerRequest(request: UiServerRequest): void {
    const threadId = request.threadId || GLOBAL_SERVER_REQUEST_SCOPE
    const current = pendingServerRequestsByThreadId.value[threadId] ?? []
    const index = current.findIndex((row) => row.id === request.id)
    const nextRows = [...current]
    if (index >= 0) {
      nextRows.splice(index, 1, request)
    } else {
      nextRows.push(request)
    }

    pendingServerRequestsByThreadId.value = {
      ...pendingServerRequestsByThreadId.value,
      [threadId]: nextRows.sort((first, second) => first.receivedAtIso.localeCompare(second.receivedAtIso)),
    }
    applyThreadFlags()
  }

  function removePendingServerRequestById(requestId: number): void {
    const next: Record<string, UiServerRequest[]> = {}
    for (const [threadId, requests] of Object.entries(pendingServerRequestsByThreadId.value)) {
      const filtered = requests.filter((request) => request.id !== requestId)
      if (filtered.length > 0) {
        next[threadId] = filtered
      }
    }
    pendingServerRequestsByThreadId.value = next
    applyThreadFlags()
  }

  function replacePendingServerRequests(requests: UiServerRequest[]): void {
    const next: Record<string, UiServerRequest[]> = {}
    for (const request of requests) {
      const threadId = request.threadId || GLOBAL_SERVER_REQUEST_SCOPE
      const current = next[threadId] ?? []
      current.push(request)
      next[threadId] = current
    }

    for (const rows of Object.values(next)) {
      rows.sort((first, second) => first.receivedAtIso.localeCompare(second.receivedAtIso))
    }

    pendingServerRequestsByThreadId.value = next
  }

  function handleServerRequestNotification(notification: RpcNotification): boolean {
    if (notification.method === 'server/request') {
      const request = normalizeServerRequest(notification.params)
      if (!request) return true
      upsertPendingServerRequest(request)
      return true
    }

    if (notification.method === 'server/request/resolved') {
      const row = asRecord(notification.params)
      const id = row?.id
      if (typeof id === 'number' && Number.isInteger(id)) {
        removePendingServerRequestById(id)
      }
      return true
    }

    return false
  }

  function sanitizeDisplayText(value: string): string {
    return value.replace(/\s+/gu, ' ').trim()
  }

  function readTurnActivity(notification: RpcNotification): { threadId: string; activity: TurnActivityState } | null {
    const threadId = extractThreadIdFromNotification(notification)
    if (!threadId) return null

    if (notification.method === 'turn/started') {
      return {
        threadId,
        activity: {
          label: 'Thinking',
          details: [],
        },
      }
    }

    if (notification.method === 'item/started') {
      const params = asRecord(notification.params)
      const item = asRecord(params?.item)
      const itemType = readString(item?.type).toLowerCase()
      if (itemType === 'reasoning') {
        return {
          threadId,
          activity: {
            label: 'Thinking',
            details: [],
          },
        }
      }
      if (itemType === 'agentmessage') {
        return {
          threadId,
          activity: {
            label: 'Writing response',
            details: [],
          },
        }
      }
      if (itemType === 'commandexecution') {
        const cmd = readString(item?.command)
        return {
          threadId,
          activity: {
            label: 'Running command',
            details: cmd ? [cmd] : [],
          },
        }
      }
      if (itemType === 'filechange') {
        const changes = Array.isArray(item?.changes) ? item.changes : []
        const firstChange = changes[0] as Record<string, unknown> | undefined
        const path = readString(firstChange?.path)
        return {
          threadId,
          activity: {
            label: 'Applying changes',
            details: path ? [path] : [],
          },
        }
      }
    }

    if (notification.method === 'item/commandExecution/outputDelta') {
      return {
        threadId,
        activity: {
          label: 'Running command',
          details: [],
        },
      }
    }

    if (notification.method === 'item/fileChange/outputDelta') {
      return {
        threadId,
        activity: {
          label: 'Applying changes',
          details: [],
        },
      }
    }

    if (
      notification.method === 'item/reasoning/summaryTextDelta' ||
      notification.method === 'item/reasoning/summaryPartAdded' ||
      notification.method === 'item/reasoning/textDelta'
    ) {
      return {
        threadId,
        activity: {
          label: 'Thinking',
          details: [],
        },
      }
    }

    if (notification.method === 'item/agentMessage/delta') {
      return {
        threadId,
        activity: {
          label: 'Writing response',
          details: [],
        },
      }
    }

    return null
  }

  function readTurnStartedInfo(notification: RpcNotification): TurnStartedInfo | null {
    if (notification.method !== 'turn/started') {
      return null
    }

    const params = asRecord(notification.params)
    if (!params) return null
    const threadId = extractThreadIdFromNotification(notification)
    if (!threadId) return null

    const turnPayload = asRecord(params.turn)
    const turnId =
      readString(turnPayload?.id) ||
      readString(params.turnId) ||
      `${threadId}:unknown`
    if (!turnId) return null

    const startedAtMs =
      parseIsoTimestamp(readString(turnPayload?.startedAt)) ??
      parseIsoTimestamp(readString(params.startedAt)) ??
      parseIsoTimestamp(notification.atIso) ??
      Date.now()

    return {
      threadId,
      turnId,
      startedAtMs,
    }
  }

  function readTurnCompletedInfo(notification: RpcNotification): TurnCompletedInfo | null {
    if (notification.method !== 'turn/completed') {
      return null
    }

    const params = asRecord(notification.params)
    if (!params) return null
    const threadId = extractThreadIdFromNotification(notification)
    if (!threadId) return null

    const turnPayload = asRecord(params.turn)
    const turnId =
      readString(turnPayload?.id) ||
      readString(params.turnId) ||
      `${threadId}:unknown`
    if (!turnId) return null

    const completedAtMs =
      parseIsoTimestamp(readString(turnPayload?.completedAt)) ??
      parseIsoTimestamp(readString(params.completedAt)) ??
      parseIsoTimestamp(notification.atIso) ??
      Date.now()

    const startedAtMs =
      parseIsoTimestamp(readString(turnPayload?.startedAt)) ??
      parseIsoTimestamp(readString(params.startedAt)) ??
      undefined

    return {
      threadId,
      turnId,
      completedAtMs,
      startedAtMs,
    }
  }

  function readTurnDiffUpdate(notification: RpcNotification): { threadId: string; turnId: string; summary: TurnChangeSummary } | null {
    if (notification.method !== 'turn/diff/updated') return null

    const params = asRecord(notification.params)
    if (!params) return null
    const threadId = extractThreadIdFromNotification(notification)
    const turnId = readString(params.turnId) || readString(params.turn_id)
    const diff = readString(params.diff)
    if (!threadId || !turnId || !diff) return null

    return {
      threadId,
      turnId,
      summary: summarizeUnifiedDiff(diff),
    }
  }

  function liveReasoningMessageId(reasoningItemId: string): string {
    return `${reasoningItemId}:live-reasoning`
  }

  function inferNextTurnIndex(threadId: string): number {
    const persisted = persistedMessagesByThreadId.value[threadId] ?? []
    let maxTurnIndex = -1
    for (const message of persisted) {
      if (typeof message.turnIndex === 'number' && Number.isFinite(message.turnIndex)) {
        maxTurnIndex = Math.max(maxTurnIndex, message.turnIndex)
      }
    }
    return maxTurnIndex + 1
  }

  function setTurnIndexForThread(threadId: string, turnId: string, turnIndex: number): void {
    if (!threadId || !turnId || !Number.isInteger(turnIndex) || turnIndex < 0) return
    const previous = turnIndexByTurnIdByThreadId.value[threadId] ?? {}
    if (previous[turnId] === turnIndex) return
    turnIndexByTurnIdByThreadId.value = {
      ...turnIndexByTurnIdByThreadId.value,
      [threadId]: {
        ...previous,
        [turnId]: turnIndex,
      },
    }
  }

  function replaceTurnIndexLookupForThread(threadId: string, nextLookup: Record<string, number>): void {
    const previous = turnIndexByTurnIdByThreadId.value[threadId] ?? {}
    const previousEntries = Object.entries(previous)
    const nextEntries = Object.entries(nextLookup)
    if (
      previousEntries.length === nextEntries.length
      && previousEntries.every(([turnId, turnIndex]) => nextLookup[turnId] === turnIndex)
    ) {
      return
    }

    turnIndexByTurnIdByThreadId.value = {
      ...turnIndexByTurnIdByThreadId.value,
      [threadId]: { ...nextLookup },
    }
  }

  function rebindLiveFileChangeTurnIndices(threadId: string): void {
    const current = liveFileChangeMessagesByThreadId.value[threadId]
    if (!current || current.length === 0) return

    const turnIndexByTurnId = turnIndexByTurnIdByThreadId.value[threadId] ?? {}
    let changed = false
    const next = current.map((message) => {
      if (typeof message.turnIndex === 'number' || !message.turnId) {
        return message
      }
      const turnIndex = turnIndexByTurnId[message.turnId]
      if (typeof turnIndex !== 'number') return message
      changed = true
      return { ...message, turnIndex }
    })

    if (!changed) return
    liveFileChangeMessagesByThreadId.value = {
      ...liveFileChangeMessagesByThreadId.value,
      [threadId]: next,
    }
  }

  function readReasoningStartedItemId(notification: RpcNotification): string {
    const params = asRecord(notification.params)
    if (!params) return ''

    if (notification.method === 'item/started') {
      const item = asRecord(params.item)
      if (!item || item.type !== 'reasoning') return ''
      return readString(item.id)
    }

    return ''
  }

  function readReasoningDelta(notification: RpcNotification): { messageId: string; delta: string } | null {
    const params = asRecord(notification.params)
    if (!params) return null

    // Канонический источник дельт для UI — уже нормализованный item/*.
    if (notification.method === 'item/reasoning/summaryTextDelta') {
      const itemId = readString(params.itemId)
      const delta = readString(params.delta)
      if (!itemId || !delta) return null
      return { messageId: liveReasoningMessageId(itemId), delta }
    }

    // codex also emits the full reasoning-chain stream as item/reasoning/textDelta
    // (alongside the summary stream). Without handling it, reasoning text the
    // model streams via this channel is dropped and the UI shows only the
    // summary, making long thinking phases look like a stall.
    if (notification.method === 'item/reasoning/textDelta') {
      const itemId = readString(params.itemId)
      const delta = readString(params.delta)
      if (!itemId || !delta) return null
      return { messageId: liveReasoningMessageId(itemId), delta }
    }

    return null
  }

  function readReasoningSectionBreakMessageId(notification: RpcNotification): string {
    const params = asRecord(notification.params)
    if (!params) return ''

    // Канонический source для section break — item/*
    if (notification.method === 'item/reasoning/summaryPartAdded') {
      const itemId = readString(params.itemId)
      if (!itemId) return ''
      return liveReasoningMessageId(itemId)
    }

    return ''
  }

  function readReasoningCompletedId(notification: RpcNotification): string {
    const params = asRecord(notification.params)
    if (!params) return ''

    if (notification.method === 'item/completed') {
      const item = asRecord(params.item)
      if (!item || item.type !== 'reasoning') return ''
      return liveReasoningMessageId(readString(item.id))
    }

    return ''
  }

  function readAgentMessageStartedId(notification: RpcNotification): string {
    const params = asRecord(notification.params)
    if (!params) return ''

    if (notification.method === 'item/started') {
      const item = asRecord(params.item)
      if (!item || item.type !== 'agentMessage') return ''
      return readString(item.id)
    }

    return ''
  }

  function readAgentMessageDelta(notification: RpcNotification): { messageId: string; delta: string } | null {
    const params = asRecord(notification.params)
    if (!params) return null

    // Канонический live-канал агентского текста.
    if (notification.method === 'item/agentMessage/delta') {
      const messageId = readString(params.itemId)
      const delta = readString(params.delta)
      if (!messageId || !delta) return null
      return { messageId, delta }
    }

    return null
  }

  function readAgentMessageCompleted(notification: RpcNotification): UiMessage | null {
    const params = asRecord(notification.params)
    if (!params) return null

    if (notification.method === 'item/completed') {
      const item = asRecord(params.item)
      if (!item || item.type !== 'agentMessage') return null
      const id = readString(item.id)
      const text = readString(item.text)
      if (!id || !text) return null
      return {
        id,
        role: 'assistant',
        text,
        messageType: 'agentMessage.live',
      }
    }

    return null
  }

  function toLocalImageUrl(path: string): string {
    return resolveBackendHttpUrl(`/codex-local-image?path=${encodeURIComponent(path)}`)
  }

  function toImageGenerationUrl(value: string): string {
    const trimmed = value.trim()
    if (!trimmed) return ''
    if (
      trimmed.startsWith('data:') ||
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('/codex-local-image?')
    ) {
      return resolveBackendHttpUrl(trimmed)
    }
    const compact = trimmed.replace(/\s+/gu, '')
    if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(compact)) return ''
    return `data:image/png;base64,${compact}`
  }

  function readCompletedImageView(notification: RpcNotification): UiMessage | null {
    if (notification.method !== 'item/completed') return null
    const params = asRecord(notification.params)
    const item = asRecord(params?.item)
    if (!item) return null
    const id = readString(item.id)
    if (!id) return null
    if (item.type === 'imageView') {
      const path = readString(item.path)
      if (!path) return null
      return {
        id,
        role: 'assistant',
        text: '',
        images: [toLocalImageUrl(path)],
        messageType: 'imageView',
      }
    }
    if (item.type !== 'imageGeneration' && item.type !== 'image_generation') return null
    const result = readString(item.result)
    const imageUrl = result ? toImageGenerationUrl(result) : ''
    if (!imageUrl) return null
    return {
      id,
      role: 'assistant',
      text: '',
      images: [imageUrl],
      messageType: 'imageView',

    }
  }

  function readCommandExecutionStarted(notification: RpcNotification): UiMessage | null {
    if (notification.method !== 'item/started') return null
    const params = asRecord(notification.params)
    const item = asRecord(params?.item)
    if (!item || item.type !== 'commandExecution') return null
    const id = readString(item.id)
    const command = readString(item.command)
    if (!id) return null
    const cwd = typeof item.cwd === 'string' ? item.cwd : null
    const threadId = extractThreadIdFromNotification(notification)
    const turnId = readString(params?.turnId) || readString(params?.turn_id)
    const turnIndex = threadId && turnId
      ? turnIndexByTurnIdByThreadId.value[threadId]?.[turnId]
      : undefined
    return {
      id,
      role: 'system',
      text: command,
      messageType: 'commandExecution',
      commandExecution: { command, cwd, status: 'inProgress', aggregatedOutput: '', exitCode: null },
      turnId: turnId || undefined,
      turnIndex: typeof turnIndex === 'number' ? turnIndex : undefined,
    }
  }

  function readCommandOutputDelta(notification: RpcNotification): { itemId: string; delta: string } | null {
    if (notification.method !== 'item/commandExecution/outputDelta') return null
    const params = asRecord(notification.params)
    if (!params) return null
    const itemId = readString(params.itemId)
    const delta = readString(params.delta)
    if (!itemId || !delta) return null
    return { itemId, delta }
  }

  function readCommandExecutionCompleted(notification: RpcNotification): UiMessage | null {
    if (notification.method !== 'item/completed') return null
    const params = asRecord(notification.params)
    const item = asRecord(params?.item)
    if (!item || item.type !== 'commandExecution') return null
    const id = readString(item.id)
    const command = readString(item.command)
    if (!id) return null
    const cwd = typeof item.cwd === 'string' ? item.cwd : null
    const statusRaw = readString(item.status)
    const status: CommandExecutionData['status'] =
      statusRaw === 'failed' ? 'failed' : statusRaw === 'declined' ? 'declined' : statusRaw === 'interrupted' ? 'interrupted' : 'completed'
    const aggregatedOutput = typeof item.aggregatedOutput === 'string' ? item.aggregatedOutput : ''
    const exitCode = typeof item.exitCode === 'number' ? item.exitCode : null
    const threadId = extractThreadIdFromNotification(notification)
    const turnId = readString(params?.turnId) || readString(params?.turn_id)
    const turnIndex = threadId && turnId
      ? turnIndexByTurnIdByThreadId.value[threadId]?.[turnId]
      : undefined
    return {
      id,
      role: 'system',
      text: command,
      messageType: 'commandExecution',
      commandExecution: { command, cwd, status, aggregatedOutput, exitCode },
      turnId: turnId || undefined,
      turnIndex: typeof turnIndex === 'number' ? turnIndex : undefined,
    }
  }

  function readCompletedFileChange(notification: RpcNotification): UiMessage | null {
    if (notification.method !== 'item/completed') return null
    const params = asRecord(notification.params)
    const item = asRecord(params?.item)
    if (!item || item.type !== 'fileChange') return null
    const id = readString(item.id)
    if (!id) return null
    const threadId = readString(params?.threadId)
    const turnId = readString(params?.turnId)
    const turnIndex = threadId && turnId
      ? turnIndexByTurnIdByThreadId.value[threadId]?.[turnId]
      : undefined

    const fileChanges = toUiFileChanges(item.changes)
    const fileChangeStatus = normalizeFileChangeStatus(item.status)
    if (fileChanges.length === 0 || fileChangeStatus !== 'completed') return null

    return {
      id,
      role: 'system',
      text: '',
      messageType: 'fileChange',
      fileChangeStatus,
      fileChanges,
      turnId: turnId || undefined,
      turnIndex: typeof turnIndex === 'number' ? turnIndex : undefined,
    }
  }

  function readCollabAgentsUpdate(notification: RpcNotification): { threadId: string; agents: UiCollabAgentStatus[] } | null {
    if (notification.method !== 'item/started' && notification.method !== 'item/completed') return null
    const threadId = extractThreadIdFromNotification(notification)
    if (!threadId) return null
    const params = asRecord(notification.params)
    const item = asRecord(params?.item)
    if (!item || item.type !== 'collabAgentToolCall') return null
    rememberCollabAgentParents(threadId, item)
    return {
      threadId,
      agents: normalizeCollabAgentsFromItems([item], {
        agentDisplayNames: collabAgentDisplayNameByThreadId.value,
      }),
    }
  }

  function appendCollabAgentReasoningSummary(agentThreadId: string, delta: string): string {
    const previous = collabAgentReasoningSummaryByThreadId.value[agentThreadId] ?? ''
    const nextSummary = sanitizeDisplayText(`${previous}${delta}`).slice(0, 320)
    if (nextSummary === previous) return previous
    collabAgentReasoningSummaryByThreadId.value = {
      ...collabAgentReasoningSummaryByThreadId.value,
      [agentThreadId]: nextSummary,
    }
    return nextSummary
  }

  function applyCollabAgentRealtimeUpdate(notification: RpcNotification): void {
    const params = asRecord(notification.params)
    if (!params) return

    const thread = asRecord(params.thread)
    if (thread) {
      rememberCollabAgentMetadata(thread)
    }

    const agentThreadId = extractThreadIdFromNotification(notification)
    if (!agentThreadId || !collabAgentParentThreadIdByThreadId.value[agentThreadId]) return

    if (notification.method === 'turn/started') {
      updateLiveCollabAgent(agentThreadId, { task: 'Thinking', status: 'running' })
      return
    }

    if (notification.method === 'item/started') {
      const item = asRecord(params.item)
      const itemType = readString(item?.type).toLowerCase()
      if (itemType === 'reasoning') {
        updateLiveCollabAgent(agentThreadId, { task: 'Thinking', status: 'running' })
        return
      }
      if (itemType === 'agentmessage') {
        updateLiveCollabAgent(agentThreadId, { task: 'Writing response', status: 'running' })
        return
      }
      if (itemType === 'commandexecution') {
        updateLiveCollabAgent(agentThreadId, { task: 'Running command', status: 'running' })
        return
      }
      if (itemType === 'filechange') {
        updateLiveCollabAgent(agentThreadId, { task: 'Applying changes', status: 'running' })
      }
      return
    }

    if (notification.method === 'item/reasoning/summaryTextDelta') {
      const delta = readString(params.delta)
      if (!delta) return
      updateLiveCollabAgent(agentThreadId, {
        task: appendCollabAgentReasoningSummary(agentThreadId, delta),
        status: 'running',
      })
      return
    }

    if (notification.method === 'item/agentMessage/delta') {
      if (!collabAgentReasoningSummaryByThreadId.value[agentThreadId]) {
        updateLiveCollabAgent(agentThreadId, { task: 'Writing response', status: 'running' })
      }
      return
    }

    if (notification.method === 'turn/completed') {
      const errorMessage = readTurnErrorMessage(notification)
      updateLiveCollabAgent(agentThreadId, {
        task: errorMessage ? errorMessage : (collabAgentReasoningSummaryByThreadId.value[agentThreadId] || 'Completed'),
        status: errorMessage ? 'failed' : 'completed',
      })
    }
  }

  function normalizeMcpToolCallStatus(value: unknown): UiMcpActivity['status'] {
    if (value === 'failed') return 'failed'
    if (value === 'completed') return 'completed'
    return 'running'
  }

  function readMcpActivityFromItem(item: Record<string, unknown>, fallbackDetail: string): UiMcpActivity | null {
    if (item.type !== 'mcpToolCall') return null
    const id = readString(item.id)
    if (!id) return null
    const server = sanitizeDisplayText(readString(item.server) || readString(item.serverName) || readString(item.server_name))
    const tool = sanitizeDisplayText(readString(item.tool) || readString(item.toolName) || readString(item.tool_name))
    const errorMessage = readOptionalErrorMessage(item)
    const durationMs = readOptionalDurationMs(item)
    return {
      id,
      name: formatMcpServerName(server),
      detail: errorMessage || fallbackDetail || (tool ? `Calling ${tool}` : 'Calling MCP tool'),
      status: normalizeMcpToolCallStatus(item.status),
      server: server || undefined,
      tool: tool || undefined,
      durationMs,
      errorMessage: errorMessage || undefined,
    }
  }

  function applyMcpActivityRealtimeUpdate(notification: RpcNotification): void {
    const threadId = extractThreadIdFromNotification(notification)
    if (!threadId) return
    const params = asRecord(notification.params)
    if (!params) return

    if (notification.method === 'item/mcpToolCall/progress') {
      const itemId = readString(params.itemId)
      if (!itemId) return
      const previous = liveMcpActivitiesByThreadId.value[threadId]?.find((activity) => activity.id === itemId)
      const errorMessage = readOptionalErrorMessage(params)
      upsertLiveMcpActivity(threadId, {
        id: itemId,
        name: previous?.name ?? 'MCP server',
        detail: errorMessage || sanitizeDisplayText(readString(params.message)) || previous?.detail || 'Working',
        status: 'running',
        server: previous?.server,
        tool: previous?.tool,
        durationMs: readOptionalDurationMs(params) ?? previous?.durationMs,
        errorMessage: errorMessage || previous?.errorMessage,
      })
      return
    }

    if (notification.method !== 'item/started' && notification.method !== 'item/completed') return
    const item = asRecord(params.item)
    if (!item || item.type !== 'mcpToolCall') return
    const activity = readMcpActivityFromItem(item, notification.method === 'item/completed' ? 'Completed' : 'Starting MCP tool')
    if (!activity) return
    upsertLiveMcpActivity(threadId, activity)
  }

  function upsertLiveCommand(threadId: string, msg: UiMessage): void {
    const previous = liveCommandsByThreadId.value[threadId] ?? []
    const next = upsertMessage(previous, msg)
    if (next === previous) return
    liveCommandsByThreadId.value = { ...liveCommandsByThreadId.value, [threadId]: next }
  }

  function removeLiveCommandsPersistedIn(threadId: string, persistedMessages: UiMessage[]): void {
    const current = liveCommandsByThreadId.value[threadId]
    if (!current || current.length === 0) return
    const persistedIds = new Set(persistedMessages.map((m) => m.id))
    const next = current.filter((m) => !persistedIds.has(m.id))
    if (next.length === current.length) return
    if (next.length === 0) {
      liveCommandsByThreadId.value = omitKey(liveCommandsByThreadId.value, threadId)
    } else {
      liveCommandsByThreadId.value = { ...liveCommandsByThreadId.value, [threadId]: next }
    }
  }

  function removeLiveFileChangesPersistedIn(threadId: string, persistedMessages: UiMessage[]): void {
    const current = liveFileChangeMessagesByThreadId.value[threadId]
    if (!current || current.length === 0) return
    const persistedIds = new Set(persistedMessages.map((message) => message.id))
    const persistedTurnIds = new Set(
      persistedMessages
        .filter((message) => message.messageType === 'fileChange' && typeof message.turnId === 'string' && message.turnId.length > 0)
        .map((message) => message.turnId as string),
    )
    const persistedTurnIndices = new Set(
      persistedMessages
        .filter((message) => message.messageType === 'fileChange' && typeof message.turnIndex === 'number')
        .map((message) => message.turnIndex as number),
    )
    const next = current.filter((message) => (
      !persistedIds.has(message.id)
      && !(message.turnId && persistedTurnIds.has(message.turnId))
      && !(typeof message.turnIndex === 'number' && persistedTurnIndices.has(message.turnIndex))
    ))
    if (next.length === current.length) return
    if (next.length === 0) {
      liveFileChangeMessagesByThreadId.value = omitKey(liveFileChangeMessagesByThreadId.value, threadId)
    } else {
      liveFileChangeMessagesByThreadId.value = { ...liveFileChangeMessagesByThreadId.value, [threadId]: next }
    }
  }

  function isAgentContentEvent(notification: RpcNotification): boolean {
    if (notification.method === 'item/agentMessage/delta') {
      return true
    }

    const params = asRecord(notification.params)
    if (!params) return false

    if (notification.method === 'item/completed') {
      const item = asRecord(params.item)
      return item?.type === 'agentMessage'
    }

    return false
  }

  function applyRealtimeUpdates(notification: RpcNotification): void {
    if (handleServerRequestNotification(notification)) {
      return
    }

    if (notification.method === 'account/rateLimits/updated') {
      scheduleRateLimitRefresh()
    }

    if (notification.method === 'thread/name/updated') {
      const params = asRecord(notification.params)
      const threadId = readString(params?.threadId)
      const threadName = readString(params?.threadName)
      if (threadId && threadName) {
        threadTitleById.value = { ...threadTitleById.value, [threadId]: threadName }
        applyThreadFlags()
        void persistThreadTitle(threadId, threadName)
      }
    }

    if (notification.method === 'account/rateLimits/updated') {
      setCodexRateLimit(pickCodexRateLimitSnapshot(notification.params))
      return
    }

    const tokenUsageUpdate = readThreadTokenUsageUpdate(notification)
    if (tokenUsageUpdate) {
      setThreadTokenUsage(tokenUsageUpdate.threadId, tokenUsageUpdate.usage)
      return
    }

    const turnActivity = readTurnActivity(notification)
    if (turnActivity) {
      setTurnActivityForThread(turnActivity.threadId, turnActivity.activity)
    }

    const notificationThreadId = extractThreadIdFromNotification(notification)
    const notificationErrorState = readNotificationErrorState(notification)
    if (!notificationErrorState && notificationThreadId) {
      clearTransientTurnErrorForThread(notificationThreadId)
    }

    const startedTurn = readTurnStartedInfo(notification)
    if (startedTurn) {
      pendingTurnStartsById.set(startedTurn.turnId, startedTurn)
      turnDiffSummaryByTurnId.delete(startedTurn.turnId)
      setTurnIndexForThread(startedTurn.threadId, startedTurn.turnId, inferNextTurnIndex(startedTurn.threadId))
      activeTurnIdByThreadId.value = {
        ...activeTurnIdByThreadId.value,
        [startedTurn.threadId]: startedTurn.turnId,
      }
      maybeUnblockInterruptForActiveTurn(startedTurn.threadId, startedTurn.turnId)
      clearLivePlansForThread(startedTurn.threadId)
      clearLiveFileChangesForThread(startedTurn.threadId)
      clearLiveCollabAgentsForThread(startedTurn.threadId)
      clearLiveMcpActivitiesForThread(startedTurn.threadId)
      setTurnSummaryForThread(startedTurn.threadId, null)
      setTurnErrorForThread(startedTurn.threadId, null)
      setThreadInProgress(startedTurn.threadId, true)
      scheduleQueueStateRefresh(startedTurn.threadId)
      if (eventUnreadByThreadId.value[startedTurn.threadId]) {
        eventUnreadByThreadId.value = omitKey(eventUnreadByThreadId.value, startedTurn.threadId)
      }
    }

    const turnDiffUpdate = readTurnDiffUpdate(notification)
    if (turnDiffUpdate) {
      turnDiffSummaryByTurnId.set(turnDiffUpdate.turnId, turnDiffUpdate.summary)
    }

    const completedTurn = readTurnCompletedInfo(notification)
    const turnErrorMessage = readTurnErrorMessage(notification)
    const completedThreadId = completedTurn?.threadId ?? extractThreadIdFromNotification(notification)
    const completedThreadModelId = completedThreadId ? readModelIdForThread(completedThreadId) : ''
    const shouldRetryWithFallback =
      Boolean(completedThreadId) &&
      Boolean(turnErrorMessage) &&
      completedThreadModelId !== MODEL_FALLBACK_ID &&
      isUnsupportedChatGptModelError(new Error(turnErrorMessage))
    if (completedTurn) {
      const pendingTurnRequest = pendingTurnRequestByThreadId.value[completedTurn.threadId]
      const startedTurnState = pendingTurnStartsById.get(completedTurn.turnId)
      if (startedTurnState) {
        pendingTurnStartsById.delete(completedTurn.turnId)
      }

      const rawDurationMs =
        readNumber(asRecord(notification.params)?.durationMs) ??
        readNumber(asRecord(asRecord(notification.params)?.turn)?.durationMs) ??
        (typeof completedTurn.startedAtMs === 'number'
          ? completedTurn.completedAtMs - completedTurn.startedAtMs
          : null) ??
        (startedTurnState ? completedTurn.completedAtMs - startedTurnState.startedAtMs : null)

      const durationMs = typeof rawDurationMs === 'number' ? Math.max(0, rawDurationMs) : 0
      const turnIndex = turnIndexByTurnIdByThreadId.value[completedTurn.threadId]?.[completedTurn.turnId]
      const diffSummary = turnDiffSummaryByTurnId.get(completedTurn.turnId)
      turnDiffSummaryByTurnId.delete(completedTurn.turnId)
      setTurnSummaryForThread(completedTurn.threadId, {
        turnId: completedTurn.turnId,
        durationMs,
        turnIndex: typeof turnIndex === 'number' ? turnIndex : undefined,
        changedFileCount: diffSummary?.changedFileCount,
        addedLineCount: diffSummary?.addedLineCount,
        removedLineCount: diffSummary?.removedLineCount,
      })
      if (activeTurnIdByThreadId.value[completedTurn.threadId]) {
        activeTurnIdByThreadId.value = omitKey(activeTurnIdByThreadId.value, completedTurn.threadId)
      }
      setThreadInProgress(completedTurn.threadId, false)
      setTurnActivityForThread(completedTurn.threadId, null)
      markThreadUnreadByEvent(completedTurn.threadId)
      if (!shouldRetryWithFallback) {
        clearPendingTurnRequest(completedTurn.threadId)
        scheduleQueueStateRefresh(completedTurn.threadId)
      }
      if (!turnErrorMessage) {
        clearPreviousResponseAutoContinueAttempt(completedTurn.threadId)
      }
    }

    if (turnErrorMessage) {
      const failedThreadId = completedTurn?.threadId || extractThreadIdFromNotification(notification)
      if (failedThreadId) {
        setTurnErrorForThread(failedThreadId, turnErrorMessage)
        schedulePreviousResponseAutoContinue(failedThreadId, notification)
      }
      error.value = turnErrorMessage
      if (failedThreadId && shouldRetryWithFallback) {
        void retryPendingTurnWithFallback(failedThreadId)
      }
    } else if (completedTurn) {
      setTurnErrorForThread(completedTurn.threadId, null)
    }

    if (notificationErrorState) {
      const errorThreadId = notificationThreadId
      const errorThreadModelId = errorThreadId ? readModelIdForThread(errorThreadId) : selectedModelId.value.trim()
      if (errorThreadId) {
        setTurnErrorForThread(errorThreadId, notificationErrorState.message, {
          transient: notificationErrorState.transient,
        })
      }
      error.value = notificationErrorState.message
      if (errorThreadId && !notificationErrorState.transient) {
        schedulePreviousResponseAutoContinue(errorThreadId, notification)
      }
      if (errorThreadModelId !== MODEL_FALLBACK_ID && isUnsupportedChatGptModelError(new Error(notificationErrorState.message))) {
        if (errorThreadId) {
          void retryPendingTurnWithFallback(errorThreadId)
        } else {
          void applyFallbackModelSelection()
        }
      }
    }

    const planUpdate = readPlanUpdate(notification)
    if (planUpdate) {
      upsertLivePlanMessage(planUpdate.threadId, planUpdate.message)
      setTurnActivityForThread(planUpdate.threadId, {
        label: 'Planning',
        details: planUpdate.message.plan?.steps.map((step) => step.step).slice(0, 2) ?? [],
      })
    }

    const planDelta = readPlanDelta(notification)
    if (planDelta) {
      upsertLivePlanMessage(planDelta.threadId, planDelta.message)
      setTurnActivityForThread(planDelta.threadId, {
        label: 'Planning',
        details: [],
      })
    }

    const collabAgentsUpdate = readCollabAgentsUpdate(notification)
    if (collabAgentsUpdate) {
      const previousAgents = liveCollabAgentsByThreadId.value[collabAgentsUpdate.threadId] ?? []
      const mergedAgentsById = new Map(previousAgents.map((agent) => [agent.id, agent]))
      for (const agent of collabAgentsUpdate.agents) {
        const summaryTask = collabAgentReasoningSummaryByThreadId.value[agent.id]
        mergedAgentsById.set(agent.id, summaryTask ? { ...agent, task: summaryTask } : agent)
        scheduleCollabAgentNameLookup(agent.id)
      }
      setLiveCollabAgentsForThread(collabAgentsUpdate.threadId, Array.from(mergedAgentsById.values()))
    }

    applyCollabAgentRealtimeUpdate(notification)
    applyMcpActivityRealtimeUpdate(notification)

    if (!notificationThreadId) return

    const startedAgentMessageId = readAgentMessageStartedId(notification)
    if (startedAgentMessageId) {
      activeReasoningItemId = ''
    }

    const liveAgentMessageDelta = readAgentMessageDelta(notification)
    if (liveAgentMessageDelta) {
      const existing = (liveAgentMessagesByThreadId.value[notificationThreadId] ?? [])
        .find((message) => message.id === liveAgentMessageDelta.messageId)
      const nextText = `${existing?.text ?? ''}${liveAgentMessageDelta.delta}`
      upsertLiveAgentMessage(notificationThreadId, {
        id: liveAgentMessageDelta.messageId,
        role: 'assistant',
        text: nextText,
        messageType: 'agentMessage.live',
      })
    }

    const completedAgentMessage = readAgentMessageCompleted(notification)
    if (completedAgentMessage) {
      upsertLiveAgentMessage(notificationThreadId, completedAgentMessage)
    }

    const completedImageView = readCompletedImageView(notification)
    if (completedImageView) {
      upsertLiveAgentMessage(notificationThreadId, completedImageView)

    }

    const startedReasoningItemId = readReasoningStartedItemId(notification)
    if (startedReasoningItemId) {
      activeReasoningItemId = startedReasoningItemId
    }

    const liveReasoningDelta = readReasoningDelta(notification)
    if (liveReasoningDelta) {
      appendLiveReasoningText(notificationThreadId, liveReasoningDelta.delta)
    }

    const sectionBreakMessageId = readReasoningSectionBreakMessageId(notification)
    if (sectionBreakMessageId) {
      const current = liveReasoningTextByThreadId.value[notificationThreadId] ?? ''
      if (current.trim().length > 0 && !current.endsWith('\n\n')) {
        setLiveReasoningText(notificationThreadId, `${current}\n\n`)
      }
    }

    const completedReasoningMessageId = readReasoningCompletedId(notification)
    if (completedReasoningMessageId) {
      if (completedReasoningMessageId === liveReasoningMessageId(activeReasoningItemId)) {
        activeReasoningItemId = ''
      }
    }

    const commandStarted = readCommandExecutionStarted(notification)
    if (commandStarted) {
      upsertLiveCommand(notificationThreadId, commandStarted)
      setTurnActivityForThread(notificationThreadId, { label: 'Running command', details: [commandStarted.commandExecution?.command ?? ''] })
    }

    const commandDelta = readCommandOutputDelta(notification)
    if (commandDelta) {
      const current = (liveCommandsByThreadId.value[notificationThreadId] ?? []).find((m) => m.id === commandDelta.itemId)
      if (current?.commandExecution) {
        upsertLiveCommand(notificationThreadId, {
          ...current,
          commandExecution: { ...current.commandExecution, aggregatedOutput: `${current.commandExecution.aggregatedOutput}${commandDelta.delta}` },
        })
      }
    }

    const commandCompleted = readCommandExecutionCompleted(notification)
    if (commandCompleted) {
      upsertLiveCommand(notificationThreadId, commandCompleted)
    }

    const completedFileChange = readCompletedFileChange(notification)
    if (completedFileChange) {
      upsertLiveFileChangeMessage(notificationThreadId, completedFileChange)
    }

    if (isAgentContentEvent(notification)) {
      activeReasoningItemId = ''
      clearLiveReasoningForThread(notificationThreadId)
    }

    if (notification.method === 'turn/completed') {
      activeReasoningItemId = ''
      shouldAutoScrollOnNextAgentEvent = false
      clearLiveReasoningForThread(notificationThreadId)
      if (liveCommandsByThreadId.value[notificationThreadId]) {
        liveCommandsByThreadId.value = omitKey(liveCommandsByThreadId.value, notificationThreadId)
      }
      const completedThreadId = extractThreadIdFromNotification(notification)
      if (completedThreadId) {
        setThreadInProgress(completedThreadId, false)
        setTurnActivityForThread(completedThreadId, null)
        markThreadUnreadByEvent(completedThreadId)
        if (!shouldRetryWithFallback) {
          clearPendingTurnRequest(completedThreadId)
          scheduleQueueStateRefresh(completedThreadId)
        }
        if (!turnErrorMessage) {
          clearPreviousResponseAutoContinueAttempt(completedThreadId)
        }
      }
    }

  }

  function queueEventDrivenSync(notification: RpcNotification): void {
    if (notification.method === 'thread/tokenUsage/updated') return

    const method = notification.method
    const shouldRefreshMessages =
      method === 'turn/started' ||
      method === 'turn/completed' ||
      method === 'error'
    const shouldRefreshThreads =
      method.startsWith('thread/') ||
      method === 'turn/completed'

    if (!shouldRefreshMessages && !shouldRefreshThreads) return

    const threadId = extractThreadIdFromNotification(notification)
    if (threadId && shouldRefreshMessages) {
      pendingThreadMessageRefresh.add(threadId)
    }

    if (shouldRefreshThreads) {
      pendingThreadsRefresh = true
    }

    if (eventSyncTimer !== null || typeof window === 'undefined') return
    eventSyncTimer = window.setTimeout(() => {
      eventSyncTimer = null
      void syncFromNotifications()
    }, EVENT_SYNC_DEBOUNCE_MS)
  }

  async function hydrateWorkspaceRootsStateIfNeeded(
    groups: UiProjectGroup[],
    rootsState: WorkspaceRootsState | null,
  ): Promise<void> {
    if (hasHydratedWorkspaceRootsState) return
    hasHydratedWorkspaceRootsState = true

    try {
      if (!rootsState) return
      const hydratedOrder: string[] = []
      for (const rootPath of getWorkspaceProjectOrderPaths(rootsState)) {
        const projectName = toProjectNameFromWorkspaceRoot(rootPath)
        if (hydratedOrder.includes(projectName)) continue
        hydratedOrder.push(projectName)
      }

      if (hydratedOrder.length > 0) {
        const mergedOrder = rootsState.projectOrder.length > 0
          ? mergeProjectOrder(hydratedOrder, groups)
          : mergeProjectOrder(projectOrder.value, groups)
        if (!areStringArraysEqual(projectOrder.value, mergedOrder)) {
          projectOrder.value = mergedOrder
        }
      }

      if (Object.keys(rootsState.labels).length > 0 || (rootsState.remoteProjects ?? []).length > 0) {
        const nextLabels = { ...projectDisplayNameById.value }
        let changed = false
        for (const [rootPath, label] of Object.entries(rootsState.labels)) {
          const normalizedRootPath = normalizePathForUi(rootPath).trim()
          const projectNames = [toProjectNameFromWorkspaceRoot(rootPath)]
          if (normalizedRootPath) projectNames.push(normalizedRootPath)
          for (const projectName of projectNames) {
            if (nextLabels[projectName] === label) continue
            nextLabels[projectName] = label
            changed = true
          }
        }
        for (const rootPath of rootsState.order) {
          const leafName = toProjectNameFromWorkspaceRoot(rootPath)
          const parentLeafName = toProjectName(getPathParent(rootPath))
          if (!parentLeafName.startsWith('.') || parentLeafName === leafName) continue
          const displayName = `${leafName} ${parentLeafName}`
          if (nextLabels[leafName] !== undefined || nextLabels[leafName] === displayName) continue
          nextLabels[leafName] = displayName
          changed = true
        }
        for (const remoteProject of rootsState.remoteProjects ?? []) {
          const label = getRemoteProjectDisplayName(remoteProject)
          if (nextLabels[remoteProject.id] === label) continue
          nextLabels[remoteProject.id] = label
          changed = true
        }
        if (changed) {
          projectDisplayNameById.value = nextLabels
        }
      }
    } catch {
      // Keep local storage fallback when global state is unavailable.
    }
  }

  async function loadThreadTitleCacheIfNeeded(): Promise<void> {
    if (Object.keys(threadTitleById.value).length > 0) return
    try {
      const cache = await getThreadTitleCache()
      if (Object.keys(cache.titles).length > 0) {
        threadTitleById.value = cache.titles
      }
    } catch {
      // Title cache is optional; keep UI functional.
    }
  }

  async function refreshThreadReadState(): Promise<void> {
    try {
      const serverState = await getThreadReadState()
      const serverReadState = serverState.readAtByThreadId ?? {}
      const merged = mergeReadStateMaps(readStateByThreadId.value, serverReadState)
      if (!areReadStateMapsEqual(readStateByThreadId.value, merged)) {
        readStateByThreadId.value = merged
        saveReadStateMap(merged)
        applyThreadFlags()
      }

      if (!hasUploadedLegacyReadState && !areReadStateMapsEqual(serverReadState, merged)) {
        hasUploadedLegacyReadState = true
        void persistThreadReadState({ readAtByThreadId: merged })
      } else {
        hasUploadedLegacyReadState = true
      }
    } catch {
      // Keep local read markers when shared state is unavailable.
    }
  }

  async function loadWorkspaceRootsStateForThreadList(): Promise<WorkspaceRootsState | null> {
    try {
      return await getWorkspaceRootsState()
    } catch {
      return null
    }
  }

  function filterGroupsByWorkspaceRoots(
    groups: UiProjectGroup[],
    rootsState: WorkspaceRootsState | null,
  ): UiProjectGroup[] {
    const duplicateLeafNames = collectDuplicateProjectLeafNames(groups, rootsState)
    const disambiguatedGroups = disambiguateProjectGroupsByCwd(groups, rootsState)
    const groupsWithWorkspaceRoots = addWorkspaceRootPlaceholderGroups(disambiguatedGroups, rootsState, duplicateLeafNames)
    if (!rootsState || (rootsState.order.length === 0 && (rootsState.remoteProjects ?? []).length === 0)) return groupsWithWorkspaceRoots
    const allowedProjectNames = new Set<string>()
    for (const projectName of getWorkspaceProjectOrderNames(rootsState, duplicateLeafNames)) {
      allowedProjectNames.add(projectName)
    }
    const filteredGroups = groupsWithWorkspaceRoots.filter((group) => {
      if (allowedProjectNames.has(group.projectName)) return true
      return isProjectlessGroup(group)
    })
    return orderGroupsByWorkspaceProjectOrder(filteredGroups, rootsState, duplicateLeafNames)
  }

  function applyThreadGroups(groups: UiProjectGroup[], rootsState: WorkspaceRootsState | null): void {
    const visibleGroups = filterThreadGroupsByExcludedIds(
      filterGroupsByWorkspaceRoots(groups, rootsState),
      locallyArchivedThreadIds,
    )
    rememberCollabAgentMetadataFromGroups(visibleGroups)
    const hasWorkspaceRootsState = Boolean(
      rootsState && (rootsState.order.length > 0 || rootsState.projectOrder.length > 0 || (rootsState.remoteProjects ?? []).length > 0),
    )

    const nextProjectOrder = rootsState?.projectOrder.length
      ? mergeProjectOrder(
        getWorkspaceProjectOrderNames(rootsState, collectDuplicateProjectLeafNames(groups, rootsState)),
        visibleGroups,
      )
      : mergeProjectOrder(projectOrder.value, visibleGroups)
    if (!areStringArraysEqual(projectOrder.value, nextProjectOrder)) {
      projectOrder.value = nextProjectOrder
      if (!hasWorkspaceRootsState) {
        saveProjectOrder(projectOrder.value)
      }
    }

    const orderedGroups = orderGroupsByProjectOrder(visibleGroups, projectOrder.value)
    markServerListedThreads(new Set(flattenThreads(orderedGroups).map((thread) => thread.id)))
    const mergedWithInProgress = mergeIncomingWithLocalInProgressThreads(
      sourceGroups.value,
      orderedGroups,
      inProgressById.value,
    )
    sourceGroups.value = mergeThreadGroups(sourceGroups.value, mergedWithInProgress)
    inProgressById.value = pruneThreadStateMap(
      inProgressById.value,
      new Set(flattenThreads(sourceGroups.value).map((thread) => thread.id)),
    )
    applyThreadFlags()
  }

  function normalizeQueueStateForPersistence(state: Record<string, QueuedMessage[]>): ThreadQueueState {
    const next: ThreadQueueState = {}
    for (const [threadId, queue] of Object.entries(state)) {
      const normalizedThreadId = threadId.trim()
      if (!normalizedThreadId || queue.length === 0) continue
      next[normalizedThreadId] = queue.map((message) => ({
        id: message.id,
        text: message.text,
        imageUrls: [...message.imageUrls],
        skills: message.skills.map((skill) => ({ name: skill.name, path: skill.path })),
        fileAttachments: message.fileAttachments.map((attachment) => ({
          label: attachment.label,
          path: attachment.path,
          fsPath: attachment.fsPath,
        })),
        collaborationMode: message.collaborationMode,
      }))
    }
    return next
  }

  function persistQueueState(): void {
    void setThreadQueueState(normalizeQueueStateForPersistence(queuedMessagesByThreadId.value)).catch(() => {
      // Queue persistence is best-effort; keep the current in-memory queue usable.
    })
  }

  async function persistQueueStateNow(): Promise<void> {
    await setThreadQueueState(normalizeQueueStateForPersistence(queuedMessagesByThreadId.value))
  }

  async function loadPersistedQueueStateIfNeeded(): Promise<void> {
    if (hasLoadedPersistedQueueState) return
    hasLoadedPersistedQueueState = true
    try {
      queuedMessagesByThreadId.value = await getThreadQueueState()
    } catch {
      // Backend queue state is optional during startup.
    }
  }

  function removeArchivedThreadFromLoadedLists(threadId: string): void {
    loadedThreadListGroups = removeThreadFromGroups(loadedThreadListGroups, threadId)
    sourceGroups.value = removeThreadFromGroups(sourceGroups.value, threadId)
    inProgressById.value = omitKey(inProgressById.value, threadId)
    applyThreadFlags()
  }

  function mergeThreadGroupPages(previous: UiProjectGroup[], incoming: UiProjectGroup[]): UiProjectGroup[] {
    if (previous.length === 0) return incoming
    if (incoming.length === 0) return previous

    const threadById = new Map<string, UiThread>()
    for (const thread of flattenThreads(previous)) {
      threadById.set(thread.id, thread)
    }
    for (const thread of flattenThreads(incoming)) {
      threadById.set(thread.id, thread)
    }
    const groupsByProject = new Map<string, UiThread[]>()
    for (const thread of threadById.values()) {
      const existing = groupsByProject.get(thread.projectName)
      if (existing) existing.push(thread)
      else groupsByProject.set(thread.projectName, [thread])
    }

    return Array.from(groupsByProject.entries())
      .map(([projectName, threads]) => ({
        projectName,
        threads: threads.sort(
          (first, second) => new Date(second.updatedAtIso).getTime() - new Date(first.updatedAtIso).getTime(),
        ),
      }))
      .sort((first, second) => {
        const firstUpdated = new Date(first.threads[0]?.updatedAtIso ?? 0).getTime()
        const secondUpdated = new Date(second.threads[0]?.updatedAtIso ?? 0).getTime()
        return secondUpdated - firstUpdated
      })
  }

  function hasActiveInProgressThreads(): boolean {
    return Object.values(inProgressById.value).some((value) => value === true)
  }

  function scheduleRemainingThreadPages(rootsState: WorkspaceRootsState | null = loadedThreadListRootsState): void {
    if (!threadListNextCursor || isLoadingRemainingThreadPages || hasActiveInProgressThreads()) return

    loadedThreadListRootsState = rootsState

    if (typeof window === 'undefined') {
      void loadRemainingThreadPages(rootsState)
      return
    }

    if (threadListBackgroundTimer !== null) {
      window.clearTimeout(threadListBackgroundTimer)
    }

    threadListBackgroundTimer = window.setTimeout(() => {
      threadListBackgroundTimer = null
      if (!threadListNextCursor || hasActiveInProgressThreads()) return
      void loadRemainingThreadPages(loadedThreadListRootsState)
    }, BACKGROUND_THREAD_PAGINATION_DELAY_MS)
  }

  async function loadRemainingThreadPages(rootsState: WorkspaceRootsState | null): Promise<void> {
    if (isLoadingRemainingThreadPages || !threadListNextCursor || hasActiveInProgressThreads()) return
    isLoadingRemainingThreadPages = true

    try {
      const page = await getThreadGroupsPage(threadListNextCursor, getBackgroundThreadListLimit())
      threadListNextCursor = page.nextCursor
      hasLoadedAllThreadPages = page.nextCursor === null
      isThreadListFullyLoaded.value = hasLoadedAllThreadPages
      loadedThreadListGroups = mergeThreadGroupPages(loadedThreadListGroups, page.groups)
      applyThreadGroups(loadedThreadListGroups, rootsState)
    } catch {
      // Keep the first page usable; a later refresh can retry remaining pages.
    } finally {
      isLoadingRemainingThreadPages = false
      if (threadListNextCursor && !hasActiveInProgressThreads()) {
        scheduleRemainingThreadPages(rootsState)
      }
    }
  }

  async function loadThreads() {
    if (loadThreadsPromise) {
      await loadThreadsPromise
      return
    }

    loadThreadsPromise = (async () => {
    if (!hasLoadedThreads.value) {
      isLoadingThreads.value = true
    }

    try {
      const [page, rootsState] = await Promise.all([
        getThreadGroupsPage(),
        loadWorkspaceRootsStateForThreadList(),
        loadThreadTitleCacheIfNeeded(),
        refreshThreadReadState(),
      ])
      loadedThreadListRootsState = rootsState
      const groups = page.groups
      loadedThreadListGroups = hasLoadedThreads.value
        ? mergeThreadGroupPages(loadedThreadListGroups, groups)
        : groups
      threadListNextCursor = hasLoadedThreads.value && !hasLoadedAllThreadPages
        ? threadListNextCursor
        : page.nextCursor
      hasLoadedAllThreadPages = page.nextCursor === null
      isThreadListFullyLoaded.value = hasLoadedAllThreadPages
      await hydrateWorkspaceRootsStateIfNeeded(groups, rootsState)

      applyThreadGroups(loadedThreadListGroups, rootsState)
      hasLoadedThreads.value = true
      if (!hasLoadedAllThreadPages) {
        scheduleRemainingThreadPages(rootsState)
      }

      const flatThreads = flattenThreads(projectGroups.value)
      pruneThreadScopedState(flatThreads)

      const currentExists = flatThreads.some((thread) => thread.id === selectedThreadId.value)

      if (!currentExists) {
        setSelectedThreadId(flatThreads[0]?.id ?? '')
      }
    } finally {
      isLoadingThreads.value = false
    }
    })().finally(() => {
      loadThreadsPromise = null
    })

    await loadThreadsPromise
  }

  async function loadMessages(threadId: string, options: { silent?: boolean } = {}) {
    if (!threadId) {
      return
    }

    const existingLoad = loadMessagePromiseByThreadId.get(threadId)
    if (existingLoad) {
      await existingLoad
      return
    }

    const alreadyLoaded = loadedMessagesByThreadId.value[threadId] === true
    const shouldShowLoading = options.silent !== true && !alreadyLoaded
    if (shouldShowLoading) {
      isLoadingMessages.value = true
    }

    const loadPromise = (async () => {
      try {
      const version = currentThreadVersion(threadId)
      const loadedVersion = loadedVersionByThreadId.value[threadId] ?? ''
      const loadedRecently =
        Date.now() - (lastMessageLoadAtByThreadId.get(threadId) ?? 0) < RECENT_THREAD_MESSAGE_LOAD_REUSE_MS
      const canReuseLoadedMessages =
        alreadyLoaded &&
        (
          loadedRecently ||
          (
            (version.length === 0 || loadedVersion === version) &&
            inProgressById.value[threadId] !== true
          )
        )

      if (canReuseLoadedMessages) {
        markThreadAsRead(threadId)
        return
      }

      const needsResume = resumedThreadById.value[threadId] !== true
      const resumedThread = needsResume ? await resumeThread(threadId) : null
      const detail = resumedThread ?? await getThreadDetail(threadId)

      if (resumedThread) {
        setThreadModelId(threadId, resumedThread.model)
        resumedThreadById.value = {
          ...resumedThreadById.value,
          [threadId]: true,
        }
      }

      const { messages: nextMessages, inProgress, activeTurnId, turnIndexByTurnId, collabAgents } = detail
      hasMoreOlderMessagesByThreadId.value = {
        ...hasMoreOlderMessagesByThreadId.value,
        [threadId]: detail.hasMoreOlder === true,
      }
      markThreadMessagesPersisted(threadId, nextMessages)
      replaceTurnIndexLookupForThread(threadId, turnIndexByTurnId)
      rebindLiveFileChangeTurnIndices(threadId)
      const previousPersisted = persistedMessagesByThreadId.value[threadId] ?? []
      const mergedMessages = mergeMessages(previousPersisted, nextMessages, {
        preserveMissing: options.silent === true,
      })
      setPersistedMessagesForThread(threadId, mergedMessages)

      const previousLiveAgent = liveAgentMessagesByThreadId.value[threadId] ?? []
      if (inProgress) {
        const nextLiveAgent = removeRedundantLiveAgentMessages(previousLiveAgent, nextMessages)
        setLiveAgentMessagesForThread(threadId, nextLiveAgent)
        if (collabAgents.length > 0) {
          let parentMapChanged = false
          const nextParentMap = { ...collabAgentParentThreadIdByThreadId.value }
          const nextCollabAgents = collabAgents.map((agent) => {
            scheduleCollabAgentNameLookup(agent.id)
            if (nextParentMap[agent.id] !== threadId) {
              nextParentMap[agent.id] = threadId
              parentMapChanged = true
            }
            const displayName = collabAgentDisplayNameByThreadId.value[agent.id]
            const summaryTask = collabAgentReasoningSummaryByThreadId.value[agent.id]
            return {
              ...agent,
              ...(displayName ? { name: displayName } : {}),
              ...(summaryTask ? { task: summaryTask } : {}),
            }
          })
          if (parentMapChanged) {
            collabAgentParentThreadIdByThreadId.value = nextParentMap
          }
          setLiveCollabAgentsForThread(threadId, nextCollabAgents)
        }
      } else {
        clearLiveAgentMessagesForThread(threadId)
        clearLiveCollabAgentsForThread(threadId)
        clearLiveMcpActivitiesForThread(threadId)
      }
      removeLiveCommandsPersistedIn(threadId, nextMessages)
      removeLiveFileChangesPersistedIn(threadId, nextMessages)

      loadedMessagesByThreadId.value = {
        ...loadedMessagesByThreadId.value,
        [threadId]: true,
      }
      lastMessageLoadAtByThreadId.set(threadId, Date.now())

      if (version) {
        loadedVersionByThreadId.value = {
          ...loadedVersionByThreadId.value,
          [threadId]: version,
        }
      }
      setThreadInProgress(threadId, inProgress)
      if (activeTurnId) {
        activeTurnIdByThreadId.value = {
          ...activeTurnIdByThreadId.value,
          [threadId]: activeTurnId,
        }
      } else if (activeTurnIdByThreadId.value[threadId]) {
        activeTurnIdByThreadId.value = omitKey(activeTurnIdByThreadId.value, threadId)
      }
      if (!inProgress) {
        clearCompletedTurnLiveState(threadId)
      }
      markThreadAsRead(threadId)
      } finally {
      if (shouldShowLoading) {
        isLoadingMessages.value = false
      }
      }
    })().finally(() => {
      loadMessagePromiseByThreadId.delete(threadId)
    })

    loadMessagePromiseByThreadId.set(threadId, loadPromise)
    await loadPromise
  }

  async function loadOlderMessages(threadId: string = selectedThreadId.value): Promise<void> {
    if (!threadId) return
    if (loadingOlderMessagesByThreadId.value[threadId] === true) return
    if (hasMoreOlderMessagesByThreadId.value[threadId] !== true) return

    const beforeTurnId = getFirstPersistedTurnId(threadId)
    if (!beforeTurnId) {
      hasMoreOlderMessagesByThreadId.value = {
        ...hasMoreOlderMessagesByThreadId.value,
        [threadId]: false,
      }
      return
    }

    loadingOlderMessagesByThreadId.value = {
      ...loadingOlderMessagesByThreadId.value,
      [threadId]: true,
    }

    try {
      const page = await getOlderThreadMessages(threadId, beforeTurnId)
      const previousPersisted = persistedMessagesByThreadId.value[threadId] ?? []
      const mergedMessages = mergeMessages(page.messages, previousPersisted, { preserveMissing: true })
      setPersistedMessagesForThread(threadId, mergedMessages)
      replaceTurnIndexLookupForThread(threadId, {
        ...(turnIndexByTurnIdByThreadId.value[threadId] ?? {}),
        ...page.turnIndexByTurnId,
      })
      rebindLiveFileChangeTurnIndices(threadId)
      hasMoreOlderMessagesByThreadId.value = {
        ...hasMoreOlderMessagesByThreadId.value,
        [threadId]: page.hasMoreOlder,
      }
    } catch (loadError) {
      error.value = loadError instanceof Error ? loadError.message : 'Failed to load earlier messages'
      throw loadError
    } finally {
      loadingOlderMessagesByThreadId.value = {
        ...loadingOlderMessagesByThreadId.value,
        [threadId]: false,
      }
    }
  }

  async function ensureThreadMessagesLoaded(threadId: string, options: { silent?: boolean } = {}): Promise<void> {
    if (!threadId) return
    if (loadedMessagesByThreadId.value[threadId] === true) return
    await loadMessages(threadId, options)
  }

  async function refreshSkills(): Promise<void> {
    if (refreshSkillsPromise) {
      await refreshSkillsPromise
      return
    }

    refreshSkillsPromise = (async () => {
      try {
        const selectedCwd = selectedThread.value?.cwd?.trim() ?? ''
        installedSkills.value = await getSkillsList(selectedCwd ? [selectedCwd] : undefined)
      } catch {
        // keep previous skills on failure
      } finally {
        refreshSkillsPromise = null
      }
    })()

    await refreshSkillsPromise
  }

  async function refreshAncillaryState(
    options: { providerChanged?: boolean; includeProviderModels?: boolean } = {},
  ): Promise<void> {
    await Promise.allSettled([
      refreshModelPreferences({
        providerChanged: options.providerChanged,
        includeProviderModels: options.includeProviderModels,
      }),
      refreshRateLimits(),
      refreshCollaborationModes(),
      refreshSkills(),
    ])
  }

  function scheduleAncillaryStateRefresh(
    options: { providerChanged?: boolean; includeProviderModels?: boolean } = {},
  ): void {
    const run = () => {
      void refreshAncillaryState(options)
    }

    if (typeof window === 'undefined') {
      run()
      return
    }

    window.setTimeout(run, 0)
  }

  async function refreshAll(
    options: { includeSelectedThreadMessages?: boolean; awaitAncillaryRefreshes?: boolean; providerChanged?: boolean } = {},
  ) {
    error.value = ''
    codexCliMissingError.value = ''
    const includeSelectedThreadMessages = options.includeSelectedThreadMessages !== false
    const awaitAncillaryRefreshes = options.awaitAncillaryRefreshes === true

    try {
      await loadPersistedQueueStateIfNeeded()
      await loadThreads()
      if (includeSelectedThreadMessages) {
        await loadMessages(selectedThreadId.value)
      }
      if (awaitAncillaryRefreshes) {
        await refreshAncillaryState({
          providerChanged: options.providerChanged,
          includeProviderModels: options.providerChanged === true || awaitAncillaryRefreshes,
        })
      } else {
        scheduleAncillaryStateRefresh({
          providerChanged: options.providerChanged,
          includeProviderModels: false,
        })
      }
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
      if (isCodexCliMissingError(unknownError)) {
        codexCliMissingError.value = CODEX_CLI_MISSING_MESSAGE
      } else {
        codexCliMissingError.value = ''
      }
    }
  }

  async function selectThread(threadId: string) {
    setSelectedThreadId(threadId)

    try {
      await loadMessages(threadId)
      void refreshSkills()
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
    }
  }

  async function archiveThreadById(threadId: string) {
    const previousSourceGroups = sourceGroups.value
    const previousProjectGroups = projectGroups.value
    const previousLoadedThreadListGroups = loadedThreadListGroups
    const previousSelectedThreadId = selectedThreadId.value
    const wasSelectedThread = selectedThreadId.value === threadId
    const nextSelectedThreadId = wasSelectedThread
      ? findAdjacentThreadId(flattenThreads(projectGroups.value), threadId)
      : ''

    if (wasSelectedThread) {
      setSelectedThreadId(nextSelectedThreadId)
      if (nextSelectedThreadId) {
        void loadMessages(nextSelectedThreadId, { silent: true })
      }
    }

    try {
      locallyArchivedThreadIds.add(threadId)
      loadedThreadListGroups = removeThreadFromGroups(loadedThreadListGroups, threadId)
      sourceGroups.value = removeThreadFromGroups(sourceGroups.value, threadId)
      projectGroups.value = removeThreadFromGroups(projectGroups.value, threadId)
      const flatThreads = flattenThreads(projectGroups.value)
      if (selectedThreadId.value === threadId) {
        setSelectedThreadId(flatThreads[0]?.id ?? '')
      }

      await archiveThread(threadId)
      removeArchivedThreadFromLoadedLists(threadId)
      await loadThreads()

      if (wasSelectedThread && nextSelectedThreadId && selectedThreadId.value === nextSelectedThreadId) {
        await ensureThreadMessagesLoaded(nextSelectedThreadId, { silent: true })
      }
    } catch (unknownError) {
      locallyArchivedThreadIds.delete(threadId)
      loadedThreadListGroups = previousLoadedThreadListGroups
      sourceGroups.value = previousSourceGroups
      projectGroups.value = previousProjectGroups
      if (selectedThreadId.value !== previousSelectedThreadId) {
        setSelectedThreadId(previousSelectedThreadId)
      }
      error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
    }
  }

  async function renameThreadById(threadId: string, threadName: string) {
    const normalizedName = threadName.trim()
    if (!threadId || !normalizedName) return

    try {
      await renameThread(threadId, normalizedName)
      threadTitleById.value = { ...threadTitleById.value, [threadId]: normalizedName }
      applyThreadFlags()
      void persistThreadTitle(threadId, normalizedName)
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
    }
  }

  async function forkThreadById(threadId: string): Promise<string> {
    const sourceThreadId = threadId.trim()
    if (!sourceThreadId) return ''

    const sourceThread = flattenThreads(sourceGroups.value).find((row) => row.id === sourceThreadId)
    const sourceCwd = sourceThread?.cwd?.trim() ?? ''
    const sourceTitle = sourceThread?.title?.trim() ?? 'Forked chat'
    const selectedModel = readModelIdForThread(sourceThreadId)
    error.value = ''

    try {
      const forkedThread = await forkThread(sourceThreadId, sourceCwd || undefined, selectedModel || undefined)
      const nextThreadId = forkedThread.threadId.trim()
      if (!nextThreadId) return ''

      insertOptimisticThread(nextThreadId, sourceCwd, sourceTitle)
      setThreadModelId(nextThreadId, forkedThread.model)
      resumedThreadById.value = {
        ...resumedThreadById.value,
        [nextThreadId]: true,
      }
      setSelectedThreadId(nextThreadId)
      await loadThreads()
      await loadMessages(nextThreadId)
      return nextThreadId
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
      return ''
    }
  }

  async function forkThreadFromTurn(threadId: string, turnIndex: number): Promise<string> {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId || !Number.isInteger(turnIndex) || turnIndex < 0) return ''

    if (inProgressById.value[normalizedThreadId] === true) {
      error.value = 'Finish the current turn before forking from a response.'
      return ''
    }

    if (loadedMessagesByThreadId.value[normalizedThreadId] !== true) {
      try {
        await loadMessages(normalizedThreadId)
      } catch (unknownError) {
        error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
        return ''
      }
    }

    const sourceMessages = persistedMessagesByThreadId.value[normalizedThreadId] ?? []
    let lastTurnIndex = -1
    for (const message of sourceMessages) {
      if (typeof message.turnIndex === 'number' && Number.isFinite(message.turnIndex)) {
        lastTurnIndex = Math.max(lastTurnIndex, message.turnIndex)
      }
    }

    if (lastTurnIndex >= 0 && turnIndex > lastTurnIndex) return ''

    const sourceThread = flattenThreads(sourceGroups.value).find((row) => row.id === normalizedThreadId) ?? null

    try {
      error.value = ''
      const forked = await forkThread(normalizedThreadId)
      const forkedThreadId = forked.threadId.trim()
      if (!forkedThreadId) return ''

      const forkedCwd = forked.cwd.trim() || sourceThread?.cwd?.trim() || ''
      const forkedThreadTitle = toForkedThreadTitle(sourceThread?.title || sourceThread?.preview || 'Untitled thread')
      insertOptimisticThread(forkedThreadId, forkedCwd, forkedThreadTitle)
      setThreadModelId(forkedThreadId, forked.model)
      setPersistedMessagesForThread(forkedThreadId, forked.messages)
      loadedMessagesByThreadId.value = {
        ...loadedMessagesByThreadId.value,
        [forkedThreadId]: true,
      }
      resumedThreadById.value = {
        ...resumedThreadById.value,
        [forkedThreadId]: true,
      }
      clearLivePlansForThread(forkedThreadId)
      setLiveAgentMessagesForThread(forkedThreadId, [])
      clearLiveReasoningForThread(forkedThreadId)
      clearLiveCollabAgentsForThread(forkedThreadId)
      clearLiveMcpActivitiesForThread(forkedThreadId)
      if (liveCommandsByThreadId.value[forkedThreadId]) {
        liveCommandsByThreadId.value = omitKey(liveCommandsByThreadId.value, forkedThreadId)
      }
      setTurnSummaryForThread(forkedThreadId, null)
      setTurnActivityForThread(forkedThreadId, null)
      setTurnErrorForThread(forkedThreadId, null)
      setThreadInProgress(forkedThreadId, false)

      const turnsToRollback = lastTurnIndex - turnIndex
      if (turnsToRollback > 0) {
        const rolledBackMessages = await rollbackThread(forkedThreadId, turnsToRollback)
        setPersistedMessagesForThread(forkedThreadId, rolledBackMessages)
      }

      await renameThreadById(forkedThreadId, forkedThreadTitle)
      setSelectedThreadId(forkedThreadId)
      void loadThreads().catch(() => {})
      return forkedThreadId
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
      return ''
    }
  }

  async function maybeReplyToPendingUserInputRequest(
    threadId: string,
    text: string,
    imageUrls: string[] = [],
    skills: Array<{ name: string; path: string }> = [],
    fileAttachments: FileAttachment[] = [],
  ): Promise<boolean> {
    if (!threadId || !text.trim()) return false
    if (imageUrls.length > 0 || skills.length > 0 || fileAttachments.length > 0) return false

    const requests = pendingServerRequestsByThreadId.value[threadId] ?? []
    const userInputRequests = requests.filter((request) => request.method === 'item/tool/requestUserInput')
    if (userInputRequests.length !== 1) return false

    const [request] = userInputRequests
    const questionIds = readToolRequestUserInputQuestionIds(request)
    if (questionIds.length !== 1) return false

    return respondToPendingServerRequest({
      id: request.id,
      result: {
        answers: {
          [questionIds[0]]: {
            answers: [text.trim()],
          },
        },
      },
    })
  }

  function resolveSendCollaborationMode(collaborationModeOverride?: CollaborationModeKind): CollaborationModeKind {
    return collaborationModeOverride === 'plan'
      ? 'plan'
      : collaborationModeOverride === 'default'
        ? 'default'
        : selectedCollaborationMode.value
  }

  async function refreshTargetThreadInProgress(threadId: string): Promise<boolean> {
    if (inProgressById.value[threadId] === true) return true

    try {
      const summary = await getThreadSummary(threadId)
      setThreadInProgress(threadId, summary.inProgress === true)
      return summary.inProgress === true
    } catch {
      const latestInProgressById: Record<string, boolean | undefined> = inProgressById.value
      return latestInProgressById[threadId] === true
    }
  }

  async function queueMessageForThread(
    threadId: string,
    text: string,
    imageUrls: string[],
    skills: Array<{ name: string; path: string }>,
    fileAttachments: FileAttachment[],
    queueInsertIndex: number | undefined,
    collaborationModeOverride?: CollaborationModeKind,
    requirePersistence = false,
  ): Promise<void> {
    await loadPersistedQueueStateIfNeeded()
    const queue = queuedMessagesByThreadId.value[threadId] ?? []
    const id = `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const nextQueue = [...queue]
    const insertIndex = typeof queueInsertIndex === 'number'
      ? Math.max(0, Math.min(queueInsertIndex, nextQueue.length))
      : nextQueue.length
    nextQueue.splice(insertIndex, 0, {
      id,
      text,
      imageUrls: [...imageUrls],
      skills: skills.map((skill) => ({ name: skill.name, path: skill.path })),
      fileAttachments: fileAttachments.map((file) => ({ ...file })),
      collaborationMode: resolveSendCollaborationMode(collaborationModeOverride),
    })
    queuedMessagesByThreadId.value = {
      ...queuedMessagesByThreadId.value,
      [threadId]: nextQueue,
    }
    if (requirePersistence) {
      await persistQueueStateNow()
    } else {
      persistQueueState()
    }
  }

  async function sendMessageToThreadInternal(
    threadId: string,
    text: string,
    imageUrls: string[],
    skills: Array<{ name: string; path: string }>,
    busyMode: 'steer' | 'queue',
    fileAttachments: FileAttachment[],
    queueInsertIndex: number | undefined,
    collaborationModeOverride: CollaborationModeKind | undefined,
    options: {
      refreshThreadStatus: boolean
      surfaceGlobalError: boolean
      enableAutoScroll: boolean
      requireQueuePersistence: boolean
    },
  ): Promise<SendMessageResult> {
    if (isUpdatingSpeedMode.value) return 'ignored'

    const normalizedThreadId = threadId.trim()
    const nextText = text.trim()
    if (!normalizedThreadId || (!nextText && imageUrls.length === 0 && fileAttachments.length === 0)) {
      return 'ignored'
    }

    if (await maybeReplyToPendingUserInputRequest(normalizedThreadId, nextText, imageUrls, skills, fileAttachments)) {
      return 'answered-request'
    }

    const isInProgress = options.refreshThreadStatus
      ? await refreshTargetThreadInProgress(normalizedThreadId)
      : inProgressById.value[normalizedThreadId] === true

    if (isInProgress && busyMode === 'queue') {
      await queueMessageForThread(
        normalizedThreadId,
        nextText,
        imageUrls,
        skills,
        fileAttachments,
        queueInsertIndex,
        collaborationModeOverride,
        options.requireQueuePersistence,
      )
      return 'queued'
    }

    if (isInProgress) {
      if (options.enableAutoScroll) {
        shouldAutoScrollOnNextAgentEvent = true
      }
      void startTurnForThread(
        normalizedThreadId,
        nextText,
        imageUrls,
        skills,
        fileAttachments,
        collaborationModeOverride,
      ).catch((unknownError) => {
        const errorMessage = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
        setTurnErrorForThread(normalizedThreadId, errorMessage)
        if (options.surfaceGlobalError) {
          error.value = errorMessage
        }
      })
      return 'started'
    }

    if (options.surfaceGlobalError) {
      error.value = ''
    }
    if (options.enableAutoScroll) {
      shouldAutoScrollOnNextAgentEvent = true
    }
    setTurnSummaryForThread(normalizedThreadId, null)
    setTurnActivityForThread(
      normalizedThreadId,
      {
        label: 'Thinking',
        details: buildPendingTurnDetails(
          readModelIdForThread(normalizedThreadId),
          selectedReasoningEffort.value,
          resolveSendCollaborationMode(collaborationModeOverride),
        ),
      },
    )
    setTurnErrorForThread(normalizedThreadId, null)
    setThreadInProgress(normalizedThreadId, true)

    try {
      await startTurnForThread(
        normalizedThreadId,
        nextText,
        imageUrls,
        skills,
        fileAttachments,
        collaborationModeOverride,
      )
      return 'started'
    } catch (unknownError) {
      if (options.enableAutoScroll) {
        shouldAutoScrollOnNextAgentEvent = false
      }
      setThreadInProgress(normalizedThreadId, false)
      setTurnActivityForThread(normalizedThreadId, null)
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
      setTurnErrorForThread(normalizedThreadId, errorMessage)
      if (options.surfaceGlobalError) {
        error.value = errorMessage
      }
      throw unknownError
    }
  }

  async function sendMessageToSelectedThread(
    text: string,
    imageUrls: string[] = [],
    skills: Array<{ name: string; path: string }> = [],
    mode: 'steer' | 'queue' = 'steer',
    fileAttachments: FileAttachment[] = [],
    queueInsertIndex?: number,
    collaborationModeOverride?: CollaborationModeKind,
  ): Promise<void> {
    await sendMessageToThreadInternal(
      selectedThreadId.value,
      text,
      imageUrls,
      skills,
      mode,
      fileAttachments,
      queueInsertIndex,
      collaborationModeOverride,
      {
        refreshThreadStatus: false,
        surfaceGlobalError: true,
        enableAutoScroll: true,
        requireQueuePersistence: false,
      },
    )
  }

  async function openSideChatForSelectedThread(): Promise<string> {
    const parentThreadId = selectedThreadId.value.trim()
    if (!parentThreadId) return ''
    if (sideThreadId.value) return sideThreadId.value

    const sideThread = await startSideThread(parentThreadId)
    const nextSideThreadId = sideThread.threadId.trim()
    if (!nextSideThreadId) return ''

    sideThreadId.value = nextSideThreadId
    resumedThreadById.value = {
      ...resumedThreadById.value,
      [nextSideThreadId]: true,
    }
    setThreadModelId(nextSideThreadId, sideThread.model)
    setSelectedCollaborationModeForThread(nextSideThreadId, selectedCollaborationMode.value)
    return nextSideThreadId
  }

  async function sendMessageToSideChat(
    text: string,
    imageUrls: string[] = [],
    skills: Array<{ name: string; path: string }> = [],
    mode: 'steer' | 'queue' = 'steer',
    fileAttachments: FileAttachment[] = [],
  ): Promise<SendMessageResult> {
    const targetSideThreadId = sideThreadId.value.trim()
    if (!targetSideThreadId) return 'ignored'
    const optimisticMessageId = appendSideUserMessage(targetSideThreadId, text)
    try {
      const result = await sendMessageToThreadInternal(
        targetSideThreadId,
        text,
        imageUrls,
        skills,
        mode,
        fileAttachments,
        undefined,
        readSelectedCollaborationMode(selectedCollaborationModeByContext.value, targetSideThreadId),
        {
          refreshThreadStatus: false,
          surfaceGlobalError: false,
          enableAutoScroll: false,
          requireQueuePersistence: false,
        },
      )
      if (result === 'ignored') {
        removeSideUserMessage(targetSideThreadId, optimisticMessageId)
      }
      return result
    } catch (unknownError) {
      removeSideUserMessage(targetSideThreadId, optimisticMessageId)
      throw unknownError
    }
  }

  function closeSideChat(): void {
    const closingThreadId = sideThreadId.value.trim()
    sideThreadId.value = ''
    if (!closingThreadId) return

    clearLiveAgentMessagesForThread(closingThreadId)
    if (sideUserMessagesByThreadId.value[closingThreadId]) {
      sideUserMessagesByThreadId.value = omitKey(sideUserMessagesByThreadId.value, closingThreadId)
    }
    clearLivePlansForThread(closingThreadId)
    clearLiveFileChangesForThread(closingThreadId)
    clearLiveReasoningForThread(closingThreadId)
    clearLiveCollabAgentsForThread(closingThreadId)
    clearLiveMcpActivitiesForThread(closingThreadId)
    setTurnActivityForThread(closingThreadId, null)
    setTurnErrorForThread(closingThreadId, null)
    setThreadInProgress(closingThreadId, false)
    setTurnSummaryForThread(closingThreadId, null)
    if (activeTurnIdByThreadId.value[closingThreadId]) {
      activeTurnIdByThreadId.value = omitKey(activeTurnIdByThreadId.value, closingThreadId)
    }
    if (pendingServerRequestsByThreadId.value[closingThreadId]) {
      pendingServerRequestsByThreadId.value = omitKey(pendingServerRequestsByThreadId.value, closingThreadId)
    }
    if (pendingTurnRequestByThreadId.value[closingThreadId]) {
      pendingTurnRequestByThreadId.value = omitKey(pendingTurnRequestByThreadId.value, closingThreadId)
    }
  }

  async function sendMessageToThread(
    threadId: string,
    text: string,
    options: SendMessageToThreadOptions = {},
  ): Promise<SendMessageResult> {
    const normalizedThreadId = threadId.trim()
    const collaborationModeOverride = options.collaborationModeOverride
    return sendMessageToThreadInternal(
      normalizedThreadId,
      text,
      options.imageUrls ?? [],
      options.skills ?? [],
      options.mode ?? 'queue',
      options.fileAttachments ?? [],
      options.queueInsertIndex,
      collaborationModeOverride,
      {
        refreshThreadStatus: true,
        surfaceGlobalError: normalizedThreadId === selectedThreadId.value,
        enableAutoScroll: normalizedThreadId === selectedThreadId.value,
        requireQueuePersistence: true,
      },
    )
  }

  async function sendMessageToNewThread(
    text: string,
    cwd: string,
    imageUrls: string[] = [],
    skills: Array<{ name: string; path: string }> = [],
    fileAttachments: FileAttachment[] = [],
  ): Promise<string> {
    if (isUpdatingSpeedMode.value) return ''

    const nextText = text.trim()
    const targetCwd = cwd.trim()
    const selectedModel = readModelIdForThread(NEW_THREAD_COLLABORATION_MODE_CONTEXT).trim()
    const selectedMode = selectedCollaborationMode.value
    if (!nextText && imageUrls.length === 0 && fileAttachments.length === 0) return ''

    isSendingMessage.value = true
    error.value = ''
    let threadId = ''

    try {
      try {
        const startedThread = await startThread(targetCwd || undefined, selectedModel || undefined)
        threadId = startedThread.threadId
        setThreadModelId(threadId, startedThread.model)
        setSelectedCollaborationModeForThread(threadId, selectedMode)
      } catch (unknownError) {
        if (selectedModel && selectedModel !== MODEL_FALLBACK_ID && isUnsupportedChatGptModelError(unknownError)) {
          await applyFallbackModelSelection()
          const fallbackThread = await startThread(targetCwd || undefined, MODEL_FALLBACK_ID)
          threadId = fallbackThread.threadId
          setThreadModelId(threadId, fallbackThread.model)
          setSelectedCollaborationModeForThread(threadId, selectedMode)
        } else {
          throw unknownError
        }
      }
      if (!threadId) return ''

      insertOptimisticThread(threadId, targetCwd, nextText || '[Image]')
      blockInterruptUntilThreadIsPersisted(threadId)
      resumedThreadById.value = {
        ...resumedThreadById.value,
        [threadId]: true,
      }
      setSelectedThreadId(threadId)
      shouldAutoScrollOnNextAgentEvent = true
      setTurnSummaryForThread(threadId, null)
      setTurnActivityForThread(
        threadId,
        {
          label: 'Thinking',
          details: buildPendingTurnDetails(
            readModelIdForThread(threadId),
            selectedReasoningEffort.value,
            selectedMode,
          ),
        },
      )
      setTurnErrorForThread(threadId, null)
      setThreadInProgress(threadId, true)
      void startTurnForThread(threadId, nextText, imageUrls, skills, fileAttachments, selectedMode)
        .catch((unknownError) => {
          shouldAutoScrollOnNextAgentEvent = false
          setThreadInProgress(threadId, false)
          setTurnActivityForThread(threadId, null)
          const errorMessage = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
          setTurnErrorForThread(threadId, errorMessage)
          error.value = errorMessage
        })
        .finally(() => {
          isSendingMessage.value = false
        })
      return threadId
    } catch (unknownError) {
      shouldAutoScrollOnNextAgentEvent = false
      if (threadId) {
        setThreadInProgress(threadId, false)
        setTurnActivityForThread(threadId, null)
      }
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
      if (threadId) {
        setTurnErrorForThread(threadId, errorMessage)
      }
      error.value = errorMessage
      isSendingMessage.value = false
      throw unknownError
    }
  }

  async function startTurnForThread(
    threadId: string,
    nextText: string,
    imageUrls: string[] = [],
    skills: Array<{ name: string; path: string }> = [],
    fileAttachments: FileAttachment[] = [],
    collaborationModeOverride?: CollaborationModeKind,
  ): Promise<void> {
    const reasoningEffort = selectedReasoningEffort.value
    const collaborationMode = collaborationModeOverride === 'plan' ? 'plan' : collaborationModeOverride === 'default'
      ? 'default'
      : selectedCollaborationMode.value
    const normalizedText = nextText.trim()
    const normalizedImageUrls = [...imageUrls]
    if (
      normalizedImageUrls.length === 0
      && shouldReuseAttachedImageFromPrompt(normalizedText)
    ) {
      const latestAttachedImageUrl = findLatestUserLocalImageUrl(threadId)
      if (latestAttachedImageUrl) {
        normalizedImageUrls.push(latestAttachedImageUrl)
      }
    }
    const normalizedSkills = skills.map((skill) => ({ name: skill.name, path: skill.path }))
    const normalizedFileAttachments = fileAttachments.map((file) => ({ ...file }))

    setPendingTurnRequest(threadId, {
      text: normalizedText,
      imageUrls: [...normalizedImageUrls],
      skills: normalizedSkills,
      fileAttachments: normalizedFileAttachments,
      effort: reasoningEffort,
      collaborationMode,
      fallbackRetried: false,
    })

    try {
      if (resumedThreadById.value[threadId] !== true) {
        const resumedThread = await resumeThread(threadId)
        setThreadModelId(threadId, resumedThread.model)
      }
      const modelId = readModelIdForThread(threadId)

      let startedTurnId = ''
      try {
        startedTurnId = await startThreadTurn(
          threadId,
          nextText,
          normalizedImageUrls,
          modelId || undefined,
          reasoningEffort || undefined,
          skills.length > 0 ? skills : undefined,
          fileAttachments,
          collaborationMode,
        )
      } catch (unknownError) {
        if (isTurnStartThreadNotFoundError(unknownError)) {
          resumedThreadById.value = omitKey(resumedThreadById.value, threadId)
          const resumedThread = await resumeThread(threadId)
          setThreadModelId(threadId, resumedThread.model)
          const recoveredModelId = readModelIdForThread(threadId)
          startedTurnId = await startThreadTurn(
            threadId,
            nextText,
            normalizedImageUrls,
            recoveredModelId || undefined,
            reasoningEffort || undefined,
            skills.length > 0 ? skills : undefined,
            fileAttachments,
            collaborationMode,
          )
        } else if (modelId && modelId !== MODEL_FALLBACK_ID && isUnsupportedChatGptModelError(unknownError)) {
          await applyFallbackModelSelection(threadId)
          setPendingTurnRequest(threadId, {
            text: normalizedText,
            imageUrls: [...normalizedImageUrls],
            skills: normalizedSkills,
            fileAttachments: normalizedFileAttachments,
            effort: reasoningEffort,
            collaborationMode,
            fallbackRetried: true,
          })
          startedTurnId = await startThreadTurn(
            threadId,
            nextText,
            normalizedImageUrls,
            MODEL_FALLBACK_ID,
            reasoningEffort || undefined,
            skills.length > 0 ? skills : undefined,
            fileAttachments,
            collaborationMode,
          )
        } else {
          throw unknownError
        }
      }

      if (startedTurnId) {
        activeTurnIdByThreadId.value = {
          ...activeTurnIdByThreadId.value,
          [threadId]: startedTurnId,
        }
        maybeUnblockInterruptForActiveTurn(threadId, startedTurnId)
      }

      resumedThreadById.value = {
        ...resumedThreadById.value,
        [threadId]: true,
      }

      pendingThreadMessageRefresh.add(threadId)
      await syncFromNotifications()
      scheduleDelayedTurnSync(threadId)
    } catch (unknownError) {
      throw unknownError
    }
  }

  async function processQueuedMessages(threadId: string): Promise<void> {
    if (queueProcessingByThreadId.value[threadId] === true) return
    queueProcessingByThreadId.value = {
      ...queueProcessingByThreadId.value,
      [threadId]: true,
    }
    try {
      queuedMessagesByThreadId.value = await getThreadQueueState()
    } catch {
      // Backend queue state is optional during transient bridge failures.
    } finally {
      queueProcessingByThreadId.value = omitKey(queueProcessingByThreadId.value, threadId)
    }
  }

  function scheduleQueueStateRefresh(threadId: string): void {
    void processQueuedMessages(threadId)
    if (typeof window === 'undefined') return
    window.setTimeout(() => {
      void processQueuedMessages(threadId)
    }, 650)
  }

  async function interruptSelectedThreadTurn(): Promise<void> {
    const threadId = selectedThreadId.value
    if (!threadId) return
    if (inProgressById.value[threadId] !== true) return
    if (interruptBlockedUntilPersistedByThreadId.value[threadId] === true) return
    let turnId = activeTurnIdByThreadId.value[threadId]
    if (!turnId) {
      const { activeTurnId } = await getThreadDetail(threadId)
      turnId = activeTurnId
      if (turnId) {
        activeTurnIdByThreadId.value = {
          ...activeTurnIdByThreadId.value,
          [threadId]: turnId,
        }
      }
    }
    if (!turnId) {
      throw new Error('Could not determine active turn id for interrupt')
    }

    isInterruptingTurn.value = true
    error.value = ''
    try {
      await interruptThreadTurn(threadId, turnId)
      setThreadInProgress(threadId, false)
      setTurnActivityForThread(threadId, null)
      setTurnErrorForThread(threadId, null)
      if (activeTurnIdByThreadId.value[threadId]) {
        activeTurnIdByThreadId.value = omitKey(activeTurnIdByThreadId.value, threadId)
      }
      pendingThreadMessageRefresh.add(threadId)
      pendingThreadsRefresh = true
      await syncFromNotifications()
    } catch (unknownError) {
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'Failed to interrupt active turn'
      setTurnErrorForThread(threadId, errorMessage)
      error.value = errorMessage
    } finally {
      isInterruptingTurn.value = false
    }
  }

  async function rollbackSelectedThread(turnId: string): Promise<void> {
    const threadId = selectedThreadId.value
    if (!threadId) return
    if (isRollingBack.value) return
    if (!turnId.trim()) return

    const persisted = persistedMessagesByThreadId.value[threadId] ?? []
    const matchedMessage = persisted.find((message) => message.turnId === turnId)
    const turnIndex = typeof matchedMessage?.turnIndex === 'number' ? matchedMessage.turnIndex : -1
    if (turnIndex < 0) return
    const maxTurnIndex = persisted.reduce((max, m) => (typeof m.turnIndex === 'number' && m.turnIndex > max ? m.turnIndex : max), -1)
    if (maxTurnIndex < 0 || turnIndex > maxTurnIndex) return
    const numTurns = maxTurnIndex - turnIndex + 1
    if (numTurns < 1) return

    isRollingBack.value = true
    error.value = ''
    try {
      const threadCwd = selectedThread.value?.cwd?.trim() ?? ''
      if (threadCwd) {
        await revertThreadFileChanges(threadId, turnId, threadCwd)
      }
      const nextMessages = await rollbackThread(threadId, numTurns)
      setPersistedMessagesForThread(threadId, nextMessages)
      setLiveAgentMessagesForThread(threadId, [])
      clearLiveReasoningForThread(threadId)
      clearLiveCollabAgentsForThread(threadId)
      clearLiveMcpActivitiesForThread(threadId)
      if (liveCommandsByThreadId.value[threadId]) {
        liveCommandsByThreadId.value = omitKey(liveCommandsByThreadId.value, threadId)
      }
      setTurnSummaryForThread(threadId, null)
      setTurnActivityForThread(threadId, null)
      setTurnErrorForThread(threadId, null)
      pendingThreadsRefresh = true
      await syncFromNotifications()
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Failed to rollback thread'
    } finally {
      isRollingBack.value = false
    }
  }

  let renameProjectTimer: ReturnType<typeof setTimeout> | null = null

  async function persistProjectLabelToGlobalState(projectName: string, displayName: string): Promise<void> {
    try {
      const rootsState = await getWorkspaceRootsState()
      const nextLabels = { ...rootsState.labels }
      let changed = false
      for (const rootPath of rootsState.order) {
        if (!matchesWorkspaceRootProject(rootPath, projectName)) continue
        const trimmed = displayName.trim()
        if (trimmed.length === 0) {
          if (nextLabels[rootPath] !== undefined) {
            delete nextLabels[rootPath]
            changed = true
          }
        } else if (nextLabels[rootPath] !== trimmed) {
          nextLabels[rootPath] = trimmed
          changed = true
        }
      }
      if (changed) {
        await setWorkspaceRootsState({
          order: rootsState.order,
          labels: nextLabels,
          active: rootsState.active,
          projectOrder: rootsState.projectOrder,
        })
      }
    } catch {
      // Keep localStorage-only rename when global state is unavailable.
    }
  }

  function renameProject(projectName: string, displayName: string): void {
    if (projectName.length === 0) return

    const currentValue = projectDisplayNameById.value[projectName] ?? ''
    if (currentValue === displayName) return

    projectDisplayNameById.value = {
      ...projectDisplayNameById.value,
      [projectName]: displayName,
    }
    saveProjectDisplayNames(projectDisplayNameById.value)

    if (renameProjectTimer !== null) clearTimeout(renameProjectTimer)
    renameProjectTimer = setTimeout(() => {
      renameProjectTimer = null
      void persistProjectLabelToGlobalState(projectName, displayName)
    }, 500)
  }

  async function removeProject(projectName: string): Promise<void> {
    if (projectName.length === 0) return

    const nextProjectOrder = projectOrder.value.filter((name) => name !== projectName)
    if (!areStringArraysEqual(projectOrder.value, nextProjectOrder)) {
      projectOrder.value = nextProjectOrder
      saveProjectOrder(projectOrder.value)
    }

    sourceGroups.value = sourceGroups.value.filter((group) => group.projectName !== projectName)

    if (projectDisplayNameById.value[projectName] !== undefined) {
      const nextDisplayNames = { ...projectDisplayNameById.value }
      delete nextDisplayNames[projectName]
      projectDisplayNameById.value = nextDisplayNames
      saveProjectDisplayNames(nextDisplayNames)
    }

    applyThreadFlags()

    const flatThreads = flattenThreads(projectGroups.value)
    pruneThreadScopedState(flatThreads)

    const currentExists = flatThreads.some((thread) => thread.id === selectedThreadId.value)
    if (!currentExists) {
      setSelectedThreadId(flatThreads[0]?.id ?? '')
    }

    const removedRootPaths = new Set<string>()
    try {
      const rootsState = await getWorkspaceRootsState()
      collectWorkspaceRootPathsForProjectRemoval(rootsState, projectName).forEach((rootPath) => {
        removedRootPaths.add(rootPath)
      })
    } catch {
      // Keep local-only removal when global state is unavailable.
    }

    if (removedRootPaths.size > 0) {
      try {
        const rootsState = await getWorkspaceRootsState()
        const nextOrder = rootsState.order.filter((rootPath) => !removedRootPaths.has(rootPath))
        const nextActive = rootsState.active.filter((rootPath) => !removedRootPaths.has(rootPath))
        const fallbackActive = nextActive.length === 0 && nextOrder.length > 0
          ? [nextOrder[0]]
          : nextActive
        await setWorkspaceRootsState({
          order: nextOrder,
          labels: omitKeys(rootsState.labels, removedRootPaths),
          active: fallbackActive,
          projectOrder: rootsState.projectOrder.filter((item) => item !== projectName && !removedRootPaths.has(item)),
        })
        return
      } catch {
        // Fall back to order-only persistence if direct removal fails.
      }
    }

    await persistProjectOrderToWorkspaceRoots()
  }

  function reorderProject(projectName: string, toIndex: number): void {
    if (projectName.length === 0) return
    if (sourceGroups.value.length === 0) return

    const visibleOrder = sourceGroups.value.map((group) => group.projectName)
    const fromIndex = visibleOrder.indexOf(projectName)
    if (fromIndex === -1) return

    const clampedToIndex = Math.max(0, Math.min(toIndex, visibleOrder.length - 1))
    const reorderedVisibleOrder = reorderStringArray(visibleOrder, fromIndex, clampedToIndex)
    if (reorderedVisibleOrder === visibleOrder) return

    const normalizedProjectOrder = mergeProjectOrder(reorderedVisibleOrder, sourceGroups.value)
    projectOrder.value = normalizedProjectOrder
    saveProjectOrder(projectOrder.value)

    const orderedGroups = orderGroupsByProjectOrder(sourceGroups.value, projectOrder.value)
    sourceGroups.value = mergeThreadGroups(sourceGroups.value, orderedGroups)
    applyThreadFlags()
    void persistProjectOrderToWorkspaceRoots()
  }

  function pinProjectToTop(projectName: string): void {
    const normalizedName = projectName.trim()
    if (!normalizedName) return
    const nextOrder = [normalizedName, ...projectOrder.value.filter((name) => name !== normalizedName)]
    if (areStringArraysEqual(projectOrder.value, nextOrder)) return
    projectOrder.value = nextOrder
    saveProjectOrder(projectOrder.value)

    const orderedGroups = orderGroupsByProjectOrder(sourceGroups.value, projectOrder.value)
    sourceGroups.value = mergeThreadGroups(sourceGroups.value, orderedGroups)
    applyThreadFlags()
    void persistProjectOrderToWorkspaceRoots()
  }

  async function persistProjectOrderToWorkspaceRoots(): Promise<void> {
    try {
      const rootsState = await getWorkspaceRootsState()
      const nextState = buildWorkspaceRootsProjectOrderState(rootsState, projectOrder.value, sourceGroups.value)

      await setWorkspaceRootsState({
        order: nextState.order,
        labels: rootsState.labels,
        active: nextState.active,
        projectOrder: nextState.projectOrder,
      })
    } catch {
      // Keep local project order when global state persistence is unavailable.
    }
  }

  async function syncThreadStatus(): Promise<void> {
    if (isPolling.value) return
    isPolling.value = true

    try {
      await loadThreads()

      if (!selectedThreadId.value) return

      const threadId = selectedThreadId.value
      const currentVersion = currentThreadVersion(threadId)
      const loadedVersion = loadedVersionByThreadId.value[threadId] ?? ''
      const hasVersionChange = currentVersion.length > 0 && currentVersion !== loadedVersion
      const isInProgress = inProgressById.value[threadId] === true

      if (isInProgress || hasVersionChange) {
        await loadMessages(threadId, { silent: true })
      }
    } catch {
      // ignore poll failures and keep last known state
    } finally {
      isPolling.value = false
    }
  }

  async function syncFromNotifications(): Promise<void> {
    if (isPolling.value) {
      if (typeof window !== 'undefined' && eventSyncTimer === null) {
        eventSyncTimer = window.setTimeout(() => {
          eventSyncTimer = null
          void syncFromNotifications()
        }, EVENT_SYNC_DEBOUNCE_MS)
      }
      return
    }

    isPolling.value = true

    const shouldRefreshThreads = pendingThreadsRefresh
    const threadIdsToRefresh = new Set(pendingThreadMessageRefresh)
    pendingThreadsRefresh = false
    pendingThreadMessageRefresh.clear()

    try {
      if (shouldRefreshThreads) {
        await loadThreads()
      }

      const activeThreadId = selectedThreadId.value
      if (!activeThreadId) return

      const isActiveDirty = threadIdsToRefresh.has(activeThreadId)
      const isInProgress = inProgressById.value[activeThreadId] === true
      const currentVersion = currentThreadVersion(activeThreadId)
      const loadedVersion = loadedVersionByThreadId.value[activeThreadId] ?? ''
      const hasVersionChange = currentVersion.length > 0 && currentVersion !== loadedVersion

      const shouldRefreshActiveThread =
        hasVersionChange ||
        (isInProgress && loadedMessagesByThreadId.value[activeThreadId] !== true) ||
        (isActiveDirty && loadedMessagesByThreadId.value[activeThreadId] !== true) ||
        (shouldRefreshThreads && loadedMessagesByThreadId.value[activeThreadId] !== true)

      if (shouldRefreshActiveThread) {
        await loadMessages(activeThreadId, { silent: true })
      }
    } catch {
      // Keep UI stable on transient event sync failures.
    } finally {
      isPolling.value = false

      if (
        (pendingThreadsRefresh || pendingThreadMessageRefresh.size > 0) &&
        typeof window !== 'undefined' &&
        eventSyncTimer === null
      ) {
        eventSyncTimer = window.setTimeout(() => {
          eventSyncTimer = null
          void syncFromNotifications()
        }, EVENT_SYNC_DEBOUNCE_MS)
      }
    }
  }

  async function recoverBridgeState(): Promise<void> {
    await loadPendingServerRequestsFromBridge()
    pendingThreadsRefresh = !hasLoadedThreads.value
    if (
      selectedThreadId.value &&
      loadedMessagesByThreadId.value[selectedThreadId.value] !== true
    ) {
      pendingThreadMessageRefresh.add(selectedThreadId.value)
    }
    await syncFromNotifications()
  }

  function startPolling(): void {
    if (typeof window === 'undefined') return

    if (stopNotificationStream) return
    void loadPendingServerRequestsFromBridge()
    stopNotificationStream = subscribeCodexNotifications((notification) => {
      if (notification.method === 'ready') {
        clearAllTransientTurnErrors()
        void recoverBridgeState()
        return
      }
      applyRealtimeUpdates(notification)
      queueEventDrivenSync(notification)
    })
  }

  async function loadPendingServerRequestsFromBridge(): Promise<void> {
    try {
      const rows = await getPendingServerRequests()
      const normalizedRequests = rows
        .map((row) => normalizeServerRequest(row))
        .filter((request): request is UiServerRequest => request !== null)
      replacePendingServerRequests(normalizedRequests)
    } catch {
      // Keep UI usable when pending request endpoint is temporarily unavailable.
    }
  }

  async function respondToPendingServerRequest(reply: UiServerRequestReply): Promise<boolean> {
    try {
      await replyToServerRequest(reply.id, {
        result: reply.result,
        error: reply.error,
      })
      removePendingServerRequestById(reply.id)
      return true
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Failed to reply to server request'
      return false
    }
  }

  function stopPolling(): void {
    if (stopNotificationStream) {
      stopNotificationStream()
      stopNotificationStream = null
    }

    pendingThreadsRefresh = false
    pendingThreadMessageRefresh.clear()
    pendingTurnStartsById.clear()
    turnDiffSummaryByTurnId.clear()
    if (eventSyncTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(eventSyncTimer)
      eventSyncTimer = null
    }
    if (rateLimitRefreshTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(rateLimitRefreshTimer)
      rateLimitRefreshTimer = null
    }
    if (threadListBackgroundTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(threadListBackgroundTimer)
      threadListBackgroundTimer = null
    }
    if (typeof window !== 'undefined') {
      for (const timerId of delayedTurnSyncTimerByThreadId.values()) {
        window.clearTimeout(timerId)
      }
    }
    delayedTurnSyncTimerByThreadId.clear()
    activeReasoningItemId = ''
    shouldAutoScrollOnNextAgentEvent = false
    persistedMessagesByThreadId.value = {}
    livePlanMessagesByThreadId.value = {}
    liveAgentMessagesByThreadId.value = {}
    liveReasoningTextByThreadId.value = {}
    liveCommandsByThreadId.value = {}
    liveFileChangeMessagesByThreadId.value = {}
    liveCollabAgentsByThreadId.value = {}
    liveMcpActivitiesByThreadId.value = {}
    collabAgentDisplayNameByThreadId.value = {}
    collabAgentParentThreadIdByThreadId.value = {}
    collabAgentReasoningSummaryByThreadId.value = {}
    pendingCollabAgentNameLookupIds.clear()
    turnIndexByTurnIdByThreadId.value = {}
    turnActivityByThreadId.value = {}
    turnSummaryByThreadId.value = {}
    turnErrorByThreadId.value = {}
    activeTurnIdByThreadId.value = {}
    interruptBlockedUntilPersistedByThreadId.value = {}
    threadListedByServerById.value = {}
    persistedUserMessageByThreadId.value = {}
    queuedMessagesByThreadId.value = {}
    queueProcessingByThreadId.value = {}
    persistQueueState()
    codexRateLimit.value = null
    threadTokenUsageByThreadId.value = {}
  }

  const selectedThreadQueuedMessages = computed<QueuedMessage[]>(() => {
    const threadId = selectedThreadId.value
    if (!threadId) return []
    return queuedMessagesByThreadId.value[threadId] ?? []
  })

  function removeQueuedMessage(messageId: string): void {
    const threadId = selectedThreadId.value
    if (!threadId) return
    const queue = queuedMessagesByThreadId.value[threadId]
    if (!queue) return
    const next = queue.filter((m) => m.id !== messageId)
    queuedMessagesByThreadId.value = next.length > 0
      ? { ...queuedMessagesByThreadId.value, [threadId]: next }
      : omitKey(queuedMessagesByThreadId.value, threadId)
    persistQueueState()
  }

  function reorderQueuedMessage(draggedId: string, targetId: string): void {
    const threadId = selectedThreadId.value
    if (!threadId) return
    const queue = queuedMessagesByThreadId.value[threadId]
    if (!queue) return

    const fromIndex = queue.findIndex((m) => m.id === draggedId)
    const toIndex = queue.findIndex((m) => m.id === targetId)
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return

    const next = [...queue]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    queuedMessagesByThreadId.value = {
      ...queuedMessagesByThreadId.value,
      [threadId]: next,
    }
    persistQueueState()
  }

  function steerQueuedMessage(messageId: string): void {
    const threadId = selectedThreadId.value
    if (!threadId) return
    const queue = queuedMessagesByThreadId.value[threadId]
    if (!queue) return
    const msg = queue.find((m) => m.id === messageId)
    if (!msg) return
    removeQueuedMessage(messageId)
    setSelectedCollaborationMode(msg.collaborationMode)
    void sendMessageToSelectedThread(msg.text, msg.imageUrls, msg.skills, 'steer', msg.fileAttachments)
  }

  function primeSelectedThread(threadId: string): void {
    setSelectedThreadId(threadId)
  }

  return {
    projectGroups,
    projectDisplayNameById,
    selectedThread,
    selectedThreadTokenUsage,
    selectedThreadTerminalOpen,
    isSelectedThreadInterruptPending,
    selectedThreadServerRequests,
    selectedLiveOverlay,
    sideThreadId,
    sideMessages,
    sideLiveOverlay,
    sideThreadServerRequests,
    codexQuota,
    selectedThreadId,
    availableCollaborationModes,
    availableModelIds,
    selectedCollaborationMode,
    selectedModelId,
    selectedReasoningEffort,
    selectedSpeedMode,
    codexCliMissingError,
    installedSkills,
    accountRateLimitSnapshots,
    messages,
    hasMoreOlderMessages,
    isLoadingThreads,
    isThreadListFullyLoaded,
    isLoadingMessages,
    isLoadingOlderMessages,
    isSendingMessage,
    isInterruptingTurn,
    isUpdatingSpeedMode,
    isRollingBack,

    error,
    refreshAll,
    refreshSkills,
    selectThread,
    loadMessages,
    loadOlderMessages,
    ensureThreadMessagesLoaded,
    setThreadTerminalOpen,
    toggleSelectedThreadTerminal,
    archiveThreadById,
    markThreadAsRead,
    markThreadAsUnread,
    renameThreadById,
    forkThreadById,
    forkThreadFromTurn,
    rollbackSelectedThread,

    sendMessageToSelectedThread,
    openSideChatForSelectedThread,
    sendMessageToSideChat,
    closeSideChat,
    sendMessageToThread,
    sendMessageToNewThread,
    interruptSelectedThreadTurn,
    selectedThreadQueuedMessages,
    removeQueuedMessage,
    reorderQueuedMessage,
    steerQueuedMessage,
    setSelectedCollaborationMode,
    readModelIdForThread,
    setSelectedModelIdForThread,
    setSelectedModelId,

    setSelectedReasoningEffort,
    updateSelectedSpeedMode,
    respondToPendingServerRequest,
    renameProject,
    removeProject,
    reorderProject,
    pinProjectToTop,
    startPolling,
    stopPolling,
    primeSelectedThread,
  }
}
