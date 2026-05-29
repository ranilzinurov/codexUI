import { describe, expect, it } from 'vitest'
import {
  ANNOTATION_BATCH_EXAMPLES,
  ANNOTATION_MAX_BODY_CAP_BYTES,
  ANNOTATION_REDACTED_VALUE,
  DEVTOOLS_HEAVY_ANNOTATION_BATCH_EXAMPLE,
  containsSensitiveAnnotationFieldName,
  containsUnredactedSensitiveAnnotationField,
  isSensitiveAnnotationHeaderName,
  trimAnnotationBodyText,
  validateAnnotationBatchPayload,
  type AnnotationBatch,
} from './browserAnnotationContracts'

type MutableDevToolsPayload = {
  devTools: {
    network: Array<{
      requestHeaders: Array<{ name: string, value: string, redacted?: boolean }>
      responseBody?: unknown
    }>
  }
}

function cloneBatch(value: AnnotationBatch): AnnotationBatch {
  return JSON.parse(JSON.stringify(value)) as AnnotationBatch
}

function cloneDevToolsPayload(): MutableDevToolsPayload {
  return JSON.parse(JSON.stringify(DEVTOOLS_HEAVY_ANNOTATION_BATCH_EXAMPLE)) as MutableDevToolsPayload
}

describe('browser annotation batch contracts', () => {
  it('validates representative draft payload examples', () => {
    for (const example of ANNOTATION_BATCH_EXAMPLES) {
      const result = validateAnnotationBatchPayload(example)

      expect(result.errors).toEqual([])
      expect(result.ok).toBe(true)
    }
  })

  it('recognizes sensitive headers covered by default redaction rules', () => {
    expect(isSensitiveAnnotationHeaderName('Authorization')).toBe(true)
    expect(isSensitiveAnnotationHeaderName('cookie')).toBe(true)
    expect(isSensitiveAnnotationHeaderName('content-type')).toBe(false)
    expect(containsSensitiveAnnotationFieldName('{"password":"secret"}')).toBe(true)
    expect(containsSensitiveAnnotationFieldName('{"accessToken":"secret"}')).toBe(true)
    expect(containsSensitiveAnnotationFieldName('api-key=secret')).toBe(true)
    expect(containsSensitiveAnnotationFieldName('{"message":"tokenized UI label"}')).toBe(false)
    expect(containsUnredactedSensitiveAnnotationField('{"clientSecret":"secret"}')).toBe(true)
    expect(containsUnredactedSensitiveAnnotationField('{"clientSecret":"[REDACTED]"}')).toBe(false)
    expect(containsUnredactedSensitiveAnnotationField('api-key=[REDACTED]')).toBe(false)
    expect(containsUnredactedSensitiveAnnotationField('{"password":"[REDACTED]secret"}')).toBe(true)
  })

  it('rejects unredacted sensitive headers and body text without opt-in', () => {
    const payload = cloneDevToolsPayload()
    const request = payload.devTools.network[0]
    if (!request) throw new Error('DevTools-heavy example must include a network record')

    request.requestHeaders[0] = {
      name: 'authorization',
      value: 'Bearer secret-token',
    }
    request.responseBody = {
      state: 'captured',
      userOptIn: false,
      capBytes: 96,
      text: 'sensitive body',
      byteLength: 14,
      redactionApplied: false,
    }

    const result = validateAnnotationBatchPayload(payload)

    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('sensitive header must be redacted'),
      expect.stringContaining('captured body text requires user opt-in'),
    ]))
  })

  it('caps body previews and records original byte length', () => {
    const body = trimAnnotationBodyText('0123456789abcdef', { capBytes: 8 })
    const multibyteBody = trimAnnotationBodyText('éclair', { capBytes: 1 })

    expect(body.state).toBe('trimmed')
    if (body.state !== 'trimmed') throw new Error('Expected body to be trimmed')
    expect(body.text).toBe('01234567')
    expect(body.byteLength).toBe(8)
    expect(body.originalByteLength).toBe(16)
    expect(multibyteBody.text).toBe('')
    expect(multibyteBody.byteLength).toBe(0)
  })

  it('rejects body caps above the contract maximum', () => {
    const payload = cloneBatch(DEVTOOLS_HEAVY_ANNOTATION_BATCH_EXAMPLE)
    const request = payload.devTools?.network[0]
    if (!request) throw new Error('DevTools-heavy example must include a network record')

    request.responseBody = {
      state: 'captured',
      userOptIn: true,
      capBytes: ANNOTATION_MAX_BODY_CAP_BYTES + 1,
      text: ANNOTATION_REDACTED_VALUE,
      byteLength: ANNOTATION_REDACTED_VALUE.length,
      redactionApplied: true,
    }

    const result = validateAnnotationBatchPayload(payload)

    expect(result.ok).toBe(false)
    expect(result.errors).toContain(`devTools.network[0].responseBody.capBytes must be between 1 and ${ANNOTATION_MAX_BODY_CAP_BYTES}`)
  })

  it('rejects raw text on omitted/redacted body states', () => {
    const payload = cloneDevToolsPayload()
    const request = payload.devTools.network[0]
    if (!request) throw new Error('DevTools-heavy example must include a network record')

    request.responseBody = {
      state: 'redacted',
      reason: 'sensitive',
      userOptIn: true,
      capBytes: 96,
      text: 'password=secret',
    }

    const result = validateAnnotationBatchPayload(payload)

    expect(result.ok).toBe(false)
    expect(result.errors).toContain('devTools.network[0].responseBody.text must be omitted unless body text is captured')
  })

  it('requires redaction when captured body text contains sensitive fields', () => {
    const payload = cloneDevToolsPayload()
    const request = payload.devTools.network[0]
    if (!request) throw new Error('DevTools-heavy example must include a network record')

    request.responseBody = {
      state: 'captured',
      userOptIn: true,
      capBytes: 128,
      text: '{"password":"secret"}',
      byteLength: 21,
      redactionApplied: false,
    }

    const result = validateAnnotationBatchPayload(payload)

    expect(result.ok).toBe(false)
    expect(result.errors).toContain('devTools.network[0].responseBody.text includes sensitive fields and must be redacted')
  })

  it('rejects self-attested redaction when captured body still contains raw sensitive values', () => {
    const payload = cloneDevToolsPayload()
    const request = payload.devTools.network[0]
    if (!request) throw new Error('DevTools-heavy example must include a network record')

    request.responseBody = {
      state: 'captured',
      userOptIn: true,
      capBytes: 128,
      text: '{"accessToken":"secret"}',
      byteLength: 24,
      redactionApplied: true,
    }

    const result = validateAnnotationBatchPayload(payload)

    expect(result.ok).toBe(false)
    expect(result.errors).toContain('devTools.network[0].responseBody.text includes sensitive fields and must be redacted')
  })

  it('allows captured body text when sensitive values are actually redacted', () => {
    const payload = cloneDevToolsPayload()
    const request = payload.devTools.network[0]
    if (!request) throw new Error('DevTools-heavy example must include a network record')

    request.responseBody = {
      state: 'captured',
      userOptIn: true,
      capBytes: 128,
      text: `{"password":"${ANNOTATION_REDACTED_VALUE}"}`,
      byteLength: 25,
      redactionApplied: true,
    }

    const result = validateAnnotationBatchPayload(payload)

    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('rejects raw text on not-captured body states', () => {
    const payload = cloneDevToolsPayload()
    const request = payload.devTools.network[0]
    if (!request) throw new Error('DevTools-heavy example must include a network record')

    request.responseBody = {
      state: 'not-captured',
      reason: 'default-privacy',
      userOptIn: false,
      capBytes: 96,
      text: 'api_key=secret',
    }

    const result = validateAnnotationBatchPayload(payload)

    expect(result.ok).toBe(false)
    expect(result.errors).toContain('devTools.network[0].responseBody.text must be omitted unless body text is captured')
  })

  it('returns validation errors for malformed arrays instead of throwing', () => {
    const payload = cloneBatch(DEVTOOLS_HEAVY_ANNOTATION_BATCH_EXAMPLE) as unknown as {
      assets: unknown[]
      items: unknown[]
    }
    payload.assets = [null]
    payload.items = [null]

    const result = validateAnnotationBatchPayload(payload)

    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      'assets[0] must be an object',
      'items[0] must be an object',
    ]))
  })
})
