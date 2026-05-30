// Server-only helper: this module reads process.env secrets and must not be imported by client code.
export const ANNOTATION_TRANSCRIPTION_ENV_KEYS = {
  openAiApiKey: 'OPENAI_API_KEY',
  model: 'CODEXUI_ANNOTATION_TRANSCRIBE_MODEL',
  fallbackModel: 'CODEXUI_ANNOTATION_TRANSCRIBE_FALLBACK_MODEL',
} as const

export const DEFAULT_ANNOTATION_TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe'

export type AnnotationTranscriptionConfig = {
  openAiApiKey: string
  model: string
  fallbackModel: string
}

export type AnnotationTranscriptionEnvStatus = {
  openAiApiKeyPresent: boolean
  modelConfigured: boolean
  fallbackModelConfigured: boolean
  model: string | null
  fallbackModel: string | null
}

function normalizeEnvValue(value: string | undefined): string {
  return value?.trim() ?? ''
}

export function resolveAnnotationTranscriptionConfig(): AnnotationTranscriptionConfig {
  return {
    openAiApiKey: normalizeEnvValue(process.env[ANNOTATION_TRANSCRIPTION_ENV_KEYS.openAiApiKey]),
    model: normalizeEnvValue(process.env[ANNOTATION_TRANSCRIPTION_ENV_KEYS.model]) || DEFAULT_ANNOTATION_TRANSCRIBE_MODEL,
    fallbackModel: normalizeEnvValue(process.env[ANNOTATION_TRANSCRIPTION_ENV_KEYS.fallbackModel]),
  }
}

export function getAnnotationTranscriptionEnvStatus(
  config: AnnotationTranscriptionConfig = resolveAnnotationTranscriptionConfig(),
): AnnotationTranscriptionEnvStatus {
  return {
    openAiApiKeyPresent: Boolean(config.openAiApiKey),
    modelConfigured: Boolean(config.model),
    fallbackModelConfigured: Boolean(config.fallbackModel),
    model: config.model || null,
    fallbackModel: config.fallbackModel || null,
  }
}
