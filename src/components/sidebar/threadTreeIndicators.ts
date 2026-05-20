import type { UiThread } from '../../types/codex'

export type ThreadAttentionState = 'awaiting-approval' | 'awaiting-response' | 'working' | 'unread' | 'idle'

export function getThreadAttentionState(thread: UiThread): ThreadAttentionState {
  if (thread.pendingRequestState === 'approval') return 'awaiting-approval'
  if (thread.pendingRequestState === 'response') return 'awaiting-response'
  if (thread.inProgress) return 'working'
  if (thread.unread) return 'unread'
  return 'idle'
}

export function getThreadsAttentionState(threads: readonly UiThread[]): ThreadAttentionState {
  let hasUnread = false

  for (const thread of threads) {
    const state = getThreadAttentionState(thread)
    if (state === 'awaiting-approval' || state === 'awaiting-response' || state === 'working') {
      return state
    }
    if (state === 'unread') hasUnread = true
  }

  return hasUnread ? 'unread' : 'idle'
}

export function hasThreadAttention(thread: UiThread): boolean {
  return getThreadAttentionState(thread) !== 'idle'
}

export function hasThreadsAttention(threads: readonly UiThread[]): boolean {
  return getThreadsAttentionState(threads) !== 'idle'
}
