#!/usr/bin/env node
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected "${expected}", got "${actual}"`)
  }
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

async function loadTitleGenerator() {
  const sourcePath = join(rootDir, 'src/server/threadAutoTitle.ts')
  const source = await readFile(sourcePath, 'utf8')
  const tempDir = await mkdtemp(join(tmpdir(), 'codexui-thread-title-'))
  const tempModulePath = join(tempDir, 'threadAutoTitle.mjs')
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
    generateThreadTitleFromConversation: module.generateThreadTitleFromConversation,
    generateThreadTitleFromConversationWithModel: module.generateThreadTitleFromConversationWithModel,
    ThreadAutoTitleManager: module.ThreadAutoTitleManager,
    cleanup: () => rm(tempDir, { force: true, recursive: true }),
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Could not bind test server'))
        return
      }
      resolve(address.port)
    })
  })
}

async function runModelTitleTest(generateThreadTitleFromConversationWithModel) {
  const requests = []
  const server = createServer(async (req, res) => {
    try {
      requests.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        body: await readJsonBody(req),
      })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ output_text: '"Задача в трекер для Бубуки."' }))
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    }
  })

  const previousEnv = {
    CODEXUI_THREAD_TITLE_API_KEY: process.env.CODEXUI_THREAD_TITLE_API_KEY,
    CODEXUI_THREAD_TITLE_BASE_URL: process.env.CODEXUI_THREAD_TITLE_BASE_URL,
    CODEXUI_THREAD_TITLE_LLM: process.env.CODEXUI_THREAD_TITLE_LLM,
    CODEXUI_THREAD_TITLE_MODEL: process.env.CODEXUI_THREAD_TITLE_MODEL,
    CODEXUI_THREAD_TITLE_REASONING_EFFORT: process.env.CODEXUI_THREAD_TITLE_REASONING_EFFORT,
    CODEXUI_THREAD_TITLE_TIMEOUT_MS: process.env.CODEXUI_THREAD_TITLE_TIMEOUT_MS,
  }

  try {
    const port = await listen(server)
    process.env.CODEXUI_THREAD_TITLE_API_KEY = 'title-test-key'
    process.env.CODEXUI_THREAD_TITLE_BASE_URL = `http://127.0.0.1:${String(port)}/v1`
    process.env.CODEXUI_THREAD_TITLE_LLM = 'on'
    process.env.CODEXUI_THREAD_TITLE_MODEL = 'gpt-5.5'
    process.env.CODEXUI_THREAD_TITLE_REASONING_EFFORT = 'low'
    process.env.CODEXUI_THREAD_TITLE_TIMEOUT_MS = '3000'

    const title = await generateThreadTitleFromConversationWithModel(
      'поставь задачу в трекере дождаться от Бубуки 3002 руб',
      'Готово, задача создана.',
    )
    assertEqual(title, 'Задача в трекер для Бубуки', 'Model title response should be sanitized')

    const request = requests[0]
    if (!request) throw new Error('Expected one title model request')
    assertEqual(request.method, 'POST', 'Model title request method')
    assertEqual(request.url, '/v1/responses', 'Model title request path')
    assertEqual(request.authorization, 'Bearer title-test-key', 'Model title request auth')
    assertEqual(request.body.model, 'gpt-5.5', 'Model title request model')
    assertEqual(request.body.reasoning?.effort, 'low', 'Model title request reasoning effort')
    assertEqual(request.body.max_output_tokens, 80, 'Model title max output tokens')
    assertEqual(request.body.store, false, 'Model title request should not store responses')
    if (!String(request.body.instructions).includes('Use 3 to 7 words')) {
      throw new Error('Expected compact title instruction')
    }
  } finally {
    restoreEnv(previousEnv)
    await new Promise((resolve) => server.close(resolve))
  }
}

async function runModelTitleDisabledTest(generateThreadTitleFromConversationWithModel) {
  const previousEnv = {
    CODEXUI_THREAD_TITLE_API_KEY: process.env.CODEXUI_THREAD_TITLE_API_KEY,
    CODEXUI_THREAD_TITLE_LLM: process.env.CODEXUI_THREAD_TITLE_LLM,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  }

  try {
    delete process.env.CODEXUI_THREAD_TITLE_API_KEY
    delete process.env.OPENAI_API_KEY
    process.env.CODEXUI_THREAD_TITLE_LLM = 'on'
    assertEqual(
      await generateThreadTitleFromConversationWithModel('Create a tracker task', 'Done.'),
      '',
      'Model title generation should no-op without an API key',
    )

    process.env.CODEXUI_THREAD_TITLE_API_KEY = 'unused-key'
    process.env.CODEXUI_THREAD_TITLE_LLM = 'off'
    assertEqual(
      await generateThreadTitleFromConversationWithModel('Create a tracker task', 'Done.'),
      '',
      'Model title generation should respect the off switch',
    )
  } finally {
    restoreEnv(previousEnv)
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runAttachmentNoiseManagerTest(ThreadAutoTitleManager) {
  const previousEnv = {
    CODEXUI_THREAD_TITLE_LLM: process.env.CODEXUI_THREAD_TITLE_LLM,
    CODEXUI_THREAD_TITLE_API_KEY: process.env.CODEXUI_THREAD_TITLE_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  }
  const calls = []
  const appServer = {
    async rpc(method, params) {
      calls.push({ method, params })
      if (method === 'thread/read') {
        return {
          thread: {
            turns: [
              {
                items: [
                  {
                    type: 'userMessage',
                    content: '# Files mentioned by the user:\n- /home/rnl1/prog/codexUI/src/server/threadAutoTitle.ts',
                  },
                  {
                    type: 'agentMessage',
                    text: 'I can inspect the file and explain how automatic thread title generation works.',
                  },
                ],
              },
            ],
          },
        }
      }
      return {}
    },
  }

  try {
    process.env.CODEXUI_THREAD_TITLE_LLM = 'off'
    delete process.env.CODEXUI_THREAD_TITLE_API_KEY
    delete process.env.OPENAI_API_KEY
    const manager = new ThreadAutoTitleManager(appServer)
    manager.handleNotification({ method: 'turn/completed', params: { threadId: 'attachment-only-thread' } })
    await wait(1300)
    manager.dispose()

    const renameCall = calls.find((call) => call.method === 'thread/name/set')
    if (renameCall) {
      throw new Error(`Attachment-only first turn should not be auto-named, got ${JSON.stringify(renameCall.params)}`)
    }
  } finally {
    restoreEnv(previousEnv)
  }
}

async function run() {
  const {
    generateThreadTitleFromConversation,
    generateThreadTitleFromConversationWithModel,
    ThreadAutoTitleManager,
    cleanup,
  } = await loadTitleGenerator()
  try {
    assertEqual(
      generateThreadTitleFromConversation(
        'поставь мне (Ранил З.) задачу в рабочих задачах в трекере "Дождаться от Бубуки 3002 руб" на завтра',
        'Готово, поставил задачу в трекере на завтра.',
      ),
      'Задача в трекер для Бубуки',
      'Russian tracker task title should summarize the thread and keep the counterparty',
    )

    assertEqual(
      generateThreadTitleFromConversation(
        'Create a task in the work tracker to follow up with Bubuka tomorrow',
        'Done, I created the tracker task.',
      ),
      'Tracker task for Bubuka',
      'English tracker task title should summarize the thread and keep the counterparty',
    )

    const russianTitle = generateThreadTitleFromConversation(
      'сделай проверку ошибок запуска\nERROR Failed to load runtime config',
      'I added a startup error check.',
    )
    if (!/[А-Яа-яЁё]/u.test(russianTitle)) {
      throw new Error(`Russian-leading prompt should keep a Russian title, got "${russianTitle}"`)
    }

    const attachmentTitle = generateThreadTitleFromConversation(
      'Разберись, почему автоназвания тредов плохие и предложи улучшение.\n\n# Files mentioned by the user:\n- /home/rnl1/prog/codexUI/src/server/threadAutoTitle.ts',
      'Нашёл, что функция берёт только первый userMessage и первый agentMessage, поэтому часто выбирает шум вместо сути.',
    )
    if (/files mentioned/iu.test(attachmentTitle) || /threadAutoTitle/iu.test(attachmentTitle)) {
      throw new Error(`Attachment metadata should not leak into title, got "${attachmentTitle}"`)
    }

    await runAttachmentNoiseManagerTest(ThreadAutoTitleManager)
    await runModelTitleTest(generateThreadTitleFromConversationWithModel)
    await runModelTitleDisabledTest(generateThreadTitleFromConversationWithModel)

    console.log('Thread auto-title tests OK')
  } finally {
    await cleanup()
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
