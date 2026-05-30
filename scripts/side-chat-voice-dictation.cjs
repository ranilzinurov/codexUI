const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:4174'
const THREAD_ID = process.env.THREAD_ID || '019e72fd-945e-7030-9b4a-830e39a6443c'
const DARK_MODE = process.env.SIDE_CHAT_DARK === '1'
const TIMEOUT_MS = Number(process.env.SIDE_CHAT_TIMEOUT_MS || 180000)
const MARKER = `SIDE_VOICE_${Date.now()}`
const TRANSCRIPT = process.env.SIDE_CHAT_VOICE_TRANSCRIPT || `${MARKER}: answer briefly what is being discussed in the main chat`
const OUT_DIR = path.resolve(process.cwd(), 'output/playwright')
const SCREENSHOT_PATH = path.join(OUT_DIR, DARK_MODE
  ? 'side-chat-voice-dictation-dark.png'
  : 'side-chat-voice-dictation-light.png')
const LOG_PATH = path.join(OUT_DIR, 'side-chat-voice-dictation-log.json')

function truncate(value, length = 1200) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > length ? `${text.slice(0, length)}...` : text
}

function parseJson(value) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const evidence = {
    baseUrl: BASE_URL,
    threadId: THREAD_ID,
    marker: MARKER,
    transcript: TRANSCRIPT,
    darkMode: DARK_MODE,
    startedAt: new Date().toISOString(),
    rpc: [],
    fetchErrors: [],
    transcribeRequests: 0,
    final: null,
  }

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })

  await page.addInitScript(() => {
    class FakeMediaRecorder {
      static isTypeSupported() {
        return true
      }

      constructor() {
        this.state = 'inactive'
        this.mimeType = 'audio/webm'
        this.ondataavailable = null
        this.onstop = null
      }

      start() {
        this.state = 'recording'
      }

      requestData() {
        this.ondataavailable?.({ data: new Blob(['side voice'], { type: 'audio/webm' }) })
      }

      stop() {
        if (this.state === 'inactive') return
        this.requestData()
        this.state = 'inactive'
        setTimeout(() => this.onstop?.(), 0)
      }

      pause() {
        if (this.state === 'recording') this.state = 'paused'
      }

      resume() {
        if (this.state === 'paused') this.state = 'recording'
      }
    }

    const fakeTrack = {
      label: 'Mock microphone',
      getSettings: () => ({
        deviceId: 'mock-device',
        groupId: 'mock-group',
        sampleRate: 48000,
        channelCount: 1,
      }),
      stop: () => undefined,
    }
    const fakeStream = {
      getAudioTracks: () => [fakeTrack],
      getTracks: () => [fakeTrack],
    }

    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      writable: true,
      value: FakeMediaRecorder,
    })
    class FakeAudioContext {
      constructor() {
        this.state = 'running'
        this.destination = {}
      }

      createMediaStreamSource() {
        return { connect: () => undefined, disconnect: () => undefined }
      }

      createScriptProcessor() {
        return {
          connect: () => undefined,
          disconnect: () => undefined,
          onaudioprocess: null,
        }
      }

      suspend() {
        this.state = 'suspended'
        return Promise.resolve()
      }

      resume() {
        this.state = 'running'
        return Promise.resolve()
      }

      close() {
        this.state = 'closed'
        return Promise.resolve()
      }
    }
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      writable: true,
      value: FakeAudioContext,
    })
    Object.defineProperty(window, 'webkitAudioContext', {
      configurable: true,
      writable: true,
      value: FakeAudioContext,
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => fakeStream,
      },
    })
  })

  if (DARK_MODE) {
    await page.addInitScript(() => {
      window.localStorage.setItem('codex-web-local.dark-mode.v1', 'dark')
    })
  }

  page.on('request', (request) => {
    if (request.url().includes('/codex-api/transcribe')) {
      evidence.transcribeRequests += 1
    }
    if (!request.url().includes('/codex-api/rpc')) return
    const body = parseJson(request.postData())
    evidence.rpc.push({
      stage: 'request',
      method: body?.method || null,
      params: body?.params || null,
      at: new Date().toISOString(),
    })
  })

  page.on('response', async (response) => {
    const url = response.url()
    if (!url.includes('/codex-api/')) return
    if (response.status() >= 400) {
      evidence.fetchErrors.push({
        status: response.status(),
        url,
        body: truncate(await response.text().catch((error) => String(error)), 1200),
      })
    }
  })

  await page.route('**/codex-api/transcribe', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ text: TRANSCRIPT }),
    })
  })

  try {
    await page.goto(`${BASE_URL}/#/thread/${THREAD_ID}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})

    const mainBefore = await page.locator('.content-thread').innerText({ timeout: 30000 })
    await page.getByRole('button', { name: 'Thread features' }).click({ timeout: 30000 })
    await page
      .getByRole('menu', { name: 'Thread features' })
      .getByRole('menuitem', { name: /Side/ })
      .click({ timeout: 30000 })

    const sidePanel = page.locator('.side-chat-panel')
    await sidePanel.waitFor({ state: 'visible', timeout: 30000 })
    await sidePanel.getByRole('button', { name: 'Start side chat dictation' }).click({ timeout: 30000 })
    await sidePanel.getByRole('button', { name: 'Stop and send dictation' }).click({ timeout: 30000 })

    let sideThreadTurn = null
    for (let attempt = 0; attempt < 40; attempt += 1) {
      sideThreadTurn = evidence.rpc.find((row) =>
        row.stage === 'request' &&
        row.method === 'turn/start' &&
        row.params?.threadId &&
        row.params.threadId !== THREAD_ID)
      if (sideThreadTurn) break
      await page.waitForTimeout(500)
    }
    await page.waitForTimeout(1500)

    const mainAfter = await page.locator('.content-thread').innerText()
    const sideUserMessages = await sidePanel
      .locator('.side-chat-message.is-user .side-chat-message-text')
      .allInnerTexts()
      .catch(() => [])
    const sideUserText = sideUserMessages.join('\n')
    const sideText = await sidePanel.innerText()
    const mainPolluted = !mainBefore.includes(MARKER) && mainAfter.includes(MARKER)

    if (evidence.transcribeRequests < 1) {
      throw new Error('Side voice dictation did not call /codex-api/transcribe')
    }
    if (mainPolluted) {
      throw new Error('Side voice transcript appeared in the main transcript')
    }
    if (!sideThreadTurn) {
      throw new Error('No side-thread turn/start RPC was observed after voice dictation')
    }
    if (!sideThreadTurn.params.input?.some((item) =>
      item?.type === 'text' && typeof item.text === 'string' && item.text.includes(MARKER))) {
      throw new Error('Side voice transcript was not submitted in the side turn/start input')
    }
    if (evidence.fetchErrors.length > 0) {
      throw new Error('Codex API returned errors during side voice dictation')
    }

    const startedAt = Date.now()
    let assistantText = ''
    let workedSummaryText = ''
    while (Date.now() - startedAt < TIMEOUT_MS) {
      await page.waitForTimeout(2000)
      const assistantMessages = await sidePanel
        .locator('.side-chat-message.is-assistant .side-chat-message-text')
        .allInnerTexts()
        .catch(() => [])
      assistantText = assistantMessages.map((text) => text.trim()).filter(Boolean).join('\n\n')
      const workedSummaries = await sidePanel
        .locator('.side-chat-message.is-system .side-chat-message-text')
        .allInnerTexts()
        .catch(() => [])
      workedSummaryText = workedSummaries.find((text) => text.trim().startsWith('Worked for'))?.trim() || ''
      if (assistantText.length > 0 && workedSummaryText.length > 0) break
    }

    if (!assistantText || !workedSummaryText) {
      throw new Error(!assistantText
        ? `No assistant side-chat answer after ${TIMEOUT_MS}ms`
        : `Side-chat voice answer did not reach completed state after ${TIMEOUT_MS}ms`)
    }

    evidence.final = {
      ok: true,
      sideUserText,
      answer: assistantText,
      workedSummary: workedSummaryText,
      sideText: truncate(await sidePanel.innerText(), 2000),
      transcriptSubmitted: sideThreadTurn.params.input?.some((item) =>
        item?.type === 'text' && typeof item.text === 'string' && item.text.includes(MARKER)),
      sideThreadId: sideThreadTurn.params.threadId,
      screenshotPath: SCREENSHOT_PATH,
    }
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true })
  } finally {
    evidence.finishedAt = new Date().toISOString()
    fs.writeFileSync(LOG_PATH, JSON.stringify(evidence, null, 2))
    await browser.close()
  }

  console.log(JSON.stringify(evidence.final, null, 2))
  console.log(`log: ${LOG_PATH}`)
}

main().catch((error) => {
  console.error(error.message)
  console.error(`log: ${LOG_PATH}`)
  process.exitCode = 1
})
