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
                  item: {
                    id: 'queued-draft-1',
                    screenshot: { state: 'ready' }
                  }
                });
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
    await page.waitForTimeout(500)

    let overlayState = await readOverlayState(page)
    assert.equal(overlayState.selectedHidden, false)
    assert.equal(overlayState.hasSelectionToolbar, true)
    assert.equal(overlayState.saveVisible, true)
    assert.equal(overlayState.screenshotToggleVisible, true)
    assert.match(overlayState.meta, /Draft/i)
    assert.equal(await countMessages(page, 'browserAnnotation.contentElementSelected'), 0)
    assert.equal(await countMessages(page, 'browserAnnotation.contentSaveDraftAnnotation'), 0)

    await page.evaluate((id) => {
      const shadow = document.getElementById(id).shadowRoot
      const input = shadow.querySelector('.note-input')
      input.value = 'Check this CTA copy.'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      shadow.querySelector('[aria-label="Save to Queue"]').click()
    }, rootId)
    await waitForMessageCount(page, 'browserAnnotation.contentSaveDraftAnnotation', 1)
    const saveMessage = await lastMessage(page, 'browserAnnotation.contentSaveDraftAnnotation')
    assert.equal(saveMessage.noteText, 'Check this CTA copy.')
    assert.equal(saveMessage.screenshotEnabled, true)
    assert.equal(saveMessage.context.text, 'Pricing CTA')

    overlayState = await readOverlayState(page)
    assert.match(overlayState.meta, /Saved/i)
  } finally {
    await browser.close()
  }
  console.log('Content draft annotation smoke passed.')
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

async function countMessages(page, type) {
  return page.evaluate((messageType) =>
    window.__sentMessages.filter((message) => message.type === messageType).length,
  type)
}

async function lastMessage(page, type) {
  return page.evaluate((messageType) => {
    const messages = window.__sentMessages.filter((message) => message.type === messageType)
    return messages[messages.length - 1]
  }, type)
}

async function readOverlayState(page) {
  return page.evaluate((id) => {
    const host = document.getElementById(id)
    const shadow = host.shadowRoot
    return {
      selectedHidden: shadow.querySelector('.box-selected').hidden,
      hasSelectionToolbar: shadow.querySelector('.panel').classList.contains('is-selection'),
      meta: shadow.querySelector('.meta').textContent,
      saveVisible: Boolean(shadow.querySelector('[aria-label="Save to Queue"]')),
      screenshotToggleVisible: Boolean(shadow.querySelector('[aria-label="Toggle screenshot"]')),
    }
  }, rootId)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
