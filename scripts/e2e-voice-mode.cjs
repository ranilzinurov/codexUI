const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:4173'
const THREAD_ID = process.env.E2E_VOICE_THREAD_ID || 'voice-mode-e2e-thread'
const START_URL = process.env.E2E_VOICE_URL || `${BASE_URL}/#/thread/${THREAD_ID}`
const OUT_DIR = path.resolve(process.cwd(), 'output/playwright')
const lightScreenshot = path.join(OUT_DIR, 'voice-mode-menu-light.png')
const darkScreenshot = path.join(OUT_DIR, 'voice-mode-menu-dark.png')
const diagnosticsPath = path.join(OUT_DIR, 'voice-mode-menu-diagnostics.json')

function writeDiagnostics(payload) {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(diagnosticsPath, JSON.stringify(payload, null, 2))
}

function createSilentWav() {
  const sampleRate = 8000
  const samples = 800
  const dataSize = samples * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  return buffer
}

function createThreadPayload() {
  const now = Math.floor(Date.now() / 1000)
  return {
    thread: {
      id: THREAD_ID,
      preview: 'Voice mode e2e',
      modelProvider: 'openai',
      createdAt: now - 60,
      updatedAt: now,
      path: null,
      cwd: process.cwd(),
      cliVersion: 'e2e',
      source: 'codex-ui-e2e',
      gitInfo: null,
      turns: [{
        id: 'voice-mode-e2e-turn',
        status: 'completed',
        error: null,
        items: [
          {
            id: 'voice-mode-e2e-user',
            type: 'userMessage',
            content: [{ type: 'text', text: 'Please explain the voice mode change.' }],
          },
          {
            id: 'voice-mode-e2e-assistant',
            type: 'agentMessage',
            text: [
              'Voice mode now lives in the thread feature menu.',
              'It keeps the full written answer in the thread, but sends the assistant text to the voice endpoint for a short spoken version.',
              'Code blocks and diffs should be summarized instead of read out loud.',
            ].join(' '),
          },
        ],
      }],
    },
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addInitScript(() => {
    window.localStorage.removeItem('codex-web-local.voice-mode-enabled.v1')
    window.localStorage.removeItem('codex-web-local.voice-speed.v1')
    const originalPlay = window.HTMLMediaElement.prototype.play
    window.__codexVoicePlayCalls = 0
    window.__codexVoiceSilentPlayCalls = 0
    window.HTMLMediaElement.prototype.play = function patchedPlay() {
      window.__codexVoicePlayCalls += 1
      const source = this.currentSrc || this.src || ''
      if (typeof source === 'string' && source.startsWith('data:audio/wav;base64,')) {
        window.__codexVoiceSilentPlayCalls += 1
      }
      return Promise.resolve()
    }
    window.__codexOriginalMediaPlay = originalPlay
  })

  const page = await context.newPage()
  const diagnostics = {
    console: [],
    pageErrors: [],
    voiceRequests: [],
  }
  page.on('console', (message) => {
    diagnostics.console.push({ type: message.type(), text: message.text() })
  })
  page.on('pageerror', (error) => {
    diagnostics.pageErrors.push(String(error?.stack || error?.message || error))
  })

  await page.route('**/codex-api/voice/speech', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}')
    const silentPlayCallsBeforeRequest = await page.evaluate(() => window.__codexVoiceSilentPlayCalls || 0)
    diagnostics.voiceRequests.push({ ...body, silentPlayCallsBeforeRequest })
    await route.fulfill({
      status: 200,
      contentType: 'audio/wav',
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Codex-Voice': 'nova',
        'X-Codex-Voice-Speed': String(body.speed ?? ''),
        'X-Codex-Voice-Summary-Source': 'app-server',
      },
      body: createSilentWav(),
    })
  })

  await page.route('**/codex-api/rpc', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}')
    if (body.method === 'thread/list') {
      const payload = createThreadPayload()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          result: {
            data: [{
              ...payload.thread,
              turns: [],
            }],
            nextCursor: null,
          },
        }),
      })
      return
    }
    if (body.method === 'thread/read' || body.method === 'thread/resume') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ result: createThreadPayload() }),
      })
      return
    }
    if (body.method === 'config/read') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ result: { model: 'gpt-5.5', providerId: 'openai', reasoningEffort: 'medium', speedMode: 'standard' } }),
      })
      return
    }
    if (body.method === 'model/list') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ result: { data: ['gpt-5.5'] } }),
      })
      return
    }
    if (body.method === 'skills/list' || body.method === 'plugin/list' || body.method === 'account/rateLimits/read') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ result: body.method === 'account/rateLimits/read' ? null : { data: [] } }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ result: {} }),
    })
  })

  await page.route('**/codex-api/thread-live-state**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        threadId: THREAD_ID,
        conversationState: { turns: createThreadPayload().thread.turns },
        ownerClientId: null,
        liveStateError: null,
        isInProgress: false,
      }),
    })
  })

  await page.goto(START_URL, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})

  const assistantCard = page.locator('[data-role="assistant"] .message-card').last()
  await assistantCard.waitFor({ state: 'visible', timeout: 30_000 })
  const assistantText = (await assistantCard.innerText()).trim()
  if (!assistantText) throw new Error('Expected a completed assistant response with text for voice playback')

  const oldFloatingControls = await page.locator('.voice-mode-strip, .message-voice-button, .voice-resume-backdrop').count()
  if (oldFloatingControls !== 0) {
    throw new Error(`Old visible voice controls are still rendered: ${oldFloatingControls}`)
  }

  const featureButton = page.getByRole('button', { name: 'Thread features' })
  await featureButton.click()
  const menu = page.getByRole('menu', { name: 'Thread features' })
  await menu.waitFor({ state: 'visible', timeout: 10_000 })

  await menu.getByRole('menuitem', { name: /^Play$/i }).waitFor({ state: 'visible' })
  await menu.getByRole('menuitem', { name: /^Mode$/i }).waitFor({ state: 'visible' })
  await menu.getByRole('menuitem', { name: /^Stop$/i }).waitFor({ state: 'visible' })
  await menu.getByText(/Play voice|Voice mode|Stop voice/i).count().then((count) => {
    if (count > 0) throw new Error('Voice menu labels should be compact and omit the word voice')
  })
  const speedSlider = menu.locator('.content-header-feature-menu-speed-slider')
  await speedSlider.waitFor({ state: 'visible' })
  const initialSpeed = await speedSlider.inputValue()
  if (initialSpeed !== '1') throw new Error(`Expected default speed 1, got ${initialSpeed}`)

  const [voiceResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes('/codex-api/voice/speech'), { timeout: 20_000 }),
    menu.getByRole('menuitem', { name: /^Play$/i }).click(),
  ])
  if (voiceResponse.status() !== 200) throw new Error(`Voice endpoint returned ${voiceResponse.status()}`)
  await page.waitForFunction(() => window.__codexVoicePlayCalls > 0, null, { timeout: 10_000 })

  const firstVoiceRequest = diagnostics.voiceRequests[0]
  if (!firstVoiceRequest) throw new Error('Voice endpoint was not called')
  if (firstVoiceRequest.speed !== 1) throw new Error(`Expected voice speed 1, got ${firstVoiceRequest.speed}`)
  if (firstVoiceRequest.voice !== 'nova') throw new Error(`Expected nova voice, got ${firstVoiceRequest.voice}`)
  if (firstVoiceRequest.silentPlayCallsBeforeRequest < 1) {
    throw new Error('Expected explicit Play to prime audio before the async TTS request')
  }
  if (!String(firstVoiceRequest.text || '').includes(assistantText.slice(0, Math.min(40, assistantText.length)))) {
    throw new Error('Voice request did not include the assistant response text')
  }

  await speedSlider.evaluate((input) => {
    input.value = '1.24'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.waitForTimeout(250)
  const snappedSpeed = await speedSlider.inputValue()
  if (snappedSpeed !== '1.25') throw new Error(`Expected speed slider to snap to 1.25, got ${snappedSpeed}`)

  const modeButton = menu.getByRole('menuitem', { name: /^Mode$/i })
  const voiceRequestsBeforeMode = diagnostics.voiceRequests.length
  await modeButton.click()
  await page.waitForTimeout(300)
  const voiceModePressed = await modeButton.getAttribute('aria-pressed')
  if (voiceModePressed !== 'true') throw new Error('Voice mode did not toggle on')
  const voiceRequestsAfterMode = diagnostics.voiceRequests.length
  if (voiceRequestsAfterMode !== voiceRequestsBeforeMode) {
    throw new Error('Mode should prime autoplay without requesting TTS for the current response')
  }
  const silentPlayCallsAfterMode = await page.evaluate(() => window.__codexVoiceSilentPlayCalls || 0)
  if (silentPlayCallsAfterMode < 2) {
    throw new Error('Expected Mode to start a silent autoplay session')
  }

  await page.screenshot({ path: lightScreenshot, fullPage: false })
  await page.evaluate(() => {
    document.documentElement.classList.add('dark')
    document.body.classList.add('dark')
  })
  await page.waitForTimeout(300)
  await page.screenshot({ path: darkScreenshot, fullPage: false })

  writeDiagnostics({
    ok: true,
    baseUrl: BASE_URL,
    startUrl: START_URL,
    assistantTextChars: assistantText.length,
    voiceRequests: diagnostics.voiceRequests,
    silentPlayCallsAfterMode,
    console: diagnostics.console.filter((row) => row.type === 'error' || row.type === 'warning'),
    pageErrors: diagnostics.pageErrors,
    screenshots: {
      light: lightScreenshot,
      dark: darkScreenshot,
    },
  })

  console.log(JSON.stringify({
    ok: true,
    baseUrl: BASE_URL,
    startUrl: START_URL,
    viewport: '1440x1000',
    assistantTextChars: assistantText.length,
    voiceRequestCount: diagnostics.voiceRequests.length,
    silentPlayCallsAfterMode,
    defaultSpeed: initialSpeed,
    snappedSpeed,
    screenshots: {
      light: lightScreenshot,
      dark: darkScreenshot,
    },
  }, null, 2))

  await browser.close()
}

main().catch((error) => {
  writeDiagnostics({
    ok: false,
    baseUrl: BASE_URL,
    startUrl: START_URL,
    error: String(error?.stack || error?.message || error),
  })
  console.error(error)
  process.exit(1)
})
