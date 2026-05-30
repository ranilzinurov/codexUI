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
        window.__transcribeMode = 'ok';
        class FakeMediaRecorder extends EventTarget {
          static isTypeSupported(mimeType) {
            return String(mimeType || '').startsWith('audio/webm');
          }
          constructor(stream, options = {}) {
            super();
            this.stream = stream;
            this.mimeType = options.mimeType || 'audio/webm';
            this.state = 'inactive';
          }
          start() {
            this.state = 'recording';
          }
          stop() {
            if (this.state === 'inactive') {
              return;
            }
            this.state = 'inactive';
            this.dispatchEvent(new BlobEvent('dataavailable', {
              data: new Blob(['fake voice'], { type: this.mimeType })
            }));
            this.dispatchEvent(new Event('stop'));
          }
        }
        window.MediaRecorder = FakeMediaRecorder;
        Object.defineProperty(navigator, 'mediaDevices', {
          configurable: true,
          value: {
            getUserMedia() {
              return Promise.resolve({
                getTracks() {
                  return [{ stop() {} }];
                }
              });
            }
          }
        });
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
              if (message && message.type === 'browserAnnotation.contentTranscribeAudio') {
                if (window.__transcribeMode === 'reject') {
                  return Promise.reject(new Error('No transcription listener'));
                }
                if (window.__transcribeMode === 'pending') {
                  return Promise.resolve({ ok: true });
                }
                return Promise.resolve({ ok: true, transcriptText: 'Recorded voice note.' });
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
    assert.equal(overlayState.hostHidden, false)
    assert.equal(overlayState.panelHidden, false)
    assert.equal(overlayState.cancelText, '×')
    assert.deepEqual(overlayState.actionTexts, ['✎', '●', '×'])
    assert.equal(overlayState.actionLabels.join('|'), 'Add comment|Start voice recording|Close annotation')
    assert.equal(overlayState.closeIsRightmost, true)
    assert.equal(overlayState.hasSelectionToolbar, true)
    assert.match(overlayState.label, /Element selected|button/i)
    assert.match(overlayState.meta, /Saved/)

    await openNoteAndType(page, 'Check this CTA copy.')
    await waitForMessageCount(page, 'browserAnnotation.updateAnnotationQueueItem', 1)
    const noteUpdate = await lastMessage(page, 'browserAnnotation.updateAnnotationQueueItem')
    assert.equal(noteUpdate.id, 'queued-1')
    assert.equal(noteUpdate.patch.noteText, 'Check this CTA copy.')

    await recordVoice(page)
    await waitForMessageCount(page, 'browserAnnotation.contentTranscribeAudio', 1)
    await waitForMessageCount(page, 'browserAnnotation.updateAnnotationQueueItem', 2)
    const voiceMessage = await lastVoiceMessage(page)
    assert.equal(voiceMessage.itemId, 'queued-1')
    assert.match(voiceMessage.recordingToken, /^\d+-\d+$/)
    assert.match(voiceMessage.mimeType, /^audio\//)
    assert.equal(voiceMessage.byteLength, 10)
    assert.match(voiceMessage.audioDataUrl, /^data:audio\/webm(?:;codecs=opus)?;base64,/)
    assert.ok(voiceMessage.durationMs >= 0)
    const voiceNoteUpdate = await lastMessage(page, 'browserAnnotation.updateAnnotationQueueItem')
    assert.equal(voiceNoteUpdate.id, 'queued-1')
    assert.match(voiceNoteUpdate.patch.noteText, /Recorded voice note\./)

    const updateCountBeforeStale = await countMessages(page, 'browserAnnotation.updateAnnotationQueueItem')
    await sendContentMessage(page, {
      type: 'browserAnnotation.contentTranscriptionResult',
      itemId: 'queued-1',
      recordingToken: 'stale-token',
      transcriptText: 'This stale transcript must be ignored.'
    })
    await page.waitForTimeout(450)
    assert.equal(await countMessages(page, 'browserAnnotation.updateAnnotationQueueItem'), updateCountBeforeStale)
    await page.screenshot({ path: lightScreenshot, fullPage: true })

    await page.evaluate((id) => {
      document.getElementById(id).shadowRoot.querySelector('[aria-label="Close annotation"]').click()
    }, rootId)
    await waitForMessageCount(page, 'browserAnnotation.deleteAnnotationQueueItem', 1)
    overlayState = await readOverlayState(page)
    assert.equal(overlayState.selectedHidden, true)
    assert.equal(overlayState.hostHidden, false)
    assert.equal(overlayState.panelHidden, false)
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
    assert.equal(overlayState.hostHidden, true)
    assert.equal(overlayState.panelHidden, true)
    assert.equal(overlayState.selectedHidden, true)
    await page.click('#target')
    await page.waitForTimeout(250)
    assert.equal(await countMessages(page, 'browserAnnotation.contentElementSelected'), 2)

    await startOverlay(page)
    await page.click('#target')
    await waitForMessageCount(page, 'browserAnnotation.contentElementSelected', 3)
    await page.evaluate(() => {
      window.__transcribeMode = 'reject'
    })
    await recordVoice(page)
    await waitForMessageCount(page, 'browserAnnotation.contentTranscribeAudio', 2)
    overlayState = await readOverlayState(page)
    assert.match(overlayState.meta, /unavailable/i)

    await page.evaluate(() => {
      document.documentElement.style.background = '#111827'
      document.body.style.background = '#111827'
      document.body.style.color = '#e5e7eb'
    })
    await startOverlay(page)
    await page.click('#target')
    await waitForMessageCount(page, 'browserAnnotation.contentElementSelected', 4)
    await page.screenshot({ path: darkScreenshot, fullPage: true })
  } finally {
    await browser.close()
  }
  console.log('Content overlay cancel smoke passed.')
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

async function lastVoiceMessage(page) {
  return page.evaluate(() => {
    const messages = window.__sentMessages.filter((message) => message.type === 'browserAnnotation.contentTranscribeAudio')
    const message = messages[messages.length - 1]
    return {
      itemId: message.itemId,
      recordingToken: message.recordingToken,
      mimeType: message.mimeType,
      durationMs: message.durationMs,
      byteLength: message.byteLength,
      audioDataUrl: message.audioDataUrl,
    }
  })
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

async function recordVoice(page) {
  await page.evaluate((id) => {
    document.getElementById(id).shadowRoot.querySelector('[aria-label="Start voice recording"]').click()
  }, rootId)
  await page.waitForFunction((id) => {
    const shadow = document.getElementById(id).shadowRoot
    return shadow.querySelector('[aria-label="Stop voice recording"]')
  }, rootId)
  await page.evaluate((id) => {
    document.getElementById(id).shadowRoot.querySelector('[aria-label="Stop voice recording"]').click()
  }, rootId)
}

async function dragArea(page, start, end) {
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 4 })
  await page.mouse.up()
}

async function readOverlayState(page) {
  return page.evaluate((id) => {
    const host = document.getElementById(id)
    const shadow = host.shadowRoot
    const actions = [...shadow.querySelectorAll('.actions button')]
    return {
      hostHidden: host.hidden,
      panelHidden: shadow.querySelector('.panel').hidden,
      selectedHidden: shadow.querySelector('.box-selected').hidden,
      cancelText: shadow.querySelector('[aria-label="Close annotation"]').textContent,
      actionTexts: actions.map((button) => button.textContent),
      actionLabels: actions.map((button) => button.getAttribute('aria-label')),
      closeIsRightmost: actions[actions.length - 1].getAttribute('aria-label') === 'Close annotation',
      hasSelectionToolbar: shadow.querySelector('.panel').classList.contains('is-selection'),
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
