import { describe, expect, it } from 'vitest'
import type { UiThread } from '../../types/codex'
import { getThreadAttentionState, getThreadsAttentionState, hasThreadsAttention } from './threadTreeIndicators'

function thread(id: string, options: Partial<UiThread> = {}): UiThread {
  return {
    id,
    title: id,
    projectName: 'project',
    cwd: '/tmp/project',
    hasWorktree: false,
    createdAtIso: '2026-05-20T00:00:00.000Z',
    updatedAtIso: '2026-05-20T00:00:00.000Z',
    preview: '',
    unread: false,
    inProgress: false,
    pendingRequestState: null,
    ...options,
  }
}

describe('thread tree indicators', () => {
  it('marks completed unseen threads as unread attention', () => {
    expect(getThreadAttentionState(thread('done', { unread: true }))).toBe('unread')
  })

  it('keeps idle project groups quiet', () => {
    expect(hasThreadsAttention([thread('idle-a'), thread('idle-b')])).toBe(false)
    expect(getThreadsAttentionState([thread('idle-a'), thread('idle-b')])).toBe('idle')
  })

  it('aggregates hidden project attention with active states before unread', () => {
    const rows = [
      thread('unread', { unread: true }),
      thread('working', { inProgress: true }),
    ]

    expect(hasThreadsAttention(rows)).toBe(true)
    expect(getThreadsAttentionState(rows)).toBe('working')
  })

  it('prioritizes approval and response waits for collapsed project badges', () => {
    expect(getThreadsAttentionState([
      thread('unread', { unread: true }),
      thread('approval', { pendingRequestState: 'approval' }),
    ])).toBe('awaiting-approval')

    expect(getThreadsAttentionState([
      thread('unread', { unread: true }),
      thread('response', { pendingRequestState: 'response' }),
    ])).toBe('awaiting-response')
  })
})
