import type { UiThread } from '../../types/codex'

type ThreadTimestampFields = Pick<UiThread, 'id' | 'createdAtIso' | 'updatedAtIso'>

export const PROJECT_INITIAL_VISIBLE_DAYS = 3
const MS_PER_DAY = 24 * 60 * 60 * 1000

export function getThreadRelativeTimestampMs(thread: ThreadTimestampFields): number {
  return new Date(thread.updatedAtIso || thread.createdAtIso).getTime()
}

export function getThreadRelativeAgeDays(thread: ThreadTimestampFields, nowMs = Date.now()): number | null {
  const timestampMs = getThreadRelativeTimestampMs(thread)
  if (!Number.isFinite(timestampMs)) return null
  return Math.floor(Math.abs(nowMs - timestampMs) / MS_PER_DAY)
}

export function isThreadInitiallyVisibleInProject(
  thread: ThreadTimestampFields,
  options: {
    nowMs?: number
    selectedThreadId?: string
  } = {},
): boolean {
  if (thread.id === options.selectedThreadId) return true
  const ageDays = getThreadRelativeAgeDays(thread, options.nowMs)
  return ageDays === null || ageDays <= PROJECT_INITIAL_VISIBLE_DAYS
}

export function getInitialVisibleProjectThreads<T extends ThreadTimestampFields>(
  threads: readonly T[],
  options: {
    nowMs?: number
    selectedThreadId?: string
  } = {},
): T[] {
  const nowMs = options.nowMs ?? Date.now()
  return threads.filter((thread) => isThreadInitiallyVisibleInProject(thread, {
    nowMs,
    selectedThreadId: options.selectedThreadId,
  }))
}

export function hasHiddenProjectThreads(
  threads: readonly ThreadTimestampFields[],
  options: {
    nowMs?: number
    selectedThreadId?: string
  } = {},
): boolean {
  const nowMs = options.nowMs ?? Date.now()
  return threads.some((thread) => !isThreadInitiallyVisibleInProject(thread, {
    nowMs,
    selectedThreadId: options.selectedThreadId,
  }))
}
