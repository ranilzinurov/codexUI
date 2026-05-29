const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const { resolve } = require('node:path')
const { chromium } = require('playwright')

const sidepanelUrl = pathToFileURL(resolve(__dirname, '..', 'sidepanel/sidepanel.html')).toString()
const arbitraryTab = {
  id: 7,
  title: 'Remote preview',
  url: 'http://46.62.215.111/browser-annotation-test.html',
}

async function main() {
  await runScenario({ grantPermission: true })
  await runScenario({ grantPermission: false })
  console.log('Sidepanel host permission smoke passed.')
}

async function runScenario({ grantPermission }) {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  try {
    await page.addInitScript(({ tab, grant }) => {
      const grantedOrigins = new Set()
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
          onChanged: { addListener: () => {} },
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
      assert.match(messageText || '', /Overlay injected/)
    } else {
      assert.match(messageText || '', /Permission denied/)
    }
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
