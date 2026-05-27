import { describe, expect, it } from 'vitest'
import { CodexApiError, extractErrorMessage, sanitizeCodexErrorMessage } from './codexErrors'

const cloudflareHtml = `<!DOCTYPE html>
<html>
  <head><title>Attention Required! | Cloudflare</title></head>
  <body>
    <h1>Checking your browser before accessing example.test.</h1>
    <div>Cloudflare Ray ID: abc123</div>
    <script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script>
  </body>
</html>`

describe('sanitizeCodexErrorMessage', () => {
  it('keeps ordinary API error messages intact', () => {
    expect(sanitizeCodexErrorMessage('thread/read failed: permission denied')).toBe('thread/read failed: permission denied')
  })

  it('replaces raw Cloudflare challenge HTML with a short diagnostic', () => {
    const sanitized = sanitizeCodexErrorMessage(cloudflareHtml)

    expect(sanitized).toBe('received an upstream security challenge instead of JSON.')
    expect(sanitized).not.toContain('<html>')
    expect(sanitized).not.toContain('Cloudflare Ray ID')
  })

  it('preserves safe context before an unsafe HTML body', () => {
    const sanitized = sanitizeCodexErrorMessage(`RPC thread/list failed with HTTP 403: ${cloudflareHtml}`)

    expect(sanitized).toBe('RPC thread/list failed with HTTP 403: received an upstream security challenge instead of JSON.')
    expect(sanitized).not.toContain('<script')
    expect(sanitized).not.toContain('challenge-platform')
  })
})

describe('extractErrorMessage', () => {
  it('sanitizes nested JSON-RPC error messages', () => {
    const message = extractErrorMessage({
      error: {
        message: cloudflareHtml,
      },
    }, 'fallback')

    expect(message).toBe('received an upstream security challenge instead of JSON.')
  })
})

describe('CodexApiError', () => {
  it('sanitizes constructor messages as a final guard', () => {
    const error = new CodexApiError(cloudflareHtml, { code: 'http_error', method: 'thread/list', status: 403 })

    expect(error.message).toBe('received an upstream security challenge instead of JSON.')
    expect(error.message).not.toContain('<body>')
  })
})
