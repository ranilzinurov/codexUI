#!/usr/bin/env node
const { spawn } = require('node:child_process')

const args = [
  'exec',
  'vitest',
  'run',
  'src/api/browserAnnotationContracts.test.ts',
  'src/api/codexGateway.test.ts',
  'src/server/browserAnnotationListen.test.ts',
  'src/server/browserAnnotationAssets.test.ts',
  'src/server/browserAnnotationTranscribe.test.ts',
  'src/server/browserAnnotationBatch.test.ts',
  '--reporter=verbose',
]

const child = spawn('pnpm', args, {
  cwd: process.cwd(),
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Browser annotation endpoint smoke suite interrupted by ${signal}`)
    process.exit(1)
  }
  if (code !== 0) {
    console.error(`Browser annotation endpoint smoke suite failed with exit code ${code}`)
    process.exit(code || 1)
  }
  console.log('Browser annotation endpoint smoke suite passed.')
})

child.on('error', (error) => {
  console.error(`Failed to start browser annotation endpoint smoke suite: ${error.message}`)
  process.exit(1)
})
