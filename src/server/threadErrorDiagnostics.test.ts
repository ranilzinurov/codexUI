import { describe, expect, it } from 'vitest'
import {
  isTurnStartThreadNotFoundLike,
  summarizeTurnStartThreadNotFound,
} from './threadErrorDiagnostics'

describe('thread error diagnostics', () => {
  it('detects and summarizes turn/start thread-not-found failures', () => {
    const error = new Error('RPC turn/start failed with HTTP 502: thread not found: 019e6ece-187d-7500-826c-b5026cbfbccd')

    expect(isTurnStartThreadNotFoundLike(error)).toBe(true)
    expect(summarizeTurnStartThreadNotFound(error)).toEqual({
      message: 'RPC turn/start failed with HTTP 502: thread not found: 019e6ece-187d-7500-826c-b5026cbfbccd',
      threadId: '019e6ece-187d-7500-826c-b5026cbfbccd',
      httpStatus: 502,
    })
  })

  it('ignores unrelated thread errors', () => {
    expect(isTurnStartThreadNotFoundLike(new Error('thread/read failed with HTTP 404'))).toBe(false)
  })
})
