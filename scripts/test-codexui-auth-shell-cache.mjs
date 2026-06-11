#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')
const port = 6216
const hostHeader = 'codex.todo-tg-app.ru'
const password = 'test-password'
const oneYearSeconds = 365 * 24 * 60 * 60
const minRemainingMs = 364 * 24 * 60 * 60 * 1000
const maxRemainingMs = 366 * 24 * 60 * 60 * 1000

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function request(path, { method = 'GET', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const requestBody = typeof body === 'string' ? body : String(body)
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          Host: hostHeader,
          ...headers,
          ...(requestBody ? { 'Content-Length': Buffer.byteLength(requestBody) } : {}),
        },
      },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: data,
          })
        })
      },
    )
    req.on('error', reject)
    if (requestBody) req.write(requestBody)
    req.end()
  })
}

function spawnServerProcess() {
  const server = spawn(
    'node',
    ['dist-cli/index.js', '--port', String(port), '--no-tunnel', '--no-open', '--no-login'],
    {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_ENV: 'production',
        CODEXUI_PASSWORD: password,
        CODEXUI_BASIC_PASSWORD: password,
        OPENAI_API_KEY: 'test-key',
        OPENAI_BASE_URL: 'http://127.0.0.1:20128/v1',
      },
    },
  )

  let stderrLog = ''
  server.stderr.on('data', (chunk) => {
    stderrLog += String(chunk)
  })

  return {
    server,
    getStderr() {
      return stderrLog
    },
  }
}

async function waitForServer(maxAttempts = 60) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await request('/')
      if (response.status === 200) return
    } catch {
      // Server may not be ready yet.
    }
    await sleep(500)
  }
  throw new Error('Server did not become ready in time')
}

async function startServer() {
  const handle = spawnServerProcess()
  await waitForServer()
  return handle
}

async function cleanup(server) {
  if (server.killed) return
  server.kill('SIGTERM')
  await sleep(750)
  if (!server.killed) {
    server.kill('SIGKILL')
  }
}

async function stopServerHandle(handle, stderrLogs) {
  if (!handle) return
  await cleanup(handle.server)
  const log = handle.getStderr().trim()
  if (log.length > 0) {
    stderrLogs.push(log)
  }
}

async function run() {
  const stderrLogs = []
  let handle = await startServer()

  try {
    const loginResponse = await request('/')
    assert(loginResponse.status === 200, `Expected login page, got HTTP ${loginResponse.status}`)
    assert(loginResponse.body.includes("searchParams.set('shell'"), 'Expected login page to add shell cache-bust query on success')

    const unauthorizedRpc = await request('/codex-api/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ method: 'thread/list', params: { archived: false, limit: 1, sortKey: 'updated_at', modelProviders: [], cursor: null } }),
    })
    const unauthorizedContentType = Array.isArray(unauthorizedRpc.headers['content-type']) ? unauthorizedRpc.headers['content-type'].join(', ') : unauthorizedRpc.headers['content-type'] || ''
    assert(unauthorizedRpc.status === 401, `Expected unauthorized RPC to return HTTP 401, got HTTP ${unauthorizedRpc.status}`)
    assert(unauthorizedContentType.includes('application/json'), `Expected unauthorized RPC to return JSON, got "${unauthorizedContentType}"`)
    assert(!unauthorizedRpc.body.includes('<!DOCTYPE html>'), 'Unauthorized RPC should not return the login HTML page')

    const authResponse = await request('/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password }),
    })
    const authCacheControl = Array.isArray(authResponse.headers['cache-control']) ? authResponse.headers['cache-control'].join(', ') : authResponse.headers['cache-control'] || ''
    const setCookieHeader = authResponse.headers['set-cookie']
    const authCookie = Array.isArray(setCookieHeader) ? setCookieHeader[0] || '' : setCookieHeader || ''
    const expiresMatch = authCookie.match(/(?:^|; )Expires=([^;]+)/)
    const expiresAtMs = expiresMatch ? Date.parse(expiresMatch[1]) : Number.NaN
    const remainingMs = expiresAtMs - Date.now()

    assert(authResponse.status === 200, `Expected successful login, got HTTP ${authResponse.status}`)
    assert(authCacheControl.includes('no-store'), `Expected login response to be no-store, got "${authCacheControl}"`)
    assert(authCookie.includes('portal_session='), 'Expected login response to set portal_session cookie')
    assert(authCookie.includes(`Max-Age=${String(oneYearSeconds)}`), `Expected one-year Max-Age, got "${authCookie}"`)
    assert(authCookie.includes('HttpOnly'), `Expected HttpOnly in Set-Cookie, got "${authCookie}"`)
    assert(authCookie.includes('SameSite=Strict'), `Expected SameSite=Strict in Set-Cookie, got "${authCookie}"`)
    assert(Number.isFinite(expiresAtMs), `Expected parseable Expires in Set-Cookie, got "${authCookie}"`)
    assert(remainingMs >= minRemainingMs && remainingMs <= maxRemainingMs, `Expected Expires about one year ahead, remainingMs=${String(remainingMs)} cookie="${authCookie}"`)

    const nativePreflightResponse = await request('/auth/login', {
      method: 'OPTIONS',
      headers: {
        Origin: 'capacitor://localhost',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
      },
    })
    assert(nativePreflightResponse.status === 204, `Expected native login preflight to return 204, got HTTP ${nativePreflightResponse.status}`)
    assert(nativePreflightResponse.headers['access-control-allow-origin'] === 'capacitor://localhost', 'Expected native login CORS origin echo')
    assert(nativePreflightResponse.headers['access-control-allow-credentials'] === 'true', 'Expected native login CORS credentials')

    const nativeAuthResponse = await request('/auth/login', {
      method: 'POST',
      headers: {
        Origin: 'capacitor://localhost',
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https',
      },
      body: JSON.stringify({ password }),
    })
    const nativeSetCookieHeader = nativeAuthResponse.headers['set-cookie']
    const nativeAuthCookie = Array.isArray(nativeSetCookieHeader) ? nativeSetCookieHeader[0] || '' : nativeSetCookieHeader || ''
    assert(nativeAuthResponse.status === 200, `Expected successful native login, got HTTP ${nativeAuthResponse.status}`)
    assert(nativeAuthResponse.headers['access-control-allow-origin'] === 'capacitor://localhost', 'Expected native login response CORS origin echo')
    assert(nativeAuthResponse.headers['access-control-allow-credentials'] === 'true', 'Expected native login response CORS credentials')
    assert(nativeAuthCookie.includes('portal_session='), 'Expected native login response to set portal_session cookie')
    assert(nativeAuthCookie.includes('SameSite=None'), `Expected native login cookie to use SameSite=None, got "${nativeAuthCookie}"`)
    assert(nativeAuthCookie.includes('Secure'), `Expected native login cookie to be Secure, got "${nativeAuthCookie}"`)

    const sessionCookie = authCookie.split(';', 1)[0] || ''
    const shellResponse = await request('/', {
      headers: {
        Cookie: sessionCookie,
      },
    })
    const shellCacheControl = Array.isArray(shellResponse.headers['cache-control']) ? shellResponse.headers['cache-control'].join(', ') : shellResponse.headers['cache-control'] || ''
    const pragma = Array.isArray(shellResponse.headers.pragma) ? shellResponse.headers.pragma.join(', ') : shellResponse.headers.pragma || ''
    const expires = Array.isArray(shellResponse.headers.expires) ? shellResponse.headers.expires.join(', ') : shellResponse.headers.expires || ''
    const vary = Array.isArray(shellResponse.headers.vary) ? shellResponse.headers.vary.join(', ') : shellResponse.headers.vary || ''

    assert(shellResponse.status === 200, `Expected authenticated shell HTML, got HTTP ${shellResponse.status}`)
    assert(shellCacheControl.includes('private') && shellCacheControl.includes('no-store'), `Expected authenticated shell HTML to be private no-store, got "${shellCacheControl}"`)
    assert(pragma.toLowerCase().includes('no-cache'), `Expected Pragma no-cache, got "${pragma}"`)
    assert(expires === '0', `Expected Expires=0, got "${expires}"`)
    assert(vary.toLowerCase().includes('cookie'), `Expected Vary: Cookie, got "${vary}"`)
    assert(shellResponse.body.includes('<div id="app"></div>'), 'Expected authenticated shell HTML to contain the app mount node')

    await stopServerHandle(handle, stderrLogs)
    handle = await startServer()

    const shellAfterRestart = await request('/', {
      headers: {
        Cookie: sessionCookie,
      },
    })
    assert(shellAfterRestart.status === 200, `Expected cookie-backed session to survive restart, got HTTP ${shellAfterRestart.status}`)
    assert(shellAfterRestart.body.includes('<div id="app"></div>'), 'Expected restarted server to accept existing signed session cookie')

    console.log('Auth shell cache OK: env password is stable, unauthorized API returns 401 JSON, login cache-bust is present, cookie lives for one year, and session survives restart')
  } finally {
    await stopServerHandle(handle, stderrLogs)
    if (stderrLogs.length > 0) {
      console.log('Server stderr:')
      console.log(stderrLogs.join('\n---\n'))
    }
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
