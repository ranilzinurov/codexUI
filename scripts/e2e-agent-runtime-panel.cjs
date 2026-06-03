const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:4173'
const marker = `AGENT_PANEL_E2E_${Date.now()}`
const outputDir = path.resolve(process.cwd(), 'output/playwright')
const lightScreenshot = path.join(outputDir, 'agent-runtime-panel-light.png')
const darkScreenshot = path.join(outputDir, 'agent-runtime-panel-dark.png')
const failureScreenshot = path.join(outputDir, 'agent-runtime-panel-failure.png')
const diagnosticLog = path.join(outputDir, 'agent-runtime-panel-diagnostics.json')
let latestDiagnostics = null

function writeDiagnostics(payload) {
  fs.mkdirSync(outputDir, { recursive: true })
  fs.writeFileSync(diagnosticLog, JSON.stringify(payload, null, 2))
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addInitScript(() => {
    window.localStorage.setItem('codex-web-local.collaboration-mode-by-context.v1', JSON.stringify({}))
  })
  const page = await context.newPage()
  const diagnostics = {
    console: [],
    pageErrors: [],
    rpc: [],
    closed: false,
  }
  latestDiagnostics = diagnostics
  page.on('console', (message) => {
    diagnostics.console.push({ type: message.type(), text: message.text() })
  })
  page.on('pageerror', (error) => {
    diagnostics.pageErrors.push(String(error?.stack || error?.message || error))
  })
  page.on('close', () => {
    diagnostics.closed = true
  })
  page.on('requestfinished', async (request) => {
    if (!request.url().includes('/codex-api/rpc')) return
    const response = await request.response().catch(() => null)
    const body = request.postData() || ''
    let parsed = null
    try { parsed = JSON.parse(body) } catch {}
    diagnostics.rpc.push({
      method: parsed?.method || '',
      status: response?.status() || 0,
      params: parsed?.params || null,
    })
  })
  page.setDefaultTimeout(30_000)

  await page.goto(`${baseUrl}/#/`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})

  const startButtons = page.locator('button[aria-label*="start new thread" i]')
  const codexUiStart = page.locator('button[aria-label="start new thread codexUI" i]')
  const startButton = (await codexUiStart.count()) > 0 ? codexUiStart.first() : startButtons.first()
  await startButton.click()
  await page.waitForURL((url) => url.hash === '#/' || url.hash === '', { timeout: 30_000 }).catch(() => {})

  const composer = page.locator('textarea.thread-composer-input').first()
  await composer.waitFor({ state: 'visible', timeout: 45_000 })
  await page.locator('.thread-composer-attach-trigger').first().click()
  const planModeSwitch = page.locator('button[role="switch"][aria-label="Enable plan mode"]').first()
  if (await planModeSwitch.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await planModeSwitch.click()
  }
  await page.keyboard.press('Escape')
  await composer.click()
  await composer.fill([
    `${marker}.`,
    'This is an end-to-end UI regression check for the Codex UI sub-agent runtime panel.',
    'Please use the multi-agent/sub-agent capability and launch exactly two small explorer agents.',
    'Ask one agent to inspect src/components/content/ThreadComposer.vue for thread-composer-agent-row.',
    'Ask the second agent to run git status --short and report only a compact summary.',
    'Wait for both agents before writing the final answer.',
  ].join(' '))

  const submitButton = page.locator('.thread-composer-submit').first()
  await submitButton.waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForFunction(() => {
    const button = document.querySelector('.thread-composer-submit')
    return button instanceof HTMLButtonElement && !button.disabled
  }, null, { timeout: 30_000 })
  const [turnStartResponse] = await Promise.all([
    page.waitForResponse((response) => {
      const request = response.request()
      return response.url().includes('/codex-api/rpc')
        && request.method() === 'POST'
        && (request.postData() || '').includes('turn/start')
    }, { timeout: 60_000 }),
    submitButton.click(),
  ])
  const turnStartBody = JSON.parse(turnStartResponse.request().postData() || '{}')
  const targetThreadId = String(turnStartBody?.params?.threadId || '')
  if (targetThreadId) {
    await page.waitForURL((url) => url.hash.includes(`/thread/${targetThreadId}`), { timeout: 30_000 })
  }

  const agentRows = page.locator('.thread-composer-agent-row')
  try {
    await agentRows.first().waitFor({ state: 'visible', timeout: 240_000 })
  } catch (error) {
    await page.screenshot({ path: failureScreenshot, fullPage: true }).catch(() => {})
    throw error
  }
  const rowCount = await agentRows.count()
  if (rowCount < 1) {
    throw new Error('Expected at least one visible sub-agent runtime row')
  }

  const firstRow = agentRows.first()
  const firstRowText = (await firstRow.innerText()).trim()
  await firstRow.click()

  const detail = page.locator('.thread-composer-agent-detail').first()
  await detail.waitFor({ state: 'visible', timeout: 30_000 })
  const detailText = (await detail.innerText()).trim()
  if (!/Status/i.test(detailText) || !/Latest/i.test(detailText) || !/Reasoning/i.test(detailText)) {
    throw new Error(`Agent detail drawer did not expose expected sections: ${detailText}`)
  }

  await page.screenshot({ path: lightScreenshot, fullPage: true })
  await page.evaluate(() => {
    document.documentElement.classList.add('dark')
    document.body.classList.add('dark')
  })
  await page.waitForTimeout(500)
  await page.screenshot({ path: darkScreenshot, fullPage: true })

  const darkDetailStyles = await detail.evaluate((element) => {
    const styles = window.getComputedStyle(element)
    return {
      backgroundColor: styles.backgroundColor,
      color: styles.color,
      borderColor: styles.borderColor,
    }
  })

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    marker,
    viewport: '1440x1000',
    rowCount,
    firstRowText,
    detailText,
    darkDetailStyles,
    screenshots: {
      light: lightScreenshot,
      dark: darkScreenshot,
    },
  }, null, 2))
  writeDiagnostics({ ok: true, baseUrl, marker, ...diagnostics })

  await browser.close()
}

main().catch(async (error) => {
  console.error(error)
  try {
    fs.writeFileSync(diagnosticLog, JSON.stringify({
      ok: false,
      baseUrl,
      error: String(error?.stack || error?.message || error),
      diagnostics: latestDiagnostics,
    }, null, 2))
  } catch {}
  process.exit(1)
})
