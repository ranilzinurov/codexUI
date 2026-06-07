import { describe, expect, it } from 'vitest'
import { buildThreadLink, buildThreadRoute } from './threadLinks'

describe('thread links', () => {
  it('builds an encoded hash route for a thread id', () => {
    expect(buildThreadRoute('thread 1/part')).toBe('#/thread/thread%201%2Fpart')
  })

  it('builds an absolute link using the current app base path', () => {
    expect(buildThreadLink('thread-1', {
      origin: 'http://127.0.0.1:4173',
      pathname: '/codexui',
    })).toBe('http://127.0.0.1:4173/codexui/#/thread/thread-1')
  })

  it('falls back to a root-relative link without browser location', () => {
    expect(buildThreadLink('thread-1', null)).toBe('/#/thread/thread-1')
  })
})
