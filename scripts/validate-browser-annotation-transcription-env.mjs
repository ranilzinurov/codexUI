#!/usr/bin/env node

const envNames = {
  openAiApiKey: 'OPENAI_API_KEY',
  primaryModel: 'CODEXUI_ANNOTATION_TRANSCRIBE_MODEL',
  fallbackModel: 'CODEXUI_ANNOTATION_TRANSCRIBE_FALLBACK_MODEL',
}

const defaults = {
  primaryModel: 'gpt-4o-mini-transcribe',
  fallbackModel: 'whisper-1',
}

function readEnvValue(key) {
  return process.env[key]?.trim() ?? ''
}

const openAiApiKey = readEnvValue(envNames.openAiApiKey)
const primaryModel = readEnvValue(envNames.primaryModel) || defaults.primaryModel
const fallbackModel = readEnvValue(envNames.fallbackModel) || defaults.fallbackModel

console.log(JSON.stringify({
  openAiApiKeyPresent: Boolean(openAiApiKey),
  primaryModel,
  fallbackModel,
}, null, 2))
