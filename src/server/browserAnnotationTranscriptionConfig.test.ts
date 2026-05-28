import { describe, expect, it } from 'vitest'
import {
  BROWSER_ANNOTATION_TRANSCRIPTION_ENV,
  DEFAULT_BROWSER_ANNOTATION_TRANSCRIBE_FALLBACK_MODEL,
  DEFAULT_BROWSER_ANNOTATION_TRANSCRIBE_MODEL,
  resolveBrowserAnnotationTranscriptionConfig,
  summarizeBrowserAnnotationTranscriptionConfig,
} from './browserAnnotationTranscriptionConfig'

describe('browser annotation transcription config', () => {
  it('uses server-side annotation transcription env names and defaults', () => {
    const config = resolveBrowserAnnotationTranscriptionConfig({})

    expect(BROWSER_ANNOTATION_TRANSCRIPTION_ENV).toEqual({
      openAiApiKey: 'OPENAI_API_KEY',
      primaryModel: 'CODEXUI_ANNOTATION_TRANSCRIBE_MODEL',
      fallbackModel: 'CODEXUI_ANNOTATION_TRANSCRIBE_FALLBACK_MODEL',
    })
    expect(config).toEqual({
      openAiApiKey: null,
      primaryModel: 'gpt-audio-mini-2025-12-15',
      fallbackModel: 'whisper-1',
    })
    expect(DEFAULT_BROWSER_ANNOTATION_TRANSCRIBE_MODEL).toBe('gpt-audio-mini-2025-12-15')
    expect(DEFAULT_BROWSER_ANNOTATION_TRANSCRIBE_FALLBACK_MODEL).toBe('whisper-1')
  })

  it('trims configured values and keeps the API key out of public summaries', () => {
    const secret = 'sk-test-browser-annotation-secret'
    const config = resolveBrowserAnnotationTranscriptionConfig({
      OPENAI_API_KEY: ` ${secret} `,
      CODEXUI_ANNOTATION_TRANSCRIBE_MODEL: ' primary-model ',
      CODEXUI_ANNOTATION_TRANSCRIBE_FALLBACK_MODEL: ' fallback-model ',
    })
    const summary = summarizeBrowserAnnotationTranscriptionConfig(config)

    expect(config).toEqual({
      openAiApiKey: secret,
      primaryModel: 'primary-model',
      fallbackModel: 'fallback-model',
    })
    expect(summary).toEqual({
      openAiApiKeyPresent: true,
      primaryModel: 'primary-model',
      fallbackModel: 'fallback-model',
    })
    expect(JSON.stringify(summary)).not.toContain(secret)
  })
})
