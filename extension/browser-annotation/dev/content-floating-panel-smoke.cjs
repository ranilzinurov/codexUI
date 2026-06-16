const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { chromium } = require('playwright')

const extensionRoot = resolve(__dirname, '..')
const rootId = 'codex-browser-annotation-overlay-root'

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 900, height: 640 } })
  try {
    await page.setContent(`
      <!doctype html>
      <html>
        <body>
          <main style="padding: 120px">
            <button id="target" style="width: 220px; height: 72px">Pricing CTA</button>
          </main>
        </body>
      </html>
    `)
    await page.addScriptTag({
      content: `
        window.__runtimeListeners = [];
        window.__sentMessages = [];
        window.chrome = {
          runtime: {
            onMessage: {
              addListener(listener) {
                window.__runtimeListeners.push(listener);
              }
            },
            sendMessage(message) {
              window.__sentMessages.push(message);
              if (message && message.type === 'browserAnnotation.contentPing') {
                return Promise.resolve({ ok: true });
              }
              if (message && message.type === 'browserAnnotation.contentSaveDraftAnnotation') {
                return Promise.resolve({
                  ok: true,
                  queueCount: 1,
                  item: { id: 'queued-floating-1' }
                });
              }
              if (message && message.type === 'browserAnnotation.deleteAnnotationQueueItem') {
                return Promise.resolve({ ok: true, queueCount: 0 });
              }
              return Promise.resolve({ ok: true });
            }
          }
        };
      `
    })
    for (const file of [
      'shared/constants.js',
      'shared/selection-context.js',
      'content/content-script.js',
    ]) {
      await page.addScriptTag({ content: readFileSync(resolve(extensionRoot, file), 'utf8') })
    }

    await startOverlay(page)
    let floating = await readFloatingPanelState(page)
    assert.equal(floating.hidden, false)
    assert.equal(floating.status, 'Codex annotation')
    assert.equal(floating.pickState, 'Pick on Page active')
    assert.equal(floating.draftActionsHidden, true)
    assert.equal(floating.pauseVisible, true)
    assert.equal(floating.isPageSide, true)
    assert.equal(floating.legacyPanelHidden, true)

    await page.click('#target')
    await page.waitForTimeout(250)
    floating = await readFloatingPanelState(page)
    assert.equal(floating.hidden, false)
    assert.equal(floating.pickState, 'Draft selected')
    assert.equal(floating.draftActionsHidden, false)
    assert.equal(floating.saveHidden, false)
    assert.equal(floating.isPageSide, true)
    assert.equal(floating.legacyPanelHidden, true)

    const positionAfterSelection = floating.rect
    await page.evaluate((id) => {
      document.getElementById(id).shadowRoot.querySelector('[aria-label="Close annotation"]').click()
    }, rootId)
    await page.waitForTimeout(250)
    floating = await readFloatingPanelState(page)
    assert.equal(floating.hidden, false)
    assert.equal(floating.pickState, 'Pick on Page active')
    assert.equal(floating.draftActionsHidden, true)
    assert.equal(floating.isPageSide, true)
    assert.equal(floating.legacyPanelHidden, true)
    assert.deepEqual(floating.rect, positionAfterSelection)

    await page.click('#target')
    await page.waitForTimeout(250)
    await page.evaluate((id) => {
      document.getElementById(id).shadowRoot.querySelector('[aria-label="Floating save to Queue"]').click()
    }, rootId)
    await waitForMessageCount(page, 'browserAnnotation.contentSaveDraftAnnotation', 1)
    floating = await readFloatingPanelState(page)
    assert.equal(floating.hidden, false)
    assert.equal(floating.pickState, 'Pick saved')
    assert.equal(floating.queueCount, '1 queued')
    assert.equal(floating.saveHidden, true)
    assert.equal(floating.isPageSide, true)
    assert.equal(floating.legacyPanelHidden, true)

    await page.evaluate((id) => {
      document.getElementById(id).shadowRoot.querySelector('[aria-label="Pause annotation mode"]').click()
    }, rootId)
    floating = await readFloatingPanelState(page)
    assert.equal(floating.hostHidden, true)
    assert.equal(floating.hidden, true)
  } finally {
    await browser.close()
  }
  console.log('Content floating panel smoke passed.')
}

async function startOverlay(page) {
  await sendContentMessage(page, {
    type: await page.evaluate(() => window.BrowserAnnotationConstants.MESSAGE_TYPES.CONTENT_START_OVERLAY),
  })
}

async function sendContentMessage(page, message) {
  await page.evaluate((payload) => new Promise((resolve, reject) => {
    const listener = window.__runtimeListeners[0]
    if (!listener) {
      reject(new Error('content script listener was not registered'))
      return
    }
    listener(payload, {}, resolve)
  }), message)
}

async function waitForMessageCount(page, type, expected) {
  await page.waitForFunction(
    ([messageType, count]) => window.__sentMessages.filter((message) => message.type === messageType).length >= count,
    [type, expected],
  )
}

async function readFloatingPanelState(page) {
  return page.evaluate((id) => {
    const host = document.getElementById(id)
    const shadow = host.shadowRoot
    const panel = shadow.querySelector('.floating-panel')
    const rect = panel.getBoundingClientRect()
    const roundedRect = {
      top: Math.round(rect.top),
      right: Math.round(window.innerWidth - rect.right),
    }
    return {
      hostHidden: host.hidden,
      hidden: panel.hidden,
      rect: roundedRect,
      isPageSide: roundedRect.top === 16 && roundedRect.right === 16,
      status: shadow.querySelector('.floating-status').textContent,
      pickState: shadow.querySelector('.floating-pick-state').textContent,
      queueCount: shadow.querySelector('.floating-queue-count').textContent,
      draftActionsHidden: shadow.querySelector('.floating-draft-actions').hidden,
      pauseVisible: !shadow.querySelector('[aria-label="Pause annotation mode"]').hidden,
      saveHidden: shadow.querySelector('[aria-label="Floating save to Queue"]').hidden,
      legacyPanelHidden: shadow.querySelector('.panel').hidden,
    }
  }, rootId)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
