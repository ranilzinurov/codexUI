import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThreadAutoTitleManager } from './threadAutoTitle'

describe('ThreadAutoTitleManager', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('ignores ephemeral side threads that cannot be read with includeTurns', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rpc = vi.fn(async () => {
      throw new Error('ephemeral threads do not support includeTurns')
    })
    const manager = new ThreadAutoTitleManager({ rpc })

    try {
      manager.handleNotification({
        method: 'turn/completed',
        params: { threadId: 'side-thread' },
      })
      await new Promise((resolve) => setTimeout(resolve, 1_050))

      manager.handleNotification({
        method: 'turn/completed',
        params: { threadId: 'side-thread' },
      })
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(rpc).toHaveBeenCalledTimes(1)
      expect(warnSpy).not.toHaveBeenCalledWith(
        '[thread-title]',
        'Automatic title generation failed',
        expect.anything(),
      )
    } finally {
      manager.dispose()
    }
  })
})
