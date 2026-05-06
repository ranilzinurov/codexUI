import type { RequestHandler } from 'express'
import type { IncomingMessage, ServerResponse } from 'node:http'

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
  return path === '/codex-api' || path.startsWith('/codex-api/') || path.startsWith('/codex-local-')
}

function applyMobileShellCors(origin: string, path: string, res: Pick<ServerResponse, 'setHeader'>): boolean {
  if (!origin || !isCorsBackendPath(path) || !isAllowedMobileShellOrigin(origin)) return false

  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With')
  res.setHeader('Vary', 'Origin')
  return true
}

export function createMobileShellCorsMiddleware(): RequestHandler {
  return (req, res, next) => {
    const origin = req.get('Origin')?.trim() ?? ''
    const didApplyCors = applyMobileShellCors(origin, req.path, res)

    if (didApplyCors && req.method === 'OPTIONS') {
      res.status(204).end()
      return
    }

    next()
  }
}

export function handleMobileShellCorsRequest(req: IncomingMessage, res: ServerResponse): boolean {
  const originHeader = req.headers.origin
  const origin = Array.isArray(originHeader) ? originHeader[0]?.trim() ?? '' : originHeader?.trim() ?? ''
  const path = new URL(req.url ?? '/', 'http://localhost').pathname
  const didApplyCors = applyMobileShellCors(origin, path, res)

  if (didApplyCors && req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return true
  }

  return false
}
