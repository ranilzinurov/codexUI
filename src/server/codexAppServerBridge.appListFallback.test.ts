import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  callRpcWithAppListFallback,
  extractAppListRowsForFallback,
  paginateAppListRowsForFallback,
  readAppListFallbackPage,
} from './codexAppServerBridge'

const originalCodexHome = process.env.CODEX_HOME
const tempDirs: string[] = []

function restoreEnvValue(key: string, value: string | undefined): void {
  if (typeof value === 'string') {
    process.env[key] = value
    return
  }
  delete process.env[key]
}

async function createCodexHome(): Promise<string> {
  const codexHome = await mkdtemp(join(tmpdir(), 'codexui-app-list-fallback-'))
  tempDirs.push(codexHome)
  process.env.CODEX_HOME = codexHome
  return codexHome
}

async function writeAppDirectoryCache(codexHome: string, fileName: string, payload: string | unknown): Promise<void> {
  const cacheDir = join(codexHome, 'cache', 'codex_app_directory')
  await mkdir(cacheDir, { recursive: true })
  await writeFile(
    join(cacheDir, fileName),
    typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
    'utf8',
  )
}

function appRow(id: string, name: string): Record<string, string> {
  return {
    id,
    name,
    description: `${name} description`,
  }
}

afterEach(async () => {
  restoreEnvValue('CODEX_HOME', originalCodexHome)
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('app/list local fallback', () => {
  it('extracts rows from app/list/updated-style snapshots and skips malformed rows', () => {
    expect(extractAppListRowsForFallback({
      snapshot: {
        data: [
          appRow('app-1', 'One'),
          { id: 'missing-name' },
          { name: 'missing id' },
          appRow('app-2', 'Two'),
        ],
      },
    })).toEqual([
      appRow('app-1', 'One'),
      appRow('app-2', 'Two'),
    ])
  })

  it('prefers non-empty connector rows over empty data arrays', () => {
    expect(extractAppListRowsForFallback({
      data: [],
      connectors: [
        appRow('connector-1', 'Connector One'),
      ],
    })).toEqual([
      appRow('connector-1', 'Connector One'),
    ])
  })

  it('paginates snapshot fallback rows with limit and cursor', async () => {
    const fallback = await readAppListFallbackPage(
      { limit: 2, cursor: 'codexui-app-list:1' },
      [
        appRow('app-1', 'One'),
        appRow('app-2', 'Two'),
        appRow('app-3', 'Three'),
        appRow('app-4', 'Four'),
      ],
    )

    expect(fallback).toEqual({
      data: [
        appRow('app-2', 'Two'),
        appRow('app-3', 'Three'),
      ],
      nextCursor: 'codexui-app-list:3',
    })
  })

  it('returns an empty page for non-fallback cursors', () => {
    expect(paginateAppListRowsForFallback([
      appRow('app-1', 'One'),
      appRow('app-2', 'Two'),
    ], { limit: 1, cursor: 'opaque-app-server-cursor' })).toEqual({
      data: [],
      nextCursor: null,
    })
  })

  it('falls back to the disk app directory cache when app/list fails', async () => {
    const codexHome = await createCodexHome()
    await writeAppDirectoryCache(codexHome, 'valid.json', {
      schema_version: 1,
      connectors: [
        appRow('app-1', 'One'),
        { id: 'malformed' },
        appRow('app-2', 'Two'),
        appRow('app-3', 'Three'),
      ],
    })
    await writeAppDirectoryCache(codexHome, 'newer-malformed.json', '{')

    const calls: Array<{ method: string; params: unknown }> = []
    const appServer = {
      async rpc(method: string, params: unknown): Promise<unknown> {
        calls.push({ method, params })
        throw new Error('remote app list failed')
      },
    }

    await expect(callRpcWithAppListFallback(appServer, 'app/list', { limit: 2, cursor: 'codexui-app-list:1' })).resolves.toEqual({
      data: [
        appRow('app-2', 'Two'),
        appRow('app-3', 'Three'),
      ],
      nextCursor: null,
    })
    expect(calls).toEqual([{ method: 'app/list', params: { limit: 2, cursor: 'codexui-app-list:1' } }])
  })

  it('uses the app/list/updated snapshot before disk cache when app/list fails', async () => {
    const codexHome = await createCodexHome()
    await writeAppDirectoryCache(codexHome, 'valid.json', {
      connectors: [appRow('disk-app', 'Disk')],
    })
    const appServer = {
      getLastAppListUpdatedSnapshot(): unknown[] {
        return [
          appRow('snapshot-app', 'Snapshot'),
          appRow('snapshot-next', 'Snapshot Next'),
        ]
      },
      async rpc(): Promise<unknown> {
        throw new Error('remote app list failed')
      },
    }

    await expect(callRpcWithAppListFallback(appServer, 'app/list', { limit: 1 })).resolves.toEqual({
      data: [appRow('snapshot-app', 'Snapshot')],
      nextCursor: 'codexui-app-list:1',
    })
  })

  it('does not fall back for non-app/list failures', async () => {
    const codexHome = await createCodexHome()
    await writeAppDirectoryCache(codexHome, 'valid.json', {
      connectors: [appRow('disk-app', 'Disk')],
    })
    const appServer = {
      async rpc(): Promise<unknown> {
        throw new Error('remote plugin list failed')
      },
    }

    await expect(callRpcWithAppListFallback(appServer, 'plugin/list', {})).rejects.toThrow('remote plugin list failed')
  })

  it('does not fall back for force refetch requests', async () => {
    const codexHome = await createCodexHome()
    await writeAppDirectoryCache(codexHome, 'valid.json', {
      connectors: [appRow('disk-app', 'Disk')],
    })
    const appServer = {
      async rpc(): Promise<unknown> {
        throw new Error('remote app list failed')
      },
    }

    await expect(callRpcWithAppListFallback(appServer, 'app/list', { forceRefetch: true })).rejects.toThrow('remote app list failed')
  })

  it('does not use global fallback rows for thread-scoped requests', async () => {
    const codexHome = await createCodexHome()
    await writeAppDirectoryCache(codexHome, 'valid.json', {
      connectors: [appRow('disk-app', 'Disk')],
    })
    const appServer = {
      getLastAppListUpdatedSnapshot(): unknown[] {
        return [appRow('snapshot-app', 'Snapshot')]
      },
      async rpc(): Promise<unknown> {
        throw new Error('remote app list failed')
      },
    }

    await expect(callRpcWithAppListFallback(appServer, 'app/list', { threadId: 'thread-1' })).rejects.toThrow('remote app list failed')
  })

  it('rethrows app/list failures when no snapshot or valid cache is available', async () => {
    const codexHome = await createCodexHome()
    await writeAppDirectoryCache(codexHome, 'malformed.json', {
      connectors: [
        { id: 'missing-name' },
        { name: 'missing id' },
      ],
    })
    const appServer = {
      async rpc(): Promise<unknown> {
        throw new Error('remote app list failed')
      },
    }

    await expect(callRpcWithAppListFallback(appServer, 'app/list', {})).rejects.toThrow('remote app list failed')
  })

  it('clamps invalid pagination inputs for fallback pages', () => {
    expect(paginateAppListRowsForFallback([appRow('app-1', 'One')], { limit: -10 })).toEqual({
      data: [appRow('app-1', 'One')],
      nextCursor: null,
    })
  })
})
