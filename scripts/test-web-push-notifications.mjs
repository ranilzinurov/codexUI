#!/usr/bin/env node
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')
const require = createRequire(import.meta.url)

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected "${expected}", got "${actual}"`)
  }
}

function base64Url(bytes) {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

async function loadWebPushNotifications() {
  const sourcePath = join(rootDir, 'src/server/webPushNotifications.ts')
  const source = await readFile(sourcePath, 'utf8')
  const tempDir = await mkdtemp(join(rootDir, '.tmp-test-web-push-'))
  const tempModulePath = join(tempDir, 'webPushNotifications.mjs')
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ES2022,
    },
    fileName: sourcePath,
  })

  await writeFile(tempModulePath, result.outputText, 'utf8')
  const module = await import(pathToFileURL(tempModulePath).href)
  return {
    WebPushNotifications: module.WebPushNotifications,
    cleanup: () => rm(tempDir, { force: true, recursive: true }),
  }
}

async function run() {
  const webPush = require('web-push')
  const originalGenerateVapidKeys = webPush.generateVAPIDKeys
  const originalSendNotification = webPush.sendNotification
  const originalCodexHome = process.env.CODEX_HOME
  const codexHome = await mkdtemp(join(tmpdir(), 'codexui-web-push-'))
  const deliveries = []

  webPush.generateVAPIDKeys = () => ({
    publicKey: base64Url(Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 1)])),
    privateKey: base64Url(Buffer.alloc(32, 2)),
  })
  webPush.sendNotification = async (subscription, payload, options) => {
    deliveries.push({
      subscription,
      payload: JSON.parse(payload),
      options,
    })
    return { statusCode: 201, body: '' }
  }
  process.env.CODEX_HOME = codexHome

  let cleanupModule = async () => {}
  try {
    const loaded = await loadWebPushNotifications()
    cleanupModule = loaded.cleanup
    const calls = []
    const notifications = new loaded.WebPushNotifications({
      rpc: async (method, params) => {
        calls.push({ method, params })
        return {
          thread: {
            id: '019df6c6-title-from-read',
            name: '',
            title: '',
            preview: 'Repository structure cleanup',
          },
        }
      },
    })

    const subscription = {
      endpoint: 'https://push.example.test/subscription/1',
      expirationTime: null,
      keys: {
        p256dh: base64Url(Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 3)])),
        auth: base64Url(Buffer.alloc(16, 4)),
      },
    }

    await notifications.subscribe({
      subscription,
      deviceId: 'test-device',
      userAgent: 'test',
      locale: 'en',
    })

    await notifications.handleNotification({
      method: 'turn/completed',
      params: {
        threadId: '019df6c6-title-from-read',
        turn: { id: 'turn-1', status: 'completed' },
      },
    })

    assertEqual(calls.length, 1, 'thread/read call count')
    assertEqual(calls[0].method, 'thread/read', 'thread/read method')
    assertEqual(calls[0].params.includeTurns, false, 'thread/read includeTurns')
    assertEqual(deliveries[0].payload.body, 'Repository structure cleanup is ready.', 'fallback title notification body')

    await notifications.handleNotification({
      method: 'thread/name/updated',
      params: { threadId: 'cached-title-thread', threadName: 'Cached human title' },
    })
    await notifications.handleNotification({
      method: 'turn/completed',
      params: {
        threadId: 'cached-title-thread',
        turn: { id: 'turn-2', status: 'completed' },
      },
    })

    assertEqual(calls.length, 1, 'cached title avoids thread/read')
    assertEqual(deliveries[1].payload.body, 'Cached human title is ready.', 'cached title notification body')

    notifications.dispose()
    console.log('Web push notification title tests OK')
  } finally {
    webPush.generateVAPIDKeys = originalGenerateVapidKeys
    webPush.sendNotification = originalSendNotification
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = originalCodexHome
    await cleanupModule()
    await rm(codexHome, { force: true, recursive: true })
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
