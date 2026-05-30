import { existsSync, readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { handleUnifiedResponsesProxyRequest } from './unifiedResponsesProxy.js'

export const CODEX_LB_PROVIDER_ID = 'codex-lb'
export const CODEX_LB_PROXY_ROUTE_BASE = '/codex-api/codex-lb-proxy/v1'

type CodexLbProviderConfig = {
  providerId: string
  baseUrl: string
  wireApi: 'responses' | 'chat'
  envKey: string | null
}

type ParsedCodexConfig = {
  activeProviderId: string | null
  provider: CodexLbProviderConfig | null
}

type GetConfigArgsOptions = {
  serverPort?: number
  codexHomeDir?: string
  configPath?: string
}

type HandleProxyOptions = {
  codexHomeDir?: string
  configPath?: string
}

function getCodexHomeDir(): string {
  const codexHome = process.env.CODEX_HOME?.trim()
  return codexHome && codexHome.length > 0 ? codexHome : join(homedir(), '.codex')
}

function getCodexConfigPath(options: { codexHomeDir?: string; configPath?: string } = {}): string {
  return options.configPath ?? join(options.codexHomeDir ?? getCodexHomeDir(), 'config.toml')
}

function stripInlineTomlComment(value: string): string {
  let quote: '"' | "'" | null = null
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (quote) {
      if (quote === '"' && char === '\\' && !escaped) {
        escaped = true
        continue
      }
      if (char === quote && !escaped) quote = null
      escaped = false
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '#') return value.slice(0, index).trim()
  }
  return value.trim()
}

function parseTomlScalar(rawValue: string): string | boolean | null {
  const value = stripInlineTomlComment(rawValue)
  if (!value) return null
  if (value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value) as unknown
      return typeof parsed === 'string' ? parsed : null
    } catch {
      return null
    }
  }
  if (value.startsWith("'")) {
    const endIndex = value.indexOf("'", 1)
    return endIndex >= 0 ? value.slice(1, endIndex) : null
  }
  const normalized = value.toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return value
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readWireApi(value: unknown): 'responses' | 'chat' {
  return readString(value) === 'chat' ? 'chat' : 'responses'
}

export function parseCodexLbConfigToml(contents: string): ParsedCodexConfig {
  const topLevel: Record<string, string | boolean | null> = {}
  const sections: Record<string, Record<string, string | boolean | null>> = {}
  let activeSection = ''

  const sectionPattern = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/u
  const assignmentPattern = /^\s*([A-Za-z0-9_.-]+)\s*=\s*(.+)$/u

  for (const line of contents.split(/\r?\n/u)) {
    const sectionMatch = line.match(sectionPattern)
    if (sectionMatch) {
      activeSection = sectionMatch[1]?.trim() ?? ''
      continue
    }

    const assignmentMatch = line.match(assignmentPattern)
    if (!assignmentMatch) continue

    const key = assignmentMatch[1]
    const value = parseTomlScalar(assignmentMatch[2] ?? '')
    if (!key) continue

    if (!activeSection) {
      topLevel[key] = value
      continue
    }

    sections[activeSection] = sections[activeSection] ?? {}
    sections[activeSection][key] = value
  }

  const configuredProfile = readString(topLevel.profile)
  const activeProfileValues = configuredProfile ? sections[`profiles.${configuredProfile}`] ?? {} : {}
  const providerValues = sections[`model_providers.${CODEX_LB_PROVIDER_ID}`] ?? {}
  const activeProviderId =
    readString(activeProfileValues.model_provider)
    || readString(topLevel.model_provider)
    || null
  const baseUrl = readString(providerValues.base_url)
  const provider = activeProviderId === CODEX_LB_PROVIDER_ID && baseUrl
    ? {
        providerId: CODEX_LB_PROVIDER_ID,
        baseUrl,
        wireApi: readWireApi(providerValues.wire_api),
        envKey: readString(providerValues.env_key) || null,
      }
    : null

  return { activeProviderId, provider }
}

export function readCodexLbProviderConfig(options: HandleProxyOptions = {}): CodexLbProviderConfig | null {
  const configPath = getCodexConfigPath(options)
  if (!existsSync(configPath)) return null
  return parseCodexLbConfigToml(readFileSync(configPath, 'utf8')).provider
}

function isProxyDisabledByEnv(): boolean {
  const value = process.env.CODEXUI_CODEX_LB_PROXY?.trim().toLowerCase()
  return value === '0' || value === 'false' || value === 'no' || value === 'off'
}

function isCodexUiProxyBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).pathname.replace(/\/+$/u, '') === CODEX_LB_PROXY_ROUTE_BASE
  } catch {
    return false
  }
}

function tomlQuote(value: string): string {
  return JSON.stringify(value)
}

export function getCodexLbProxyConfigArgs(options: GetConfigArgsOptions = {}): string[] {
  if (!options.serverPort || isProxyDisabledByEnv()) return []
  const provider = readCodexLbProviderConfig(options)
  if (!provider || provider.wireApi !== 'responses' || isCodexUiProxyBaseUrl(provider.baseUrl)) return []

  const proxyBaseUrl = `http://127.0.0.1:${options.serverPort}${CODEX_LB_PROXY_ROUTE_BASE}`
  return [
    '-c', `model_providers.${CODEX_LB_PROVIDER_ID}.base_url=${tomlQuote(proxyBaseUrl)}`,
    '-c', `model_providers.${CODEX_LB_PROVIDER_ID}.wire_api="responses"`,
  ]
}

function joinEndpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/u, '')}${path}`
}

function extractBearerToken(req: IncomingMessage): string {
  const authorization = req.headers.authorization
  const value = Array.isArray(authorization) ? authorization[0] : authorization
  const match = value?.match(/^Bearer\s+(.+)$/iu)
  return match?.[1]?.trim() ?? ''
}

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

export function handleCodexLbProxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: HandleProxyOptions = {},
): void {
  const provider = readCodexLbProviderConfig(options)
  if (!provider || provider.wireApi !== 'responses' || !provider.baseUrl) {
    sendJson(res, 502, { error: { message: 'Codex LB provider is not configured for Responses proxying.' } })
    return
  }

  const fallbackToken = provider.envKey ? process.env[provider.envKey] ?? '' : ''
  handleUnifiedResponsesProxyRequest(req, res, {
    bearerToken: extractBearerToken(req) || fallbackToken,
    requireBearerToken: false,
    wireApi: 'responses',
    responsesEndpoint: joinEndpoint(provider.baseUrl, '/responses'),
    chatCompletionsEndpoint: joinEndpoint(provider.baseUrl, '/chat/completions'),
    missingKeyMessage: 'Missing Codex LB API key',
    allowToolFallbackToResponses: false,
    responsesPayloadFormat: 'raw',
  })
}
