#!/usr/bin/env node
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')
const wavPath = join(rootDir, 'test', 'fixtures', 'hello.wav')

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve())
  })
}

async function waitForServer(baseUrl, maxAttempts = 60) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/codex-api/home-directory`)
      if (response.ok) return
    } catch {
      // Server may not be ready yet.
    }
    await sleep(500)
  }
  throw new Error(`Server did not become ready in time: ${baseUrl}`)
}

async function cleanup(server) {
  if (server.killed) return
  server.kill('SIGTERM')
  await sleep(750)
  if (!server.killed) {
    server.kill('SIGKILL')
  }
}

async function runTranscribe(baseUrl, language) {
  const audioBuffer = await readFile(wavPath)
  const form = new FormData()
  form.append('file', new Blob([audioBuffer], { type: 'audio/wav' }), 'hello.wav')
  if (language) form.append('language', language)

  const response = await fetch(`${baseUrl}/codex-api/transcribe`, {
    method: 'POST',
    body: form,
  })
  const text = await response.text()
  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = null
  }
  if (!response.ok) {
    throw new Error(`Transcribe request failed: HTTP ${String(response.status)} ${response.statusText}\n${text}`)
  }
  return parsed
}

async function withCodexUiServer(port, env, callback) {
  const baseUrl = `http://127.0.0.1:${String(port)}`
  const server = spawn(
    'node',
    ['dist-cli/index.js', '--port', String(port), '--no-password', '--no-tunnel', '--no-open', '--no-login'],
    {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        OPENAI_API_KEY: '',
        OPENAI_BASE_URL: '',
        CODEXUI_TRANSCRIBE_PROVIDER: '',
        CODEXUI_TRANSCRIBE_API_KEY: '',
        CODEXUI_TRANSCRIBE_BASE_URL: '',
        CODEXUI_TRANSCRIBE_MODEL: '',
        CODEXUI_TRANSCRIBE_LANGUAGE: '',
        GROQ_API_KEY: '',
        GROQ_STT_MODEL: '',
        GROQ_STT_LANGUAGE: '',
        CODEX_HOME: `/tmp/codexui-transcription-test-home-${String(port)}`,
        ...env,
      },
    },
  )

  let stderrLog = ''
  server.stderr.on('data', (chunk) => {
    stderrLog += String(chunk)
  })

  try {
    await waitForServer(baseUrl)
    return await callback(baseUrl)
  } finally {
    await cleanup(server)
    if (stderrLog.trim().length > 0) {
      console.log('Server stderr:')
      console.log(stderrLog.trim())
    }
  }
}

async function run() {
  const requests = []
  const upstreamPort = 6212
  const upstream = createServer(async (req, res) => {
    const bodyChunks = []
    for await (const chunk of req) {
      bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    requests.push({
      method: req.method ?? 'GET',
      url: req.url ?? '/',
      authorization: req.headers.authorization ?? '',
      body: Buffer.concat(bodyChunks).toString('utf8'),
    })

    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ text: 'ok' }))
  })

  await listen(upstream, upstreamPort)

  try {
    requests.length = 0
    await withCodexUiServer(6213, {
      OPENAI_API_KEY: 'default-key',
      OPENAI_BASE_URL: `http://127.0.0.1:${String(upstreamPort)}/openai`,
      CODEXUI_TRANSCRIBE_BASE_URL: `http://127.0.0.1:${String(upstreamPort)}/override`,
    }, async (baseUrl) => {
      const parsed = await runTranscribe(baseUrl, 'en')
      if (!parsed || parsed.text !== 'ok') {
        throw new Error(`Unexpected transcription response without override key: ${JSON.stringify(parsed)}`)
      }
    })

    if (requests.length !== 1) {
      throw new Error(`Expected exactly one upstream request without override key, got ${String(requests.length)}`)
    }
    if (requests[0].url !== '/openai/audio/transcriptions') {
      throw new Error(`Expected OPENAI_BASE_URL without override key, got ${requests[0].url}`)
    }
    if (requests[0].authorization !== 'Bearer default-key') {
      throw new Error(`Unexpected auth header without override key: ${requests[0].authorization}`)
    }
    if (!requests[0].body.includes('name="language"') || !requests[0].body.includes('\r\n\r\nen\r\n')) {
      throw new Error('Expected request language from client payload when override key is absent')
    }

    requests.length = 0
    await withCodexUiServer(6214, {
      OPENAI_API_KEY: 'default-key',
      OPENAI_BASE_URL: `http://127.0.0.1:${String(upstreamPort)}/openai`,
      CODEXUI_TRANSCRIBE_API_KEY: 'override-key',
      CODEXUI_TRANSCRIBE_BASE_URL: `http://127.0.0.1:${String(upstreamPort)}/override`,
      CODEXUI_TRANSCRIBE_MODEL: 'whisper-large-v3-turbo',
      CODEXUI_TRANSCRIBE_LANGUAGE: 'ru',
    }, async (baseUrl) => {
      const parsed = await runTranscribe(baseUrl)
      if (!parsed || parsed.text !== 'ok') {
        throw new Error(`Unexpected transcription response with override key: ${JSON.stringify(parsed)}`)
      }
    })

    if (requests.length !== 1) {
      throw new Error(`Expected exactly one upstream request with override key, got ${String(requests.length)}`)
    }
    if (requests[0].url !== '/override/audio/transcriptions') {
      throw new Error(`Expected CODEXUI_TRANSCRIBE_BASE_URL with override key, got ${requests[0].url}`)
    }
    if (requests[0].authorization !== 'Bearer override-key') {
      throw new Error(`Unexpected auth header with override key: ${requests[0].authorization}`)
    }
    if (!requests[0].body.includes('name="language"') || !requests[0].body.includes('\r\n\r\nru\r\n')) {
      throw new Error('Expected override language when client payload does not provide one')
    }

    requests.length = 0
    await withCodexUiServer(6216, {
      OPENAI_API_KEY: 'default-key',
      OPENAI_BASE_URL: `http://127.0.0.1:${String(upstreamPort)}/openai`,
      CODEXUI_TRANSCRIBE_PROVIDER: 'openai',
      GROQ_API_KEY: 'groq-key',
      GROQ_STT_MODEL: 'whisper-large-v3-turbo',
      GROQ_STT_LANGUAGE: 'ru',
    }, async (baseUrl) => {
      const parsed = await runTranscribe(baseUrl)
      if (!parsed || parsed.text !== 'ok') {
        throw new Error(`Unexpected transcription response with OpenAI provider selected: ${JSON.stringify(parsed)}`)
      }
    })

    if (requests.length !== 1) {
      throw new Error(`Expected exactly one upstream request with OpenAI provider selected, got ${String(requests.length)}`)
    }
    if (requests[0].url !== '/openai/audio/transcriptions') {
      throw new Error(`Expected OPENAI_BASE_URL with OpenAI provider selected, got ${requests[0].url}`)
    }
    if (requests[0].authorization !== 'Bearer default-key') {
      throw new Error(`Unexpected auth header with OpenAI provider selected: ${requests[0].authorization}`)
    }
    if (!requests[0].body.includes('name="model"') || !requests[0].body.includes('\r\n\r\nopenai/gpt-4o-mini-transcribe\r\n')) {
      throw new Error('Expected OpenAI transcription model when OpenAI provider is selected')
    }
    if (requests[0].body.includes('name="language"')) {
      throw new Error('Did not expect Groq default language when OpenAI provider is selected')
    }

    requests.length = 0
    await withCodexUiServer(6215, {
      OPENAI_API_KEY: 'default-key',
      OPENAI_BASE_URL: `http://127.0.0.1:${String(upstreamPort)}/openai`,
      GROQ_API_KEY: 'groq-key',
      CODEXUI_TRANSCRIBE_BASE_URL: `http://127.0.0.1:${String(upstreamPort)}/groq`,
    }, async (baseUrl) => {
      const parsed = await runTranscribe(baseUrl)
      if (!parsed || parsed.text !== 'ok') {
        throw new Error(`Unexpected transcription response with Groq key: ${JSON.stringify(parsed)}`)
      }
    })

    if (requests.length !== 1) {
      throw new Error(`Expected exactly one upstream request with Groq key, got ${String(requests.length)}`)
    }
    if (requests[0].url !== '/groq/audio/transcriptions') {
      throw new Error(`Expected Groq transcription base URL, got ${requests[0].url}`)
    }
    if (requests[0].authorization !== 'Bearer groq-key') {
      throw new Error(`Unexpected auth header with Groq key: ${requests[0].authorization}`)
    }
    if (!requests[0].body.includes('name="model"') || !requests[0].body.includes('\r\n\r\nwhisper-large-v3-turbo\r\n')) {
      throw new Error('Expected Groq default transcription model')
    }
    if (!requests[0].body.includes('name="language"') || !requests[0].body.includes('\r\n\r\nru\r\n')) {
      throw new Error('Expected Groq default transcription language')
    }

    console.log('Transcription override OK: fallback and dedicated STT key routing are correct')
  } finally {
    await new Promise((resolve, reject) => {
      upstream.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
