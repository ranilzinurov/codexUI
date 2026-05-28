import { describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage } from 'node:http'
import {
  chatCompletionToResponsesFormat,
  handleUnifiedResponsesProxyRequest,
  responsesInputToMessages,
} from './unifiedResponsesProxy'

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address && typeof address === 'object') {
        resolve(address.port)
      } else {
        reject(new Error('test server did not bind to a TCP port'))
      }
    })
  })
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('error', reject)
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>)
      } catch (error) {
        reject(error)
      }
    })
  })
}

describe('unified responses proxy reasoning_content translation', () => {
  it('preserves DeepSeek reasoning_content in translated Responses output', () => {
    const response = chatCompletionToResponsesFormat({
      id: 'chatcmpl-test',
      created: 123,
      choices: [{
        message: {
          role: 'assistant',
          reasoning_content: 'thinking trace',
          content: 'Hello.',
        },
      }],
    }, 'big-pickle')

    expect(response.output).toEqual([
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Hello.' }],
        status: 'completed',
      },
      {
        type: 'reasoning',
        id: expect.stringMatching(/^rs_/),
        summary: [],
        content: [{ type: 'reasoning_text', text: 'thinking trace' }],
      },
    ])
  })

  it('passes prior reasoning items back as assistant reasoning_content', () => {
    const messages = responsesInputToMessages([
      {
        type: 'reasoning',
        id: 'rs_test',
        summary: [],
        content: [{ type: 'reasoning_text', text: 'thinking trace' }],
      },
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Hello.' }],
      },
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'again' }],
      },
    ])

    expect(messages).toEqual([
      { role: 'assistant', content: 'Hello.', reasoning_content: 'thinking trace' },
      { role: 'user', content: 'again' },
    ])
  })

  it('passes reasoning_content back on assistant tool-call messages', () => {
    const messages = responsesInputToMessages([
      {
        type: 'reasoning',
        id: 'rs_test',
        summary: [],
        content: [{ type: 'reasoning_text', text: 'thinking before tool' }],
      },
      {
        type: 'function_call',
        call_id: 'call_test',
        name: 'exec_command',
        arguments: '{"cmd":"pwd"}',
      },
      {
        type: 'function_call_output',
        call_id: 'call_test',
        output: 'ok',
      },
    ])

    expect(messages).toEqual([
      {
        role: 'assistant',
        content: '',
        reasoning_content: 'thinking before tool',
        tool_calls: [{
          id: 'call_test',
          type: 'function',
          function: { name: 'exec_command', arguments: '{"cmd":"pwd"}' },
        }],
      },
      {
        role: 'tool',
        tool_call_id: 'call_test',
        content: 'ok',
      },
    ])
  })

  it('forces non-stream upstream requests when chat-formatted tool requests cannot be streamed', async () => {
    let upstreamRequest: Record<string, unknown> | null = null
    const upstream = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        upstreamRequest = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          id: 'chatcmpl-test',
          created: 123,
          choices: [{ message: { role: 'assistant', content: 'ok' } }],
        }))
      })
    })
    const upstreamPort = await listen(upstream)

    const proxy = createServer((req, res) => {
      handleUnifiedResponsesProxyRequest(req, res, {
        bearerToken: '',
        requireBearerToken: false,
        wireApi: 'responses',
        responsesEndpoint: `http://127.0.0.1:${upstreamPort}/v1/responses`,
        chatCompletionsEndpoint: `http://127.0.0.1:${upstreamPort}/v1/chat/completions`,
        missingKeyMessage: 'missing',
        allowToolFallbackToResponses: false,
        responsesPayloadFormat: 'chat',
      })
    })
    const proxyPort = await listen(proxy)

    try {
      const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'big-pickle',
          stream: true,
          input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
          tools: [{ type: 'function', name: 'exec_command', parameters: { type: 'object' } }],
        }),
      })

      expect(response.status).toBe(200)
      expect((upstreamRequest as Record<string, unknown> | null)?.stream).toBe(false)
    } finally {
      await close(proxy)
      await close(upstream)
    }
  })

  it('retries raw Responses once without previous_response_id when upstream reports it missing', async () => {
    const upstreamRequests: Record<string, unknown>[] = []
    const input = [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'recover this turn' }],
      },
    ]
    const upstreamSuccess = {
      id: 'resp_recovered',
      object: 'response',
      model: 'big-pickle',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }],
    }
    const upstream = createServer((req, res) => {
      void (async () => {
        upstreamRequests.push(await readJsonBody(req))
        if (upstreamRequests.length === 1) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            error: {
              type: 'previous_response_not_found',
              code: 'previous_response_not_found',
              message: 'Previous response was not found.',
            },
          }))
          return
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(upstreamSuccess))
      })().catch((error) => {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : 'unknown error' } }))
      })
    })
    const upstreamPort = await listen(upstream)

    const proxy = createServer((req, res) => {
      handleUnifiedResponsesProxyRequest(req, res, {
        bearerToken: '',
        requireBearerToken: false,
        wireApi: 'responses',
        responsesEndpoint: `http://127.0.0.1:${upstreamPort}/v1/responses`,
        chatCompletionsEndpoint: `http://127.0.0.1:${upstreamPort}/v1/chat/completions`,
        missingKeyMessage: 'missing',
        allowToolFallbackToResponses: false,
        responsesPayloadFormat: 'raw',
      })
    })
    const proxyPort = await listen(proxy)

    try {
      const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'big-pickle',
          previous_response_id: 'resp_missing',
          input,
        }),
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual(upstreamSuccess)
      expect(upstreamRequests).toHaveLength(2)
      expect(upstreamRequests[0]).toMatchObject({
        model: 'big-pickle',
        previous_response_id: 'resp_missing',
        input,
      })
      expect(upstreamRequests[1]).not.toHaveProperty('previous_response_id')
      expect(upstreamRequests[1]).toMatchObject({
        model: 'big-pickle',
        input,
      })
    } finally {
      await close(proxy)
      await close(upstream)
    }
  })

  it('forwards non-matching raw Responses upstream errors without retrying', async () => {
    const upstreamRequests: Record<string, unknown>[] = []
    const upstreamError = {
      error: {
        type: 'rate_limit_exceeded',
        code: 'rate_limit_exceeded',
        message: 'Slow down.',
      },
    }
    const upstream = createServer((req, res) => {
      void (async () => {
        upstreamRequests.push(await readJsonBody(req))
        res.writeHead(429, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(upstreamError))
      })().catch((error) => {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : 'unknown error' } }))
      })
    })
    const upstreamPort = await listen(upstream)

    const proxy = createServer((req, res) => {
      handleUnifiedResponsesProxyRequest(req, res, {
        bearerToken: '',
        requireBearerToken: false,
        wireApi: 'responses',
        responsesEndpoint: `http://127.0.0.1:${upstreamPort}/v1/responses`,
        chatCompletionsEndpoint: `http://127.0.0.1:${upstreamPort}/v1/chat/completions`,
        missingKeyMessage: 'missing',
        allowToolFallbackToResponses: false,
        responsesPayloadFormat: 'raw',
      })
    })
    const proxyPort = await listen(proxy)

    try {
      const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'big-pickle',
          previous_response_id: 'resp_existing',
          input: 'hello',
        }),
      })
      const body = await response.json()

      expect(response.status).toBe(429)
      expect(body).toEqual(upstreamError)
      expect(upstreamRequests).toEqual([{
        model: 'big-pickle',
        previous_response_id: 'resp_existing',
        input: 'hello',
      }])
    } finally {
      await close(proxy)
      await close(upstream)
    }
  })

  it('does not retry raw Responses requests that omit previous_response_id', async () => {
    const upstreamRequests: Record<string, unknown>[] = []
    const upstreamError = {
      error: {
        type: 'previous_response_not_found',
        code: 'previous_response_not_found',
        message: 'Previous response was not found.',
      },
    }
    const upstream = createServer((req, res) => {
      void (async () => {
        upstreamRequests.push(await readJsonBody(req))
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(upstreamError))
      })().catch((error) => {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : 'unknown error' } }))
      })
    })
    const upstreamPort = await listen(upstream)

    const proxy = createServer((req, res) => {
      handleUnifiedResponsesProxyRequest(req, res, {
        bearerToken: '',
        requireBearerToken: false,
        wireApi: 'responses',
        responsesEndpoint: `http://127.0.0.1:${upstreamPort}/v1/responses`,
        chatCompletionsEndpoint: `http://127.0.0.1:${upstreamPort}/v1/chat/completions`,
        missingKeyMessage: 'missing',
        allowToolFallbackToResponses: false,
        responsesPayloadFormat: 'raw',
      })
    })
    const proxyPort = await listen(proxy)

    try {
      const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'big-pickle',
          input: 'hello',
        }),
      })
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body).toEqual(upstreamError)
      expect(upstreamRequests).toEqual([{
        model: 'big-pickle',
        input: 'hello',
      }])
    } finally {
      await close(proxy)
      await close(upstream)
    }
  })
})
