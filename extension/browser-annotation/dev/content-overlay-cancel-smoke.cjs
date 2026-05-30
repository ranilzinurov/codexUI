const assert = require('node:assert/strict')
const { mkdirSync, readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { chromium } = require('playwright')

const extensionRoot = resolve(__dirname, '..')
const rootId = 'codex-browser-annotation-overlay-root'
const outputDir = resolve(process.cwd(), 'output', 'playwright')
const lightScreenshot = resolve(outputDir, 'browser-annotation-overlay-inline-light.png')
const darkScreenshot = resolve(outputDir, 'browser-annotation-overlay-inline-dark.png')

async function main() {
  mkdirSync(outputDir, { recursive: true })
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
    assert.match(overlayState.label, /Element selected|button/i)
    assert.match(overlayState.meta, /Saved/)

    await openNoteAndType(page, 'Check this CTA copy.')
    await waitForMessageCount(page, 'browserAnnotation.updateAnnotationQueueItem', 1)
    const noteUpdate = await lastMessage(page, 'browserAnnotation.updateAnnotationQueueItem')
    assert.equal(noteUpdate.id, 'queued-1')
    assert.equal(noteUpdate.patch.noteText, 'Check this CTA copy.')
    await page.screenshot({ path: lightScreenshot, fullPage: true })

    await page.evaluate((id) => {
      document.getElementById(id).shadowRoot.querySelector('[aria-label="Close annotation"]').click()
    }, rootId)
    await waitForMessageCount(page, 'browserAnnotation.deleteAnnotationQueueItem', 1)
    overlayState = await readOverlayState(page)
    assert.equal(overlayState.selectedHidden, true)
    assert.match(overlayState.label, /Click an element|canceled/i)
    assert.equal(await countMessages(page, 'browserAnnotation.contentElementSelected'), 1)

    await dragArea(page, { x: 310, y: 230 }, { x: 560, y: 385 })
    await waitForMessageCount(page, 'browserAnnotation.contentElementSelected', 2)
    const areaSelection = await lastMessage(page, 'browserAnnotation.contentElementSelected')
    assert.equal(areaSelection.context.selectionMode, 'area')
    assert.equal(areaSelection.context.rect.width, 250)
    assert.equal(areaSelection.context.rect.height, 155)
    await page.keyboard.press('Escape')
    await waitForMessageCount(page, 'browserAnnotation.deleteAnnotationQueueItem', 2)
    overlayState = await readOverlayState(page)
    assert.equal(overlayState.selectedHidden, true)
    assert.match(overlayState.label, /paused|canceled/i)

    await page.evaluate(() => {
      document.documentElement.style.background = '#111827'
      document.body.style.background = '#111827'
      document.body.style.color = '#e5e7eb'
    })
    await startOverlay(page)
    await page.click('#target')
    await waitForMessageCount(page, 'browserAnnotation.contentElementSelected', 3)
    await page.screenshot({ path: darkScreenshot, fullPage: true })
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

async function lastMessage(page, type) {
  return page.evaluate((messageType) => {
    const messages = window.__sentMessages.filter((message) => message.type === messageType)
    return messages[messages.length - 1]
  }, type)
}

async function openNoteAndType(page, text) {
  await page.evaluate(([id, value]) => {
    const shadow = document.getElementById(id).shadowRoot
    shadow.querySelector('[aria-label="Add comment"]').click()
    const input = shadow.querySelector('.note-input')
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, [rootId, text])
}

async function dragArea(page, start, end) {
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 4 })
  await page.mouse.up()
}

async function readOverlayState(page) {
  return page.evaluate((id) => {
    const shadow = document.getElementById(id).shadowRoot
    return {
      selectedHidden: shadow.querySelector('.box-selected').hidden,
      cancelText: shadow.querySelector('[aria-label="Close annotation"]').textContent,
      label: shadow.querySelector('.label').textContent,
      meta: shadow.querySelector('.meta').textContent,
      noteHidden: shadow.querySelector('.note-wrap').hidden,
    }
  }, rootId)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
