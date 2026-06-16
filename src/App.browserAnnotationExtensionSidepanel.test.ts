import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const extensionRoot = resolve(__dirname, '../extension/browser-annotation')

describe('browser annotation extension sidepanel thread selector', () => {
  it('renders project/thread selector controls and wires selection before sending', () => {
    const html = readFileSync(resolve(extensionRoot, 'sidepanel/sidepanel.html'), 'utf8')
    const js = readFileSync(resolve(extensionRoot, 'sidepanel/sidepanel.js'), 'utf8')
    const css = readFileSync(resolve(extensionRoot, 'sidepanel/sidepanel.css'), 'utf8')

    expect(html).toContain('id="targetProject"')
    expect(html).toContain('id="targetThread"')
    expect(html).toContain('id="refreshThreadTargets"')
    expect(html).toContain('Destination')

    expect(js).toContain('renderThreadTargets')
    expect(js).toContain('MESSAGE_TYPES.SELECT_THREAD_TARGET')
    expect(js).toContain('hasSelectedThreadTarget')
    expect(js).toContain('Choose a destination thread')

    expect(css).toContain('.target-grid')
    expect(css).toContain('.target-select')
  })
})
