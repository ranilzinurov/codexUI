import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('thread feature menu browser annotation action', () => {
  it('does not render the obsolete listen action in the thread feature menu', () => {
    const source = readFileSync(resolve(__dirname, 'App.vue'), 'utf8')

    expect(source).not.toContain('onToggleBrowserAnnotationFromFeatureMenu')
    expect(source).not.toContain('browserAnnotationFeatureMenuLabel')
    expect(source).not.toContain('browserAnnotationFeatureMenuStatus')
    expect(source).not.toContain("t('Stop Listen')")
    expect(source).not.toContain("t('Listen')")
  })
})
