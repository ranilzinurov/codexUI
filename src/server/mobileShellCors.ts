import type { RequestHandler } from 'express'

const ALLOWED_NATIVE_ORIGIN_PROTOCOLS = new Set(['capacitor:', 'ionic:'])
const ALLOWED_LOCALHOST_PROTOCOLS = new Set(['http:', 'https:'])

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '[::1]'
}

function isAllowedMobileShellOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin)
    if (ALLOWED_NATIVE_ORIGIN_PROTOCOLS.has(parsed.protocol)) {
      return parsed.hostname === 'localhost'
    }
    return ALLOWED_LOCALHOST_PROTOCOLS.has(parsed.protocol) && isLoopbackHostname(parsed.hostname)
  } catch {
    return false
  }
}

function isCorsBackendPath(path: string): boolean {
  return path.startsWith('/codex-api/') || path.startsWith('/codex-local-')
}

export function createMobileShellCorsMiddleware(): RequestHandler {
  return (req, res, next) => {
    const origin = req.get('Origin')?.trim() ?? ''
    if (!origin || !isCorsBackendPath(req.path) || !isAllowedMobileShellOrigin(origin)) {
      next()
      return
    }

    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With')
    res.setHeader('Vary', 'Origin')

    if (req.method === 'OPTIONS') {
      res.status(204).end()
      return
    }

    next()
  }
}
