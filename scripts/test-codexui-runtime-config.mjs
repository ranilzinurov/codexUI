#!/usr/bin/env node
import { spawn, execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const execFile = promisify(execFileCallback)
const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')
const port = 6211
const baseUrl = `http://127.0.0.1:${String(port)}`

async function waitForServer(maxAttempts = 60) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/codex-api/home-directory`)
      if (response.ok) return
    } catch {
      // Server may not be ready yet.
    }
    await sleep(500)
  }
  throw new Error('Server did not become ready in time')
}

async function triggerAppServerStartup() {
  const response = await fetch(baseUrl + '/codex-api/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'config/read', params: {} }),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error('Failed to trigger app-server startup: HTTP ' + String(response.status) + ' ' + response.statusText + '\n' + text)
  }
}


async function listProcesses() {
  const { stdout } = await execFile('ps', ['-eo', 'pid=,ppid=,args='])
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(.*)$/)
      if (!match) return null
      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        args: match[3],
      }
    })
    .filter(Boolean)
}

function collectDescendants(processes, rootPid) {
  const queue = [rootPid]
  const descendants = []
  while (queue.length > 0) {
    const current = queue.shift()
    for (const proc of processes) {
      if (proc.ppid !== current) continue
      descendants.push(proc)
      queue.push(proc.pid)
    }
  }
  return descendants
}

async function waitForAppServerArgs(rootPid, maxAttempts = 40) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const processes = await listProcesses()
    const descendants = collectDescendants(processes, rootPid)
    const matching = descendants.find((proc) => proc.args.includes('codex app-server'))
    if (matching) {
      return { matching, descendants }
    }
    await sleep(250)
  }
  throw new Error('Timed out waiting for codex app-server child process')
}

async function cleanup(server) {
  if (server.killed) return
  server.kill('SIGTERM')
  await sleep(750)
  if (!server.killed) {
    server.kill('SIGKILL')
  }
}

async function run() {
  const server = spawn(
    'node',
    [
      'dist-cli/index.js',
      '--port', String(port),
      '--no-password',
      '--no-tunnel',
      '--no-open',
      '--no-login',
      '--sandbox-mode', 'workspace-write',
      '--approval-policy', 'on-request',
    ],
    {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        OPENAI_API_KEY: 'test-key',
        OPENAI_BASE_URL: 'http://127.0.0.1:20128/v1',
      },
    },
  )

  let stderrLog = ''
  server.stderr.on('data', (chunk) => {
    stderrLog += String(chunk)
  })

  try {
    await waitForServer()
    await triggerAppServerStartup()
    const { matching, descendants } = await waitForAppServerArgs(server.pid)
    const descendantArgs = descendants.map((proc) => proc.args).join('\n')
    if (!matching.args.includes('approval_policy="on-request"')) {
      throw new Error(`app-server approval policy mismatch:\n${descendantArgs}`)
    }
    if (!matching.args.includes('sandbox_mode="workspace-write"')) {
      throw new Error(`app-server sandbox mode mismatch:\n${descendantArgs}`)
    }
    console.log('Runtime config OK: app-server uses workspace-write/on-request')
  } finally {
    await cleanup(server)
  }

  if (stderrLog.trim().length > 0) {
    console.log('Server stderr:')
    console.log(stderrLog.trim())
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
