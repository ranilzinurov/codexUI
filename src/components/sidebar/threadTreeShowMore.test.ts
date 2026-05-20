import { describe, expect, it } from 'vitest'
import type { UiThread } from '../../types/codex'
import {
  getInitialVisibleProjectThreads,
  getThreadRelativeAgeDays,
  hasHiddenProjectThreads,
  isThreadInitiallyVisibleInProject,
} from './threadTreeShowMore'

const NOW_MS = Date.parse('2026-05-20T12:00:00.000Z')

function thread(id: string, updatedAtIso: string, options: Partial<UiThread> = {}): UiThread {
  return {
    id,
    title: id,
    projectName: 'project',
    cwd: '/tmp/project',
    hasWorktree: false,
    createdAtIso: '2026-05-01T00:00:00.000Z',
    updatedAtIso,
    preview: '',
    unread: false,
    inProgress: false,
    pendingRequestState: null,
    ...options,
  }
}

describe('project thread Show more visibility', () => {
  it('uses updatedAtIso with createdAtIso fallback for the relative age window', () => {
    expect(getThreadRelativeAgeDays(thread('updated', '2026-05-17T12:00:00.000Z'), NOW_MS)).toBe(3)
    expect(getThreadRelativeAgeDays(thread('fallback', '', { createdAtIso: '2026-05-16T12:00:00.000Z' }), NOW_MS)).toBe(4)
  })

  it('initially keeps 0d through 3d project threads visible', () => {
    const rows = [
      thread('now', '2026-05-20T11:59:00.000Z'),
      thread('one-day', '2026-05-19T12:00:00.000Z'),
      thread('two-days', '2026-05-18T12:00:00.000Z'),
      thread('three-days', '2026-05-16T12:00:00.001Z'),
      thread('four-days', '2026-05-16T12:00:00.000Z'),
    ]

    expect(getInitialVisibleProjectThreads(rows, { nowMs: NOW_MS }).map((row) => row.id)).toEqual([
      'now',
      'one-day',
      'two-days',
      'three-days',
    ])
    expect(hasHiddenProjectThreads(rows, { nowMs: NOW_MS })).toBe(true)
  })

  it('keeps unknown relative-age threads visible', () => {
    const invalidUpdatedWithCreated = thread('invalid-updated', 'not-a-date', {
      createdAtIso: '2026-05-16T12:00:00.000Z',
    })
    const invalidBoth = thread('invalid-both', '', { createdAtIso: '' })

    expect(getThreadRelativeAgeDays(invalidUpdatedWithCreated, NOW_MS)).toBeNull()
    expect(isThreadInitiallyVisibleInProject(invalidUpdatedWithCreated, { nowMs: NOW_MS })).toBe(true)
    expect(getThreadRelativeAgeDays(invalidBoth, NOW_MS)).toBeNull()
    expect(isThreadInitiallyVisibleInProject(invalidBoth, { nowMs: NOW_MS })).toBe(true)
  })

  it('hides threads shown as 4d or older unless they are selected', () => {
    const stale = thread('stale', '2026-05-16T11:59:59.999Z')

    expect(isThreadInitiallyVisibleInProject(stale, { nowMs: NOW_MS })).toBe(false)
    expect(isThreadInitiallyVisibleInProject(stale, { nowMs: NOW_MS, selectedThreadId: 'stale' })).toBe(true)
    expect(hasHiddenProjectThreads([stale], { nowMs: NOW_MS, selectedThreadId: 'stale' })).toBe(false)
  })
})
