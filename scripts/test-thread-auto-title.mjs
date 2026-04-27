#!/usr/bin/env node
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
    cleanup: () => rm(tempDir, { force: true, recursive: true }),
  }
}

async function run() {
  const { generateThreadTitleFromConversation, cleanup } = await loadTitleGenerator()
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

    console.log('Thread auto-title tests OK')
  } finally {
    await cleanup()
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
