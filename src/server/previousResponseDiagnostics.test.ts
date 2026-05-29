import { describe, expect, it } from 'vitest'
import {
  isPreviousResponseNotFoundLike,
  summarizePreviousResponseError,
} from './previousResponseDiagnostics'

describe('previous response diagnostics', () => {
  it('extracts nested app-server previous_response_not_found details', () => {
    const notification = {
      method: 'error',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        error: {
          message: JSON.stringify({
            type: 'error',
            error: {
              type: 'invalid_request_error',
              code: 'previous_response_not_found',
              message: "Previous response with id 'resp_123' not found.",
              param: 'previous_response_id',
            },
            status: 400,
          }),
          codexErrorInfo: 'other',
        },
        willRetry: false,
      },
    }

    expect(isPreviousResponseNotFoundLike(notification)).toBe(true)
    expect(summarizePreviousResponseError(notification)).toEqual({
      type: 'invalid_request_error',
      code: 'previous_response_not_found',
      param: 'previous_response_id',
      status: 400,
      responseId: 'resp_123',
      message: "Previous response with id 'resp_123' not found.",
    })
  })

  it('does not classify unrelated error payloads as previous-response failures', () => {
    expect(isPreviousResponseNotFoundLike({
      error: {
        code: 'rate_limit_exceeded',
        message: 'Too many requests.',
      },
    })).toBe(false)
  })
})
