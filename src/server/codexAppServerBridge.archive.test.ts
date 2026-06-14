import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  callRpcWithArchiveRecovery,
  canonicalizeThreadListResponseForRead,
  canonicalizeWorkspaceRootsStateForRead,
  hasUsableCodexAuth,
  importProjectZip,
  isEmptyThreadReadError,
  isUnauthenticatedRateLimitError,
  writeWorkspaceRootsState,
} from './codexAppServerBridge'

const originalCodexHome = process.env.CODEX_HOME
const cloudflareHtml = '<!DOCTYPE html><html><head><title>Attention Required! | Cloudflare</title></head><body>Cloudflare Ray ID: abc123</body></html>'

function writeUInt32(buffer: Buffer, value: number, offset: number): void {
  buffer.writeUInt32LE(value >>> 0, offset)
}

function buildStoredZip(entries: Array<{ path: string; data?: string; directory?: boolean }>): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const path = entry.directory && !entry.path.endsWith('/') ? `${entry.path}/` : entry.path
    const name = Buffer.from(path, 'utf8')
    const data = entry.directory ? Buffer.alloc(0) : Buffer.from(entry.data ?? '', 'utf8')
    const localOffset = offset
    const localHeader = Buffer.alloc(30 + name.length)
    writeUInt32(localHeader, 0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0, 6)
    localHeader.writeUInt16LE(0, 8)
    writeUInt32(localHeader, data.length, 18)
    writeUInt32(localHeader, data.length, 22)
    localHeader.writeUInt16LE(name.length, 26)
    name.copy(localHeader, 30)
    localParts.push(localHeader, data)
    offset += localHeader.length + data.length

    const centralHeader = Buffer.alloc(46 + name.length)
    writeUInt32(centralHeader, 0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0, 8)
    centralHeader.writeUInt16LE(0, 10)
    writeUInt32(centralHeader, data.length, 20)
    writeUInt32(centralHeader, data.length, 24)
    centralHeader.writeUInt16LE(name.length, 28)
    writeUInt32(centralHeader, entry.directory ? 0x10 << 4 : 0, 38)
    writeUInt32(centralHeader, localOffset, 42)
    name.copy(centralHeader, 46)
    centralParts.push(centralHeader)
  }

  const centralOffset = offset
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0)
  const footer = Buffer.alloc(22)
  writeUInt32(footer, 0x06054b50, 0)
  footer.writeUInt16LE(entries.length, 8)
  footer.writeUInt16LE(entries.length, 10)
  writeUInt32(footer, centralSize, 12)
  writeUInt32(footer, centralOffset, 16)
  return Buffer.concat([...localParts, ...centralParts, footer])
}

afterEach(() => {
  if (originalCodexHome === undefined) {
    delete process.env.CODEX_HOME
  } else {
    process.env.CODEX_HOME = originalCodexHome
  }
})

describe('callRpcWithArchiveRecovery', () => {
  it('sets a fallback name and retries archive when Codex has not materialized a rollout', async () => {
    const calls: Array<{ method: string; params: unknown }> = []
    let archiveCalls = 0
    const appServer = {
      async rpc(method: string, params: unknown): Promise<unknown> {
        calls.push({ method, params })
        if (method === 'thread/archive') {
          archiveCalls += 1
          if (archiveCalls === 1) {
            throw new Error('no rollout found for thread test-thread')
          }
          return { ok: true }
        }
        if (method === 'thread/read') {
          return {
            thread: {
              id: 'test-thread',
              preview: 'Preview title',
              path: '/home/user/.codex/sessions/rollout-test-thread.jsonl',
            },
          }
        }
        return { ok: true }
      },
    }

    await expect(callRpcWithArchiveRecovery(appServer, 'thread/archive', { threadId: 'test-thread' })).resolves.toEqual({ ok: true })
    expect(calls).toEqual([
      { method: 'thread/archive', params: { threadId: 'test-thread' } },
      { method: 'thread/read', params: { threadId: 'test-thread', includeTurns: false } },
      { method: 'thread/name/set', params: { threadId: 'test-thread', name: 'Preview title' } },
      { method: 'thread/archive', params: { threadId: 'test-thread' } },
    ])
  })

  it('treats no-rollout archive of an already archived thread as successful', async () => {
    const calls: Array<{ method: string; params: unknown }> = []
    const appServer = {
      async rpc(method: string, params: unknown): Promise<unknown> {
        calls.push({ method, params })
        if (method === 'thread/archive') {
          throw new Error('no rollout found for thread archived-thread')
        }
        if (method === 'thread/read') {
          return {
            thread: {
              id: 'archived-thread',
              path: '/home/user/.codex/archived_sessions/rollout-archived-thread.jsonl',
            },
          }
        }
        throw new Error(`unexpected method ${method}`)
      },
    }

    await expect(callRpcWithArchiveRecovery(appServer, 'thread/archive', { threadId: 'archived-thread' })).resolves.toBeNull()
    expect(calls).toEqual([
      { method: 'thread/archive', params: { threadId: 'archived-thread' } },
      { method: 'thread/read', params: { threadId: 'archived-thread', includeTurns: false } },
    ])
  })

  it('does not recover unrelated RPC failures', async () => {
    const appServer = {
      async rpc(): Promise<unknown> {
        throw new Error('network failed')
      },
    }

    await expect(callRpcWithArchiveRecovery(appServer, 'thread/archive', { threadId: 'test-thread' })).rejects.toThrow('network failed')
    await expect(callRpcWithArchiveRecovery(appServer, 'thread/read', { threadId: 'test-thread' })).rejects.toThrow('network failed')
  })
})

describe('importProjectZip', () => {
  it('rejects entries that would escape the imported project directory', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'project-import-parent-'))
    try {
      const zip = buildStoredZip([
        { path: '.codex-project/manifest.json', data: JSON.stringify({ projectName: 'demo' }) },
        { path: '../escape.txt', data: 'escape' },
      ])

      await expect(importProjectZip(zip, parent)).rejects.toThrow('unsafe path')
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })

  it('creates a unique project directory and rewrites imported chat session metadata', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'codex-home-project-import-'))
    const parent = await mkdtemp(join(tmpdir(), 'project-import-parent-'))
    process.env.CODEX_HOME = codexHome

    try {
      await mkdir(join(parent, 'demo'), { recursive: true })
      const sourceSession = [
        JSON.stringify({
          timestamp: '2026-01-01T00:00:00.000Z',
          type: 'session_meta',
          payload: {
            id: 'source-thread',
            cwd: '/old/demo',
            model: 'gpt-5',
            model_provider: 'openai',
            cli_version: '0.1.0',
          },
        }),
        JSON.stringify({
          timestamp: '2026-01-01T00:01:00.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: 'hello import', images: [] },
        }),
      ].join('\n')
      const zip = buildStoredZip([
        { path: '.codex-project/manifest.json', data: JSON.stringify({ projectName: 'demo' }) },
        { path: 'README.md', data: '# Imported Demo\n' },
        { path: '.codex-project/chats/sessions/rollout-source-thread.jsonl', data: `${sourceSession}\n` },
      ])

      const result = await importProjectZip(zip, parent)

      expect(basename(result.projectPath)).toBe('demo-2')
      await expect(readFile(join(result.projectPath, 'README.md'), 'utf8')).resolves.toBe('# Imported Demo\n')
      expect(result.importedSessions).toBe(1)
      const importedDir = join(codexHome, 'sessions', 'imported')
      const importedFiles = await readdir(importedDir)
      expect(importedFiles).toHaveLength(1)
      const importedRaw = await readFile(join(importedDir, importedFiles[0]), 'utf8')
      expect(importedRaw).toContain(result.projectPath)
      expect(importedRaw).not.toContain('/old/demo')
      expect(importedRaw).not.toContain('source-thread')
    } finally {
      await rm(parent, { recursive: true, force: true })
      await rm(codexHome, { recursive: true, force: true })
    }
  })
})

describe('canonicalizeWorkspaceRootsStateForRead', () => {
  it('realpaths existing local roots so symlink cwd sessions remain visible', async () => {
    const state = await canonicalizeWorkspaceRootsStateForRead({
      order: ['/workspace-link/projects/demo', 'remote-project-id'],
      labels: {
        '/storage/projects/demo': 'Canonical Demo',
        '/workspace-link/projects/demo': 'Symlink Demo',
        'remote-project-id': 'Remote Demo',
      },
      active: ['/workspace-link/projects/demo'],
      projectOrder: ['remote-project-id', '/workspace-link/projects/demo'],
      remoteProjects: [{
        id: 'remote-project-id',
        hostId: 'remote-ssh-discovered:host',
        remotePath: '/remote/projects/demo',
        label: 'remote-demo',
      }],
    }, async (value) => value.replace('/workspace-link/', '/storage/'))

    expect(state.order).toEqual([
      '/storage/projects/demo',
      'remote-project-id',
    ])
    expect(state.active).toEqual(['/storage/projects/demo'])
    expect(state.projectOrder).toEqual([
      'remote-project-id',
      '/storage/projects/demo',
    ])
    expect(state.labels).toEqual({
      '/storage/projects/demo': 'Canonical Demo',
      'remote-project-id': 'Remote Demo',
    })
    expect(state.remoteProjects[0]?.id).toBe('remote-project-id')
  })
})

describe('writeWorkspaceRootsState', () => {
  it('persists workspace roots in canonical form', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'codex-home-workspace-roots-'))
    const canonicalRoot = join(codexHome, 'storage', 'projects', 'demo')
    const symlinkParent = join(codexHome, 'workspace-link', 'projects')
    const symlinkRoot = join(symlinkParent, 'demo')
    process.env.CODEX_HOME = codexHome

    try {
      await mkdir(canonicalRoot, { recursive: true })
      await mkdir(symlinkParent, { recursive: true })
      await symlink(canonicalRoot, symlinkRoot)
      await writeWorkspaceRootsState({
        order: [symlinkRoot, 'remote-project-id', canonicalRoot],
        labels: {
          [canonicalRoot]: 'Canonical Demo',
          [symlinkRoot]: 'Symlink Demo',
          'remote-project-id': 'Remote Demo',
        },
        active: [symlinkRoot, canonicalRoot],
        projectOrder: ['remote-project-id', symlinkRoot, canonicalRoot],
        remoteProjects: [{
          id: 'remote-project-id',
          hostId: 'remote-ssh-discovered:host',
          remotePath: '/remote/projects/demo',
          label: 'remote-demo',
        }],
      })

      const rawState = JSON.parse(await readFile(join(codexHome, '.codex-global-state.json'), 'utf8')) as Record<string, unknown>
      expect(rawState['electron-saved-workspace-roots']).toEqual([
        canonicalRoot,
        'remote-project-id',
      ])
      expect(rawState['active-workspace-roots']).toEqual([canonicalRoot])
      expect(rawState['project-order']).toEqual([
        'remote-project-id',
        canonicalRoot,
      ])
      expect(rawState['electron-workspace-root-labels']).toEqual({
        [canonicalRoot]: 'Canonical Demo',
        'remote-project-id': 'Remote Demo',
      })
    } finally {
      await rm(codexHome, { recursive: true, force: true })
    }
  })
})

describe('canonicalizeThreadListResponseForRead', () => {
  it('realpaths thread cwd values to match canonicalized workspace roots', async () => {
    const payload = await canonicalizeThreadListResponseForRead({
      data: [
        { id: 'symlink-cwd-thread', cwd: '/workspace-link/projects/demo' },
        { id: 'canonical-cwd-thread', cwd: '/storage/projects/demo' },
        { id: 'remote-thread', cwd: 'remote-project-id' },
      ],
      nextCursor: null,
    }, async (value) => value.replace('/workspace-link/', '/storage/'))

    expect(payload).toEqual({
      data: [
        { id: 'symlink-cwd-thread', cwd: '/storage/projects/demo' },
        { id: 'canonical-cwd-thread', cwd: '/storage/projects/demo' },
        { id: 'remote-thread', cwd: 'remote-project-id' },
      ],
      nextCursor: null,
    })
  })

  it('reuses cwd realpath results within one thread list response', async () => {
    const calls: string[] = []
    const payload = await canonicalizeThreadListResponseForRead({
      data: [
        { id: 'first-symlink-thread', cwd: '/workspace-link/projects/demo' },
        { id: 'second-symlink-thread', cwd: '/workspace-link/projects/demo' },
        { id: 'canonical-cwd-thread', cwd: '/storage/projects/demo' },
        { id: 'remote-thread', cwd: 'remote-project-id' },
      ],
      nextCursor: null,
    }, async (value) => {
      calls.push(value)
      return value.replace('/workspace-link/', '/storage/')
    })

    expect(payload).toEqual({
      data: [
        { id: 'first-symlink-thread', cwd: '/storage/projects/demo' },
        { id: 'second-symlink-thread', cwd: '/storage/projects/demo' },
        { id: 'canonical-cwd-thread', cwd: '/storage/projects/demo' },
        { id: 'remote-thread', cwd: 'remote-project-id' },
      ],
      nextCursor: null,
    })
    expect(calls).toEqual([
      '/workspace-link/projects/demo',
      '/storage/projects/demo',
    ])
  })
})

describe('isUnauthenticatedRateLimitError', () => {
  it('matches unauthenticated rate-limit failures from a fresh Codex home', () => {
    expect(isUnauthenticatedRateLimitError(new Error('codex account authentication required to read rate limits'))).toBe(true)
  })

  it('preserves rate-limit matching context while sanitizing unsafe HTML bodies', () => {
    expect(isUnauthenticatedRateLimitError(new Error(
      `codex account authentication required to read rate limits: ${cloudflareHtml}`,
    ))).toBe(true)
  })

  it('does not match unrelated authentication failures', () => {
    expect(isUnauthenticatedRateLimitError(new Error('codex account authentication required to send messages'))).toBe(false)
    expect(isUnauthenticatedRateLimitError(new Error('failed to read rate limits'))).toBe(false)
  })
})

describe('isEmptyThreadReadError', () => {
  it('matches Codex empty rollout read failures during immediate thread startup', () => {
    expect(isEmptyThreadReadError(new Error(
      'failed to read thread: thread-store internal error: failed to read thread /tmp/codex-home/sessions/rollout-test.jsonl: rollout at /tmp/codex-home/sessions/rollout-test.jsonl is empty',
    ))).toBe(true)
  })

  it('does not match unrelated thread read failures', () => {
    expect(isEmptyThreadReadError(new Error('failed to read thread: permission denied'))).toBe(false)
    expect(isEmptyThreadReadError(new Error('rollout is empty'))).toBe(false)
  })
})

describe('hasUsableCodexAuth', () => {
  it('returns false when auth.json is missing or does not contain usable tokens', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'codex-home-no-token-'))
    process.env.CODEX_HOME = codexHome
    try {
      await expect(hasUsableCodexAuth()).resolves.toBe(false)
      await writeFile(join(codexHome, 'auth.json'), JSON.stringify({ tokens: {} }))
      await expect(hasUsableCodexAuth()).resolves.toBe(false)
    } finally {
      await rm(codexHome, { recursive: true, force: true })
    }
  })

  it('returns true when auth.json contains an access token or refresh token', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'codex-home-with-token-'))
    process.env.CODEX_HOME = codexHome
    try {
      await writeFile(join(codexHome, 'auth.json'), JSON.stringify({ tokens: { access_token: 'access-token' } }))
      await expect(hasUsableCodexAuth()).resolves.toBe(true)
      await writeFile(join(codexHome, 'auth.json'), JSON.stringify({ tokens: { refresh_token: 'refresh-token' } }))
      await expect(hasUsableCodexAuth()).resolves.toBe(true)
    } finally {
      await rm(codexHome, { recursive: true, force: true })
    }
  })

  it('warns when auth.json exists but cannot be parsed', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'codex-home-invalid-auth-'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.CODEX_HOME = codexHome
    try {
      await writeFile(join(codexHome, 'auth.json'), '{')
      await expect(hasUsableCodexAuth()).resolves.toBe(false)
      expect(warn).toHaveBeenCalledWith(
        '[codex-auth] Unable to read Codex auth state',
        expect.objectContaining({ path: join(codexHome, 'auth.json') }),
      )
    } finally {
      warn.mockRestore()
      await rm(codexHome, { recursive: true, force: true })
    }
  })
})
