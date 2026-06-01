import { describe, expect, it } from 'vitest'
import {
  classifyPreviousResponseNotFound,
  isPreviousResponseNotFoundLike,
} from './previousResponseErrors'

describe('previous response error classifier', () => {
  it('detects structured previous_response_not_found errors', () => {
    const match = classifyPreviousResponseNotFound({
      error: {
        type: 'invalid_request_error',
        code: 'previous_response_not_found',
        message: "Previous response with id 'resp_123' not found.",
        param: 'previous_response_id',
      },
      status: 400,
    })

    expect(match).toEqual({
      responseId: 'resp_123',
      signature: 'response:resp_123',
      message: "Previous response with id 'resp_123' not found.",
    })
  })

  it('detects nested stringified upstream errors', () => {
    const payload = {
      params: {
        error: {
          message: JSON.stringify({
            type: 'error',
            error: {
              type: 'invalid_request_error',
              code: 'previous_response_not_found',
              message: "Previous response with id 'resp_nested' not found.",
              param: 'previous_response_id',
            },
            status: 400,
          }),
        },
      },
    }

    expect(classifyPreviousResponseNotFound(payload)).toEqual({
      responseId: 'resp_nested',
      signature: 'response:resp_nested',
      message: "Previous response with id 'resp_nested' not found.",
    })
  })

  it('creates a stable signature when no response id exists', () => {
    const match = classifyPreviousResponseNotFound({
      error: {
        code: 'previous_response_not_found',
        message: 'Previous response was not found.',
      },
    })

    expect(match?.responseId).toBe('')
    expect(match?.signature).toBe('signature:Previous response was not found.')
  })

  it('rejects thread not found and unrelated errors', () => {
    expect(isPreviousResponseNotFoundLike('RPC turn/start failed with HTTP 502: thread not found: thread-1')).toBe(false)
    expect(isPreviousResponseNotFoundLike({
      error: {
        code: 'rate_limit_exceeded',
        message: 'Too many requests.',
      },
    })).toBe(false)
    expect(isPreviousResponseNotFoundLike('previous_response_id is present')).toBe(false)
  })
})
