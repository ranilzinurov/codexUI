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
        if (params?.threadId === 'subagent-from-read') {
          return {
            thread: {
              id: 'subagent-from-read',
              name: '',
              title: '',
              preview: 'Subagent research task',
              source: { subAgent: { thread_spawn: { parent_thread_id: 'parent-thread', depth: 1 } } },
            },
          }
        }
        if (params?.threadId === 'cached-title-thread') {
          return {
            thread: {
              id: 'cached-title-thread',
              name: 'Cached human title',
              title: '',
              preview: 'Cached fallback preview',
              source: 'cli',
            },
          }
        }
        return {
          thread: {
            id: '019df6c6-title-from-read',
            name: '',
            title: '',
            preview: 'Repository structure cleanup',
            source: 'cli',
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
      method: 'turn/completed',
      params: {
        threadId: 'subagent-from-notification',
        thread: {
          id: 'subagent-from-notification',
          preview: 'Use Exa/web search to research current public prices',
          source: { subAgent: { thread_spawn: { parent_thread_id: 'parent-thread', depth: 1 } } },
        },
        turn: { id: 'turn-subagent-notification', status: 'completed' },
      },
    })

    assertEqual(deliveries.length, 1, 'subagent notification source suppresses delivery')

    await notifications.handleNotification({
      method: 'turn/completed',
      params: {
        threadId: 'subagent-from-read',
        turn: { id: 'turn-subagent-read', status: 'completed' },
      },
    })

    assertEqual(calls.length, 2, 'subagent source lookup call count')
    assertEqual(calls[1].params.threadId, 'subagent-from-read', 'subagent source lookup thread id')
    assertEqual(deliveries.length, 1, 'subagent thread/read source suppresses delivery')

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

    assertEqual(calls.length, 3, 'cached title still checks thread source')
    assertEqual(calls[2].params.threadId, 'cached-title-thread', 'cached title source lookup thread id')
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
