import { afterEach, describe, expect, it } from 'vitest'
import { buildAppServerArgs } from './appServerRuntimeConfig'

describe('app-server runtime config', () => {
  afterEach(() => {
    delete process.env.CODEXUI_MEMORIES
  })

  it('enables Codex memories by default for spawned app-server processes', () => {
    const args = buildAppServerArgs()
    const featureIndex = args.indexOf('features.memories=true')

    expect(featureIndex).toBeGreaterThan(0)
    expect(args[featureIndex - 1]).toBe('-c')
  })

  it('can disable Codex memories through runtime configuration', () => {
    process.env.CODEXUI_MEMORIES = 'false'

    const args = buildAppServerArgs()
    const featureIndex = args.indexOf('features.memories=false')

    expect(featureIndex).toBeGreaterThan(0)
    expect(args[featureIndex - 1]).toBe('-c')
    expect(args).not.toContain('features.memories=true')
  })

  it('preserves stdio app-server startup support', () => {
    const args = buildAppServerArgs({ stdio: true })

    expect(args.slice(0, 2)).toEqual(['app-server', '--stdio'])
    expect(args).toContain('features.memories=true')
  })
})
