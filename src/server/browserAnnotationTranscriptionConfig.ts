export const BROWSER_ANNOTATION_TRANSCRIPTION_ENV = {
  openAiApiKey: 'OPENAI_API_KEY',
  primaryModel: 'CODEXUI_ANNOTATION_TRANSCRIBE_MODEL',
  fallbackModel: 'CODEXUI_ANNOTATION_TRANSCRIBE_FALLBACK_MODEL',
} as const

export const DEFAULT_BROWSER_ANNOTATION_TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe'
export const DEFAULT_BROWSER_ANNOTATION_TRANSCRIBE_FALLBACK_MODEL = 'whisper-1'

export type BrowserAnnotationTranscriptionConfig = {
  openAiApiKey: string | null
  primaryModel: string
  fallbackModel: string
}

export type BrowserAnnotationTranscriptionConfigSummary = {
  openAiApiKeyPresent: boolean
  primaryModel: string
  fallbackModel: string
}

type EnvSource = Record<string, string | undefined>

function readEnvValue(env: EnvSource, key: string): string {
  return env[key]?.trim() ?? ''
}

export function resolveBrowserAnnotationTranscriptionConfig(
  env: EnvSource = process.env,
): BrowserAnnotationTranscriptionConfig {
  const openAiApiKey = readEnvValue(env, BROWSER_ANNOTATION_TRANSCRIPTION_ENV.openAiApiKey)
  const primaryModel = readEnvValue(env, BROWSER_ANNOTATION_TRANSCRIPTION_ENV.primaryModel)
  const fallbackModel = readEnvValue(env, BROWSER_ANNOTATION_TRANSCRIPTION_ENV.fallbackModel)

  return {
    openAiApiKey: openAiApiKey || null,
    primaryModel: primaryModel || DEFAULT_BROWSER_ANNOTATION_TRANSCRIBE_MODEL,
    fallbackModel: fallbackModel || DEFAULT_BROWSER_ANNOTATION_TRANSCRIBE_FALLBACK_MODEL,
  }
}

export function summarizeBrowserAnnotationTranscriptionConfig(
  config: BrowserAnnotationTranscriptionConfig = resolveBrowserAnnotationTranscriptionConfig(),
): BrowserAnnotationTranscriptionConfigSummary {
  return {
    openAiApiKeyPresent: Boolean(config.openAiApiKey),
    primaryModel: config.primaryModel,
    fallbackModel: config.fallbackModel,
  }
}
