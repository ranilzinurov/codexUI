export type RecentComposerOption = {
  value: string
}

const DEFAULT_RECENT_LIMIT = 8

export function normalizeRecentComposerValues(values: string[], limit = DEFAULT_RECENT_LIMIT): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    normalized.push(trimmed)
    if (normalized.length >= limit) break
  }
  return normalized
}

export function markComposerOptionRecent(values: string[], value: string, limit = DEFAULT_RECENT_LIMIT): string[] {
  return normalizeRecentComposerValues([value, ...values], limit)
}

export function orderComposerOptionsByRecent<T extends RecentComposerOption>(options: T[], recentValues: string[]): T[] {
  if (recentValues.length === 0) return options

  const recentRank = new Map<string, number>()
  recentValues.forEach((value, index) => {
    if (!recentRank.has(value)) recentRank.set(value, index)
  })

  return options
    .map((option, index) => ({ option, index }))
    .sort((a, b) => {
      const aRank = recentRank.get(a.option.value) ?? Number.POSITIVE_INFINITY
      const bRank = recentRank.get(b.option.value) ?? Number.POSITIVE_INFINITY
      if (aRank !== bRank) return aRank - bRank
      return a.index - b.index
    })
    .map(({ option }) => option)
}
