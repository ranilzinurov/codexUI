import { describe, expect, it } from 'vitest'
import {
  markComposerOptionRecent,
  normalizeRecentComposerValues,
  orderComposerOptionsByRecent,
} from './composerRecentOptions'

describe('composer recent options', () => {
  it('keeps the newest unique values first within the limit', () => {
    expect(normalizeRecentComposerValues(['b', 'a', 'b', '', ' c ', 'd'], 3)).toEqual(['b', 'a', 'c'])
    expect(markComposerOptionRecent(['a', 'b', 'c'], 'b', 3)).toEqual(['b', 'a', 'c'])
    expect(markComposerOptionRecent(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b'])
  })

  it('orders recent options above the original list without disturbing other rows', () => {
    const options = [
      { value: 'skill:a', label: 'A' },
      { value: 'skill:b', label: 'B' },
      { value: 'prompt:c', label: 'C' },
      { value: 'skill:d', label: 'D' },
    ]

    expect(orderComposerOptionsByRecent(options, ['prompt:c', 'skill:b']).map((option) => option.value)).toEqual([
      'prompt:c',
      'skill:b',
      'skill:a',
      'skill:d',
    ])
  })
})
