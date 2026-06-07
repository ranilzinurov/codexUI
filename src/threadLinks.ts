export function buildThreadRoute(threadId: string): string {
  return `#/thread/${encodeURIComponent(threadId)}`
}

export function buildThreadLink(
  threadId: string,
  location: Pick<Location, 'origin' | 'pathname'> | null = typeof window === 'undefined' ? null : window.location,
): string {
  const route = buildThreadRoute(threadId)
  if (!location) return `/${route}`

  const basePath = location.pathname.replace(/\/?$/u, '/')
  return `${location.origin}${basePath}${route}`
}
