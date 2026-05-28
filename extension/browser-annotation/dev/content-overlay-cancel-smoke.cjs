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
        window.__nextQueueId = 1;
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
              if (message && message.type === 'browserAnnotation.contentElementSelected') {
                return Promise.resolve({
                  ok: true,
                  queueCount: 1,
                  item: { id: 'queued-' + window.__nextQueueId++ }
                });
              }
              if (message && message.type === 'browserAnnotation.deleteAnnotationQueueItem') {
                return Promise.resolve({ ok: true, queue: [], queueCount: 0 });
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
    await page.click('#target')
    await waitForMessageCount(page, 'browserAnnotation.contentElementSelected', 1)

    let overlayState = await readOverlayState(page)
    assert.equal(overlayState.selectedHidden, false)
    assert.equal(overlayState.cancelText, '×')
    assert.match(overlayState.detail, /Queue contains 1 item/)

    await page.evaluate((id) => {
      document.getElementById(id).shadowRoot.querySelector('.selection-cancel').click()
    }, rootId)
    await waitForMessageCount(page, 'browserAnnotation.deleteAnnotationQueueItem', 1)
    overlayState = await readOverlayState(page)
    assert.equal(overlayState.selectedHidden, true)
    assert.match(overlayState.status, /canceled/i)
    assert.equal(await countMessages(page, 'browserAnnotation.contentElementSelected'), 1)

    await page.click('#target')
    await waitForMessageCount(page, 'browserAnnotation.contentElementSelected', 2)
    await page.keyboard.press('Escape')
    await waitForMessageCount(page, 'browserAnnotation.deleteAnnotationQueueItem', 2)
    overlayState = await readOverlayState(page)
    assert.equal(overlayState.selectedHidden, true)
    assert.match(overlayState.status, /paused/i)
  } finally {
    await browser.close()
  }
  console.log('Content overlay cancel smoke passed.')
}

async function startOverlay(page) {
  await page.evaluate(() => new Promise((resolve, reject) => {
    const listener = window.__runtimeListeners[0]
    if (!listener) {
      reject(new Error('content script listener was not registered'))
      return
    }
    listener(
      { type: window.BrowserAnnotationConstants.MESSAGE_TYPES.CONTENT_START_OVERLAY },
      {},
      resolve,
    )
  }))
}

async function waitForMessageCount(page, type, expected) {
  await page.waitForFunction(
    ([messageType, count]) => window.__sentMessages.filter((message) => message.type === messageType).length >= count,
    [type, expected],
  )
}

async function countMessages(page, type) {
  return page.evaluate((messageType) =>
    window.__sentMessages.filter((message) => message.type === messageType).length,
  type)
}

async function readOverlayState(page) {
  return page.evaluate((id) => {
    const shadow = document.getElementById(id).shadowRoot
    return {
      selectedHidden: shadow.querySelector('.box-selected').hidden,
      cancelText: shadow.querySelector('.selection-cancel').textContent,
      status: shadow.querySelector('.title').textContent,
      detail: shadow.querySelector('.body').textContent,
    }
  }, rootId)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
