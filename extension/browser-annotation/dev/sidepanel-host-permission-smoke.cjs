const assert = require('node:assert/strict')
const { mkdirSync } = require('node:fs')
const { pathToFileURL } = require('node:url')
const { resolve } = require('node:path')
const { chromium } = require('playwright')

const sidepanelUrl = pathToFileURL(resolve(__dirname, '..', 'sidepanel/sidepanel.html')).toString()
const outputDir = resolve(process.cwd(), 'output', 'playwright')
const pageStateLightScreenshot = resolve(outputDir, 'browser-annotation-page-state-light.png')
const pageStateDarkScreenshot = resolve(outputDir, 'browser-annotation-page-state-dark.png')
const arbitraryTab = {
  id: 7,
  title: 'Remote preview',
  url: 'http://46.62.215.111/browser-annotation-test.html',
}

async function main() {
  mkdirSync(outputDir, { recursive: true })
  await runScenario({ grantPermission: true })
  await runScenario({ grantPermission: false })
  await runProControlScenario({ grantPermission: true })
  await runProControlScenario({ grantPermission: false })
  await runPageStateScenario()
  console.log('Sidepanel host permission smoke passed.')
}

async function runScenario({ grantPermission }) {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  try {
    await page.addInitScript(({ tab, grant }) => {
      const grantedOrigins = new Set()
      const storageLocal = new Map()
      const storageListeners = []
      window.__runtimeMessages = []
      window.__permissionRequests = []
      window.chrome = {
        permissions: {
          contains: async (request) => {
            const origins = Array.isArray(request && request.origins) ? request.origins : []
            return origins.every((origin) => grantedOrigins.has(origin))
          },
          request: async (request) => {
            const origins = Array.isArray(request && request.origins) ? request.origins : []
            window.__permissionRequests.push(origins)
            if (grant) {
              origins.forEach((origin) => grantedOrigins.add(origin))
              return true
            }
            return false
          },
        },
        runtime: {
          sendMessage: async (message) => {
            window.__runtimeMessages.push(message)
            if (message && message.type === 'browserAnnotation.getState') {
              return {
                ok: true,
                state: buildState({
                  title: 'Stale Codex tab',
                  url: 'https://codex-ui.todo-tg-app.ru/',
                  hasHostAccess: true,
                  needsHostPermission: false,
                }),
              }
            }
            if (message && message.type === 'browserAnnotation.devtools.getStatus') {
              return {
                ok: true,
                devtoolsCapture: {
                  status: 'inactive',
                  detail: 'DevTools capture is off.',
                },
              }
            }
            if (message && message.type === 'browserAnnotation.injectOverlay') {
              return {
                ok: true,
                injected: true,
                state: buildState({
                  title: tab.title,
                  url: tab.url,
                  hasHostAccess: true,
                  needsHostPermission: false,
                }),
              }
            }
            return { ok: true }
          },
          getURL: (path) => `chrome-extension://test/${path}`,
        },
        storage: {
          local: {
            get: async (key) => {
              const keys = Array.isArray(key) ? key : [key]
              return Object.fromEntries(keys.map((name) => [name, storageLocal.get(name)]))
            },
            set: async (values) => {
              for (const [key, value] of Object.entries(values || {})) {
                const oldValue = storageLocal.get(key)
                storageLocal.set(key, value)
                for (const listener of storageListeners) {
                  listener({ [key]: { oldValue, newValue: value } }, 'local')
                }
              }
            },
          },
          onChanged: { addListener: (listener) => storageListeners.push(listener) },
        },
        tabs: {
          query: async () => [tab],
        },
      }

      function buildState(activeTabInput) {
        return {
          settings: {
            serverUrl: 'https://codex-ui.todo-tg-app.ru',
            pairingToken: '',
          },
          connection: {
            status: 'disconnected',
            checkedAtIso: null,
            session: null,
            detail: 'Paste a pairing token from Codex UI to connect.',
          },
          queue: [],
          devtoolsCapture: {
            status: 'inactive',
            detail: 'DevTools capture is off.',
          },
          activeTab: {
            id: tab.id,
            title: activeTabInput.title,
            url: activeTabInput.url,
            restricted: false,
            restrictionReason: '',
            hostPermissionPattern: 'https://codex-ui.todo-tg-app.ru/*',
            hasHostAccess: activeTabInput.hasHostAccess,
            needsHostPermission: activeTabInput.needsHostPermission,
            hostAccessStatus: activeTabInput.hasHostAccess ? 'granted' : 'needs_permission',
          },
        }
      }
    }, { tab: arbitraryTab, grant: grantPermission })

    await page.goto(sidepanelUrl)
    await page.locator('#injectOverlay').click()
    await page.waitForFunction(() => window.__permissionRequests.length > 0)

    const permissionRequests = await page.evaluate(() => window.__permissionRequests)
    assert.deepEqual(permissionRequests[0], ['http://46.62.215.111/*'])

    const injectedMessages = await page.evaluate(() =>
      window.__runtimeMessages.filter((message) => message.type === 'browserAnnotation.injectOverlay').length)
    assert.equal(injectedMessages, grantPermission ? 1 : 0)

    const messageText = await page.locator('#message').textContent()
    if (grantPermission) {
      assert.match(messageText || '', /Pick on Page is active/)
    } else {
      assert.match(messageText || '', /Permission denied/)
    }
  } finally {
    await browser.close()
  }
}

async function runProControlScenario({ grantPermission }) {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  try {
    await page.addInitScript(({ tab, grant }) => {
      const grantedOrigins = new Set()
      const storageLocal = new Map()
      const storageListeners = []
      window.__runtimeMessages = []
      window.__permissionRequests = []
      window.chrome = {
        permissions: {
          contains: async (request) => {
            const origins = Array.isArray(request && request.origins) ? request.origins : []
            return origins.every((origin) => grantedOrigins.has(origin))
          },
          request: async (request) => {
            const origins = Array.isArray(request && request.origins) ? request.origins : []
            window.__permissionRequests.push(origins)
            if (grant) {
              origins.forEach((origin) => grantedOrigins.add(origin))
              return true
            }
            return false
          },
        },
        runtime: {
          sendMessage: async (message) => {
            window.__runtimeMessages.push(message)
            if (message && message.type === 'browserAnnotation.getState') {
              return { ok: true, state: buildConnectedState({ enabled: false, status: 'disabled' }) }
            }
            if (message && message.type === 'browserAnnotation.devtools.getStatus') {
              return { ok: true, devtoolsCapture: { status: 'inactive', detail: 'DevTools capture is off.' } }
            }
            if (message && message.type === 'browserAnnotation.proControl.enable') {
              return {
                ok: true,
                state: buildConnectedState(
                  grant
                    ? { enabled: true, status: 'online', detail: 'Pro-control worker enabled.', permission: 'granted' }
                    : { enabled: false, status: 'permission_missing', detail: 'ChatGPT host permission was denied.', permission: 'missing' }
                ),
              }
            }
            return { ok: true }
          },
          getURL: (path) => `chrome-extension://test/${path}`,
        },
        storage: {
          local: {
            get: async (key) => {
              const keys = Array.isArray(key) ? key : [key]
              return Object.fromEntries(keys.map((name) => [name, storageLocal.get(name)]))
            },
            set: async (values) => {
              for (const [key, value] of Object.entries(values || {})) {
                const oldValue = storageLocal.get(key)
                storageLocal.set(key, value)
                for (const listener of storageListeners) {
                  listener({ [key]: { oldValue, newValue: value } }, 'local')
                }
              }
            },
          },
          onChanged: { addListener: (listener) => storageListeners.push(listener) },
        },
        tabs: { query: async () => [tab] },
      }

      function buildConnectedState(proControl) {
        return {
          settings: {
            serverUrl: 'https://codex-ui.todo-tg-app.ru',
            pairingToken: '',
          },
          connection: {
            status: 'connected',
            checkedAtIso: '2026-06-16T00:00:00.000Z',
            session: null,
            binding: {
              bindingId: 'binding-1',
              status: 'active',
              tokenType: 'browser-binding',
              expiresAtIso: '2027-06-16T00:00:00.000Z',
            },
            detail: 'Browser binding validated.',
          },
          persistentBinding: {
            connected: true,
            status: 'active',
            tokenType: 'browser-binding',
            expiresAtIso: '2027-06-16T00:00:00.000Z',
          },
          threadTargets: { status: 'empty', groups: [], detail: 'No targets.' },
          proControl,
          queue: [],
          devtoolsCapture: {
            status: 'inactive',
            detail: 'DevTools capture is off.',
          },
          activeTab: {
            id: tab.id,
            title: tab.title,
            url: tab.url,
            restricted: false,
            restrictionReason: '',
            hostPermissionPattern: 'https://chatgpt.com/*',
            hasHostAccess: true,
            needsHostPermission: false,
            hostAccessStatus: 'granted',
          },
        }
      }
    }, { tab: arbitraryTab, grant: grantPermission })

    await page.goto(sidepanelUrl)
    await page.locator('#enableProControl').click()
    await page.waitForFunction(() => window.__permissionRequests.length > 0)

    const permissionRequests = await page.evaluate(() => window.__permissionRequests)
    assert.deepEqual(permissionRequests[0], ['https://chatgpt.com/*'])

    const enableMessages = await page.evaluate(() =>
      window.__runtimeMessages.filter((message) => message.type === 'browserAnnotation.proControl.enable').length)
    assert.equal(enableMessages, grantPermission ? 1 : 0)

    const statusText = await page.locator('#proControlStatus').textContent()
    const messageText = await page.locator('#message').textContent()
    if (grantPermission) {
      assert.equal(statusText, 'Online')
      assert.match(messageText || '', /enabled/i)
    } else {
      assert.equal(statusText, 'Disabled')
      assert.match(messageText || '', /permission was denied/i)
    }
  } finally {
    await browser.close()
  }
}

async function runPageStateScenario() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  try {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.addInitScript(({ tab }) => {
      const storageLocal = new Map()
      const storageListeners = []
      window.__runtimeMessages = []
      window.__sentQueue = null
      window.chrome = {
        permissions: {
          contains: async () => true,
          request: async () => true,
        },
        runtime: {
          sendMessage: async (message) => {
            window.__runtimeMessages.push(message)
            if (message && message.type === 'browserAnnotation.getState') {
              return { ok: true, state: buildState({ queue: [] }) }
            }
            if (message && message.type === 'browserAnnotation.devtools.getStatus') {
              return { ok: true, devtoolsCapture: activeDevtools() }
            }
            if (message && message.type === 'browserAnnotation.addPageStateAnnotation') {
              const queue = storageLocal.get('browserAnnotation.annotationQueue') || []
              const item = {
                id: 'page-state-smoke',
                kind: 'devtools/page-state',
                createdAtIso: '2026-05-30T10:00:01.000Z',
                tab: {
                  id: tab.id,
                  title: tab.title,
                  url: tab.url,
                },
                context: {
                  kind: 'devtools/page-state',
                  page: {
                    title: tab.title,
                    url: tab.url,
                  },
                },
                noteText: message.noteText,
                preview: null,
              }
              storageLocal.set('browserAnnotation.annotationQueue', [...queue, item])
              return { ok: true, queue: [...queue, item], state: buildState({ queue: [...queue, item] }) }
            }
            if (message && message.type === 'browserAnnotation.sendAnnotationBatch') {
              window.__sentQueue = storageLocal.get('browserAnnotation.annotationQueue') || []
              storageLocal.set('browserAnnotation.annotationQueue', [])
              return {
                ok: true,
                result: { annotationCount: window.__sentQueue.length },
                state: buildState({
                  queue: [],
                  devtoolsCapture: {
                    status: 'inactive',
                    detail: 'DevTools capture is off.',
                  },
                }),
              }
            }
            if (message && message.type === 'browserAnnotation.devtools.disable') {
              return {
                ok: true,
                devtoolsCapture: {
                  status: 'inactive',
                  detail: 'DevTools capture is off.',
                },
              }
            }
            if (message && message.type === 'browserAnnotation.disconnectBinding') {
              return {
                ok: true,
                state: buildState({ queue: [], persistentBinding: null }),
              }
            }
            return { ok: true }
          },
          getURL: (path) => `chrome-extension://test/${path}`,
        },
        storage: {
          local: {
            get: async (key) => {
              const keys = Array.isArray(key) ? key : [key]
              return Object.fromEntries(keys.map((name) => [name, storageLocal.get(name)]))
            },
            set: async (values) => {
              for (const [key, value] of Object.entries(values || {})) {
                const oldValue = storageLocal.get(key)
                storageLocal.set(key, value)
                for (const listener of storageListeners) {
                  listener({ [key]: { oldValue, newValue: value } }, 'local')
                }
              }
            },
          },
          onChanged: { addListener: (listener) => storageListeners.push(listener) },
        },
        tabs: {
          query: async () => [tab],
        },
      }

      function activeDevtools() {
        return {
          status: 'active',
          active: true,
          tabId: tab.id,
          tabTitle: tab.title,
          tabUrl: tab.url,
          startedAtIso: '2026-05-30T10:00:00.000Z',
          captureOptions: { bodyCaptureMode: 'metadata-only' },
          consoleCount: 1,
          networkCount: 1,
          detail: 'Capturing 1 console event(s) and 1 network request(s).',
        }
      }

      function buildState({ queue, devtoolsCapture = activeDevtools(), persistentBinding = {
        status: 'connected',
        sessionId: 'persistent-session',
        threadId: 'thread-page-state',
        revocable: true,
      } }) {
        return {
          settings: {
            serverUrl: 'https://codex-ui.todo-tg-app.ru',
            pairingToken: 'paired-token',
          },
          connection: {
            status: 'connected',
            checkedAtIso: '2026-05-30T10:00:00.000Z',
            session: {
              sessionId: 'session-page-state',
              threadId: 'thread-page-state',
              status: 'active',
              expiresAtIso: '2026-05-30T11:00:00.000Z',
            },
            detail: 'Connected.',
          },
          persistentBinding,
          queue,
          devtoolsCapture,
          activeTab: {
            id: tab.id,
            title: tab.title,
            url: tab.url,
            restricted: false,
            restrictionReason: '',
            hostPermissionPattern: 'http://46.62.215.111/*',
            hasHostAccess: true,
            needsHostPermission: false,
            hostAccessStatus: 'granted',
          },
        }
      }
    }, { tab: arbitraryTab })

    await page.goto(sidepanelUrl)
    await page.locator('#pageStateNote').fill('Check this loaded state')
    await page.locator('#addPageStateNote').click()

    const queued = await page.evaluate(() => window.__sentQueue || window.chrome.storage.local.get('browserAnnotation.annotationQueue'))
    const queue = queued['browserAnnotation.annotationQueue'] || queued
    assert.equal(queue.length, 1)
    assert.equal(queue[0].kind, 'devtools/page-state')
    assert.equal(queue[0].noteText, 'Check this loaded state')
    assert.equal(queue[0].context.page.url, arbitraryTab.url)
    await page.screenshot({ path: pageStateLightScreenshot, fullPage: true })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.screenshot({ path: pageStateDarkScreenshot, fullPage: true })

    await page.locator('#sendBatch').click()
    await page.waitForFunction(() => window.__sentQueue !== null)

    const sentQueue = await page.evaluate(() => window.__sentQueue)
    assert.equal(sentQueue.length, 1)
    assert.equal(sentQueue[0].kind, 'devtools/page-state')
    assert.equal(sentQueue[0].noteText, 'Check this loaded state')

    const injectedMessages = await page.evaluate(() =>
      window.__runtimeMessages.filter((message) => message.type === 'browserAnnotation.injectOverlay').length)
    assert.equal(injectedMessages, 0)

    await page.locator('[data-tab-target="settingsPanel"]').click()
    await expectVisibleText(page, '#persistentBindingStatus', /Persistent: Connected/)
    await assertVisible(page, '#disconnectPersistentBinding')
  } finally {
    await browser.close()
  }
}

async function expectVisibleText(page, selector, pattern) {
  const text = await page.locator(selector).textContent()
  assert.match(text || '', pattern)
}

async function assertVisible(page, selector) {
  assert.equal(await page.locator(selector).isVisible(), true)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
