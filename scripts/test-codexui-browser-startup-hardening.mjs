#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { webkit } from 'playwright'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')
const port = 6215
const baseUrl = `http://127.0.0.1:${String(port)}`

async function waitForServer(maxAttempts = 60) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/codex-api/home-directory`)
      if (response.ok) return
    } catch {
      // Server may not be ready yet.
    }
    await sleep(500)
  }
  throw new Error('Server did not become ready in time')
}

async function waitForAppShell(page) {
  await page.waitForSelector('.desktop-layout', { timeout: 15000 })
}

async function cleanup(server) {
  if (server.killed) return
  server.kill('SIGTERM')
  await sleep(750)
  if (!server.killed) {
    server.kill('SIGKILL')
  }
}

async function run() {
  const server = spawn(
    'node',
    ['dist-cli/index.js', '--port', String(port), '--no-password', '--no-tunnel', '--no-open', '--no-login'],
    {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        OPENAI_API_KEY: 'test-key',
        OPENAI_BASE_URL: 'http://127.0.0.1:20128/v1',
      },
    },
  )

  let stderrLog = ''
  server.stderr.on('data', (chunk) => {
    stderrLog += String(chunk)
  })

  const browser = await webkit.launch({ headless: true })
  try {
    await waitForServer()

    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    await context.addInitScript(() => {
      const blockedStorage = {
        getItem() { throw new DOMException('Access denied', 'SecurityError') },
        setItem() { throw new DOMException('Access denied', 'SecurityError') },
        removeItem() { throw new DOMException('Access denied', 'SecurityError') },
      }

      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          return blockedStorage
        },
      })

      const originalMatchMedia = window.matchMedia.bind(window)
      window.matchMedia = (query) => {
        const mql = originalMatchMedia(query)
        const listeners = new Set()
        return {
          get matches() { return mql.matches },
          get media() { return mql.media },
          onchange: null,
          addListener(listener) { listeners.add(listener) },
          removeListener(listener) { listeners.delete(listener) },
          dispatchEvent(event) {
            return typeof mql.dispatchEvent === 'function' ? mql.dispatchEvent(event) : true
          },
        }
      }
    })

    const page = await context.newPage()
    const apiRequests = []
    const consoleErrors = []
    const pageErrors = []
    page.on('response', (response) => {
      const url = response.url()
      if (url.includes('/codex-api/')) {
        apiRequests.push({ url, status: response.status() })
      }
    })
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text())
      }
    })
    page.on('pageerror', (error) => {
      pageErrors.push(error.message)
    })

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await waitForAppShell(page)

    const initialStartupState = await page.evaluate(() => ({
      hash: window.location.hash,
      threadRows: document.querySelectorAll('.thread-row-item').length,
      title: document.querySelector('.content-title')?.textContent?.trim() ?? '',
      drawerVisible: !!document.querySelector('.mobile-drawer-backdrop'),
    }))

    if (initialStartupState.threadRows > 0 && !initialStartupState.drawerVisible) {
      throw new Error(`Expected initial mobile startup to expand the thread list drawer when thread rows exist, got ${JSON.stringify(initialStartupState)}`)
    }

    await page.evaluate(async () => {
      const cache = await caches.open('codexweb-shell-v2')
      await cache.put('/__sw-cleanup-test__', new Response('stale-shell', {
        headers: { 'content-type': 'text/plain' },
      }))
    })

    consoleErrors.length = 0
    pageErrors.length = 0

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
    await waitForAppShell(page)
    await page.waitForTimeout(1000)

    const workerState = await page.evaluate(async () => {
      const supportsServiceWorker = 'serviceWorker' in navigator
      const registrations = supportsServiceWorker
        ? await navigator.serviceWorker.getRegistrations()
        : []
      const cacheKeys = 'caches' in window ? await caches.keys() : []
      return {
        supportsServiceWorker,
        registrationCount: registrations.length,
        registrationUrls: registrations.map((registration) => (
          registration.active?.scriptURL
          || registration.waiting?.scriptURL
          || registration.installing?.scriptURL
          || ''
        )),
        cacheKeys,
      }
    })

    if (workerState.supportsServiceWorker && workerState.registrationCount === 0) {
      throw new Error(`Expected hosted mode to keep the push service worker registered, got ${JSON.stringify(workerState)}`)
    }

    if (workerState.supportsServiceWorker && !workerState.registrationUrls.some((url) => url.endsWith('/sw.js'))) {
      throw new Error(`Expected hosted mode to register /sw.js, got ${JSON.stringify(workerState)}`)
    }

    if (workerState.cacheKeys.some((key) => key.startsWith('codexweb-shell-') && key !== 'codexweb-shell-v2')) {
      throw new Error(`Expected hosted mode cleanup to remove legacy codexweb caches, got ${JSON.stringify(workerState)}`)
    }

    const relevantPageErrors = pageErrors.filter((message) => !message.includes('due to access control checks.'))

    if (relevantPageErrors.length > 0) {
      throw new Error(`Unexpected page errors: ${relevantPageErrors.join('\n')}`)
    }

    if (consoleErrors.some((message) => message.includes('SecurityError'))) {
      throw new Error(`Unexpected storage compatibility error: ${consoleErrors.join('\n')}`)
    }

    if (!apiRequests.some((request) => request.url.includes('/codex-api/home-directory') && request.status === 200)) {
      throw new Error(`Expected home-directory request, got: ${JSON.stringify(apiRequests)}`)
    }

    await page.goto(`${baseUrl}/?shell=mobile-auth`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForFunction(() => window.location.search === '', undefined, { timeout: 15000 })
    await page.waitForTimeout(1500)

    const mobileShellState = await page.evaluate(() => ({
      hash: window.location.hash,
      threadRows: document.querySelectorAll('.thread-row-item').length,
      title: document.querySelector('.content-title')?.textContent?.trim() ?? '',
      drawerVisible: !!document.querySelector('.mobile-drawer-backdrop'),
    }))

    if (mobileShellState.threadRows > 0 && !mobileShellState.drawerVisible) {
      throw new Error(`Expected mobile shell launch to expand the thread list drawer when thread rows exist, got ${JSON.stringify(mobileShellState)}`)
    }

    console.log('Browser hardening OK: startup survives blocked localStorage, clears stale shell caches, keeps the push service worker registered, and expands the mobile thread list drawer when threads are available')
  } finally {
    await browser.close()
    await cleanup(server)
    if (stderrLog.trim().length > 0) {
      console.log('Server stderr:')
      console.log(stderrLog.trim())
    }
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
