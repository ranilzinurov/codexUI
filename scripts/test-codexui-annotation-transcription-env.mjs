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
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function assert(condition, label) {
  if (!condition) throw new Error(label)
}

function snapshotEnv(keys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]))
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

async function loadAnnotationTranscriptionConfig() {
  const sourcePath = join(rootDir, 'src/server/annotationTranscriptionConfig.ts')
  const source = await readFile(sourcePath, 'utf8')
  const tempDir = await mkdtemp(join(tmpdir(), 'codexui-annotation-transcription-env-'))
  const tempModulePath = join(tempDir, 'annotationTranscriptionConfig.mjs')
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
    envKeys: module.ANNOTATION_TRANSCRIPTION_ENV_KEYS,
    defaultModel: module.DEFAULT_ANNOTATION_TRANSCRIBE_MODEL,
    resolveAnnotationTranscriptionConfig: module.resolveAnnotationTranscriptionConfig,
    getAnnotationTranscriptionEnvStatus: module.getAnnotationTranscriptionEnvStatus,
    cleanup: () => rm(tempDir, { force: true, recursive: true }),
  }
}

function formatStatus(envKeys, status) {
  return [
    `${envKeys.openAiApiKey}=${status.openAiApiKeyPresent ? 'present' : 'missing'}`,
    `${envKeys.model}=${status.modelConfigured ? status.model : 'unset'}`,
    `${envKeys.fallbackModel}=${status.fallbackModelConfigured ? status.fallbackModel : 'unset'}`,
  ].join('; ')
}

async function run() {
  const module = await loadAnnotationTranscriptionConfig()
  const keys = [
    module.envKeys.openAiApiKey,
    module.envKeys.model,
    module.envKeys.fallbackModel,
  ]
  const originalEnv = snapshotEnv(keys)
  const fakeKey = 'sk-test-annotation-env-key-must-not-print'

  try {
    assertEqual(module.envKeys.openAiApiKey, 'OPENAI_API_KEY', 'OpenAI key env name')
    assertEqual(module.envKeys.model, 'CODEXUI_ANNOTATION_TRANSCRIBE_MODEL', 'annotation transcription model env name')
    assertEqual(
      module.envKeys.fallbackModel,
      'CODEXUI_ANNOTATION_TRANSCRIBE_FALLBACK_MODEL',
      'annotation transcription fallback model env name',
    )

    for (const key of keys) delete process.env[key]
    let config = module.resolveAnnotationTranscriptionConfig()
    let status = module.getAnnotationTranscriptionEnvStatus(config)
    assertEqual(config.openAiApiKey, '', 'empty OpenAI key when unset')
    assertEqual(config.model, module.defaultModel, 'default annotation transcription model when unset')
    assertEqual(status.openAiApiKeyPresent, false, 'OpenAI key presence when unset')
    assertEqual(status.modelConfigured, true, 'default model configured status when unset')
    assertEqual(status.model, module.defaultModel, 'default model status when unset')
    assertEqual(status.fallbackModel, null, 'fallback model status when unset')

    process.env[module.envKeys.openAiApiKey] = `  ${fakeKey}  `
    process.env[module.envKeys.model] = ' annotation-primary-test-model '
    process.env[module.envKeys.fallbackModel] = ' annotation-fallback-test-model '
    config = module.resolveAnnotationTranscriptionConfig()
    status = module.getAnnotationTranscriptionEnvStatus(config)
    assertEqual(config.openAiApiKey, fakeKey, 'OpenAI key should be trimmed for server-side use')
    assertEqual(config.model, 'annotation-primary-test-model', 'annotation transcription model should be trimmed')
    assertEqual(config.fallbackModel, 'annotation-fallback-test-model', 'annotation transcription fallback model should be trimmed')
    assertEqual(status.openAiApiKeyPresent, true, 'OpenAI key presence when configured')
    assertEqual(status.modelConfigured, true, 'model configured status')
    assertEqual(status.fallbackModelConfigured, true, 'fallback model configured status')

    const safeOutput = formatStatus(module.envKeys, status)
    assert(!safeOutput.includes(fakeKey), 'smoke output must not include the OpenAI key value')

    restoreEnv(originalEnv)
    const actualStatus = module.getAnnotationTranscriptionEnvStatus()
    console.log(`Annotation transcription env OK: ${formatStatus(module.envKeys, actualStatus)}`)
  } finally {
    restoreEnv(originalEnv)
    await module.cleanup()
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
