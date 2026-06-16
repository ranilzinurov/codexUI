#!/usr/bin/env node
const { createHash } = require('node:crypto')
const { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { dirname, join, posix, relative, resolve, sep } = require('node:path')

const repoRoot = resolve(__dirname, '..')
const extensionRoot = join(repoRoot, 'extension', 'browser-annotation')
const outputRoot = join(repoRoot, 'dist', 'browser-annotation-extension')
const stagingRoot = join(outputRoot, 'unpacked')
let crcTable

const runtimeFiles = [
  'manifest.json',
  'service-worker/service-worker.js',
  'sidepanel/sidepanel.html',
  'sidepanel/sidepanel.css',
  'sidepanel/sidepanel.js',
  'content/content-script.js',
  'shared/constants.js',
  'shared/url-utils.js',
  'shared/pairing-client.js',
  'shared/selection-context.js',
  'shared/annotation-queue.js',
  'shared/devtools-capture.js',
  'shared/screenshot-crop.js',
]

const manifest = JSON.parse(readFileSync(join(extensionRoot, 'manifest.json'), 'utf8'))
manifest.host_permissions = ['https://codex-ui.todo-tg-app.ru/*', 'https://annotate.todo-tg-app.ru/*']
manifest.optional_host_permissions = ['https://chatgpt.com/*', 'http://*/*', 'https://*/*']
delete manifest.content_security_policy

rmSync(outputRoot, { recursive: true, force: true })
mkdirSync(stagingRoot, { recursive: true })

const stagedFiles = []
for (const file of runtimeFiles) {
  const source = join(extensionRoot, file)
  if (!existsSync(source)) throw new Error(`Missing extension runtime file: ${file}`)
  const destination = join(stagingRoot, file)
  mkdirSync(dirname(destination), { recursive: true })
  if (file === 'manifest.json') {
    writeFileSync(destination, `${JSON.stringify(manifest, null, 2)}\n`)
  } else {
    writeFileSync(destination, readFileSync(source))
  }
  stagedFiles.push(file)
}

const version = String(manifest.version || '0.0.0').replace(/[^0-9A-Za-z._-]/g, '-')
const zipName = `codex-ui-browser-annotation-${version}.zip`
const zipPath = join(outputRoot, zipName)
writeFileSync(zipPath, createStoredZip(stagedFiles.map((file) => ({
  name: file.split(sep).join(posix.sep),
  data: readFileSync(join(stagingRoot, file)),
}))))

const sha256 = createHash('sha256').update(readFileSync(zipPath)).digest('hex')
console.log(JSON.stringify({
  unpackedPath: relative(repoRoot, stagingRoot),
  zipPath: relative(repoRoot, zipPath),
  version,
  fileCount: stagedFiles.length,
  sha256,
}, null, 2))

function createStoredZip(entries) {
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const data = Buffer.from(entry.data)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, name, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, name)
    offset += local.length + name.length + data.length
  }

  const centralOffset = offset
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(centralOffset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, ...centralParts, end])
}

function crc32(buffer) {
  const table = getCrcTable()
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff]
  }
  return (crc ^ 0xffffffff) >>> 0
}

function getCrcTable() {
  if (!crcTable) {
    crcTable = Array.from({ length: 256 }, (_, index) => {
      let value = index
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
      }
      return value >>> 0
    })
  }
  return crcTable
}
