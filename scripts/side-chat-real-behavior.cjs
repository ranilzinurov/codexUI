const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:4174'
const THREAD_ID = process.env.THREAD_ID || '019e72fd-945e-7030-9b4a-830e39a6443c'
const THREAD_TITLE = process.env.THREAD_TITLE || 'Привязка платежа Точка банка'
const TIMEOUT_MS = Number(process.env.SIDE_CHAT_TIMEOUT_MS || 180000)
const DARK_MODE = process.env.SIDE_CHAT_DARK === '1'
const MARKER = `SIDE_E2E_${Date.now()}`
const QUESTION = process.env.SIDE_CHAT_QUESTION || `${MARKER}: Ответь на русском в 1-2 предложениях: судя по основному чату, что нужно сделать? Если в основном чате есть Точка-банк или платеж, упомяни это явно. Не используй инструменты.`
const OUT_DIR = path.resolve(process.cwd(), 'output/playwright')
const SCREENSHOT_PATH = path.join(OUT_DIR, 'side-chat-real-behavior-failure.png')
const PASS_SCREENSHOT_PATH = path.join(OUT_DIR, DARK_MODE
  ? 'side-chat-real-behavior-dark.png'
  : 'side-chat-real-behavior-pass.png')
const LOG_PATH = path.join(OUT_DIR, 'side-chat-real-behavior-log.json')

function truncate(value, length = 1200) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > length ? `${text.slice(0, length)}…` : text
}

function parseJson(value) {
  if (!value) return null
  if (typeof value === 'object') return value
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
    threadTitle: THREAD_TITLE,
    marker: MARKER,
    question: QUESTION,
    darkMode: DARK_MODE,
    startedAt: new Date().toISOString(),
    rpc: [],
    fetchErrors: [],
    console: [],
    websocket: [],
    sideSnapshots: [],
    final: null,
  }

  let sentSideThreadId = ''
  let turnCompletedOk = false
  let turnCompletedStatus = ''
  let turnCompletedError = null
  let sawPostSendError = false
  let sawPostSendSystemError = false

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  if (DARK_MODE) {
    await page.addInitScript(() => {
      window.localStorage.setItem('codex-web-local.dark-mode.v1', 'dark')
    })
  }

  page.on('console', (message) => {
    evidence.console.push({
      type: message.type(),
      text: truncate(message.text(), 800),
    })
  })

  page.on('request', (request) => {
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
        at: new Date().toISOString(),
      })
    }
    if (!url.includes('/codex-api/rpc')) return
    const body = parseJson(await response.text().catch(() => ''))
    evidence.rpc.push({
      stage: 'response',
      status: response.status(),
      result: body?.result || null,
      error: body?.error || null,
      at: new Date().toISOString(),
    })
  })

  page.on('websocket', (socket) => {
    evidence.websocket.push({ event: 'open', url: socket.url(), at: new Date().toISOString() })
    socket.on('framereceived', (frame) => {
      const payload = parseJson(frame.payload)
      const params = payload?.params ? parseJson(payload.params) : null
      evidence.websocket.push({
        event: 'received',
        method: payload?.method || null,
        params: payload?.params ? truncate(payload.params, 1000) : null,
        at: new Date().toISOString(),
      })
      if (!sentSideThreadId && payload?.method === 'thread/started' && params?.thread?.forkedFromId === THREAD_ID) {
        sentSideThreadId = params.thread.id || ''
      }
      if (sentSideThreadId && params?.threadId === sentSideThreadId) {
        if (payload?.method === 'error') {
          sawPostSendError = true
        }
        if (payload?.method === 'thread/status/changed' && params?.status?.type === 'systemError') {
          sawPostSendSystemError = true
        }
        if (payload?.method === 'turn/completed') {
          turnCompletedStatus = params?.turn?.status || ''
          turnCompletedError = params?.turn?.error || null
          turnCompletedOk = turnCompletedStatus === 'completed' && !turnCompletedError
        }
      }
    })
    socket.on('close', () => {
      evidence.websocket.push({ event: 'close', at: new Date().toISOString() })
    })
  })

  try {
    if (THREAD_ID) {
      await page.goto(`${BASE_URL}/#/thread/${THREAD_ID}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    } else {
      await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.getByText(THREAD_TITLE, { exact: true }).click({ timeout: 30000 })
      await page.waitForURL(/#\/thread\//, { timeout: 30000 })
    }
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})

    const featureButton = page.getByRole('button', { name: 'Thread features' })
    await featureButton.click({ timeout: 30000 })
    await page
      .getByRole('menu', { name: 'Thread features' })
      .getByRole('menuitem', { name: /Side/ })
      .click({ timeout: 30000 })
    const sidePanel = page.locator('.side-chat-panel')
    await sidePanel.waitFor({ state: 'visible', timeout: 30000 })

    await sidePanel.locator('textarea.side-chat-input').fill(QUESTION)
    await sidePanel.getByRole('button', { name: 'Send side chat message' }).click()

    const startedAt = Date.now()
    let assistantText = ''
    let lastSnapshot = ''
    let workedSummaryText = ''

    while (Date.now() - startedAt < TIMEOUT_MS) {
      await page.waitForTimeout(2000)
      const snapshot = await sidePanel.innerText().catch((error) => `snapshot-error: ${error.message}`)
      if (snapshot !== lastSnapshot) {
        evidence.sideSnapshots.push({
          elapsedMs: Date.now() - startedAt,
          text: truncate(snapshot, 2000),
        })
        lastSnapshot = snapshot
      }

      const assistantMessages = await sidePanel
        .locator('.side-chat-message.is-assistant .side-chat-message-text')
        .allInnerTexts()
        .catch(() => [])
      assistantText = assistantMessages.map((text) => text.trim()).filter(Boolean).join('\n\n')

      const workedSummaries = await sidePanel
        .locator('.side-chat-message.is-worked .side-chat-worked-text, .side-chat-message.is-system .side-chat-message-text')
        .allInnerTexts()
        .catch(() => [])
      workedSummaryText = workedSummaries.find((text) => text.trim().startsWith('Worked for'))?.trim() || ''
      if (assistantText.length > 0 && workedSummaryText.length > 0 && turnCompletedOk) break
    }

    if (!assistantText || !workedSummaryText || !turnCompletedOk || sawPostSendError || sawPostSendSystemError) {
      const finalText = await sidePanel.innerText().catch(() => '')
      evidence.final = {
        ok: false,
        reason: !assistantText
          ? `No assistant side-chat answer after ${TIMEOUT_MS}ms`
          : !workedSummaryText
            ? `Side-chat worked summary did not render after ${TIMEOUT_MS}ms`
            : !turnCompletedOk
              ? `Side-chat turn did not complete cleanly after ${TIMEOUT_MS}ms`
              : 'Side-chat websocket reported an error after send',
        answer: assistantText,
        workedSummary: workedSummaryText,
        sentSideThreadId,
        turnCompletedStatus,
        turnCompletedError,
        sawPostSendError,
        sawPostSendSystemError,
        sidePanelText: truncate(finalText, 3000),
        url: page.url(),
        screenshotPath: SCREENSHOT_PATH,
      }
      await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true })
      throw new Error(evidence.final.reason)
    }

    if (evidence.fetchErrors.length > 0) {
      evidence.final = {
        ok: false,
        reason: 'Codex API returned errors during side-chat behavior test',
        fetchErrors: evidence.fetchErrors,
        answer: assistantText,
        workedSummary: workedSummaryText,
        url: page.url(),
        screenshotPath: SCREENSHOT_PATH,
      }
      await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true })
      throw new Error(evidence.final.reason)
    }

    evidence.final = {
      ok: true,
      answer: assistantText,
      workedSummary: workedSummaryText,
      sentSideThreadId,
      turnCompletedStatus,
      url: page.url(),
      screenshotPath: PASS_SCREENSHOT_PATH,
    }
    await page.screenshot({ path: PASS_SCREENSHOT_PATH, fullPage: true })
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
