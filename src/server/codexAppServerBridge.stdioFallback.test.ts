import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type FakeProcess = {
  stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> }
  stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> }
  stdin: {
    write: ReturnType<typeof vi.fn>
    end: ReturnType<typeof vi.fn>
  }
  kill: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  emitExit: () => void
  writes: string[]
}

const spawned: FakeProcess[] = []
const spawnMock = vi.fn()

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  spawnSync: vi.fn(),
}))

vi.mock('../commandResolution.js', () => ({
  getNpmGlobalBinDir: vi.fn(() => null),
  getUserNpmPrefix: vi.fn(() => null),
  resolveCodexCommand: vi.fn(() => 'codex'),
  resolveRipgrepCommand: vi.fn(() => 'rg'),
}))

function createFakeProcess(index: number): FakeProcess {
  const processEvents = new EventEmitter()
  const stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() })
  const stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() })
  let exited = false

  const fake: FakeProcess = {
    stdout,
    stderr,
    stdin: {
      write: vi.fn((line: string) => {
        fake.writes.push(line)
        if (index === 1) {
          const request = JSON.parse(line) as { id?: number; method?: string }
          if (typeof request.id === 'number') {
            queueMicrotask(() => {
              stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { ok: request.method } })}\n`)
            })
          }
        }
        return true
      }),
      end: vi.fn(),
    },
    kill: vi.fn(() => {
      fake.emitExit()
      return true
    }),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      processEvents.on(event, listener)
      return fake
    }),
    emitExit: () => {
      if (exited) return
      exited = true
      processEvents.emit('exit', 1, null)
    },
    writes: [],
  }

  return fake
}

describe('codex app-server stdio fallback', () => {
  beforeEach(() => {
    spawned.length = 0
    spawnMock.mockImplementation(() => {
      const fake = createFakeProcess(spawned.length)
      spawned.push(fake)
      return fake
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.CODEXUI_SANDBOX_MODE
    delete process.env.CODEXUI_APPROVAL_POLICY
  })

  it('starts new CLI with --stdio and retries old CLI without dropping config args', async () => {
    process.env.CODEXUI_SANDBOX_MODE = 'workspace-write'
    process.env.CODEXUI_APPROVAL_POLICY = 'on-request'

    const { AppServerProcess } = await import('./codexAppServerBridge')
    const appServer = new AppServerProcess()

    const rpcPromise = appServer.rpc('config/read', {})
    await vi.waitFor(() => expect(spawned).toHaveLength(1))

    spawned[0].stderr.emit('data', "error: unexpected argument '--stdio' found\n")
    await vi.waitFor(() => expect(spawned).toHaveLength(2))

    await expect(rpcPromise).resolves.toEqual({ ok: 'config/read' })

    expect(spawnMock).toHaveBeenCalledTimes(2)
    expect(spawnMock.mock.calls[0][1]).toEqual([
      'app-server',
      '--stdio',
      '-c',
      'approval_policy="on-request"',
      '-c',
      'sandbox_mode="workspace-write"',
    ])
    expect(spawnMock.mock.calls[1][1]).toEqual([
      'app-server',
      '-c',
      'approval_policy="on-request"',
      '-c',
      'sandbox_mode="workspace-write"',
    ])
    expect(spawned[1].writes.some((line) => line.includes('"method":"initialize"'))).toBe(true)

    appServer.dispose()
  })
})
