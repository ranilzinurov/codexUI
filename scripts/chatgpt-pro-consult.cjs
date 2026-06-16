#!/usr/bin/env node
const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } = require('node:fs')
const { basename, dirname, join, relative, resolve, sep } = require('node:path')

const repoRoot = resolve(process.cwd())
const runtimeDir = resolve(repoRoot, '.codex', 'pro-control')
const serverUrl = normalizeServerUrl(process.env.CODEXUI_PRO_CONTROL_SERVER_URL || process.env.CODEXUI_SERVER_URL || 'http://127.0.0.1:4173')
const taskPollMs = Number(process.env.CODEXUI_PRO_CONTROL_POLL_MS || 2000)
const taskTimeoutMs = Number(process.env.CODEXUI_PRO_CONTROL_TIMEOUT_MS || 90 * 60 * 1000)
const maxFollowUps = Number(process.env.CODEXUI_PRO_CONTROL_MAX_FOLLOWUPS || 3)
let crcTable

const args = process.argv.slice(2)
const command = args[0] || 'consult'

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error))
  process.exit(1)
})

async function main() {
  if (command === 'bundle') {
    const bundle = buildRepositoryBundle({ userRequest: args.slice(1).join(' ') || 'Bundle only.' })
    console.log(JSON.stringify(bundle.summary, null, 2))
    return
  }
  if (command !== 'consult') {
    throw new Error(`Unknown command: ${command}`)
  }

  const userRequest = args.slice(1).join(' ').trim() || readStdinOrDefault()
  const token = readInternalToken()
  const auditDir = createAuditDir()
  const consultation = await runConsultation({ userRequest, token, auditDir })
  console.log(JSON.stringify({
    taskId: consultation.taskId,
    status: consultation.status,
    auditDir,
    conversationUrl: consultation.conversationUrl || null,
    warnings: consultation.warnings,
  }, null, 2))
}

async function runConsultation({ userRequest, token, auditDir }) {
  const bundle = buildRepositoryBundle({ userRequest })
  mkdirSync(join(auditDir, 'bundle'), { recursive: true })
  writeFileSync(join(auditDir, 'bundle', basename(bundle.path)), readFileSync(bundle.path))

  const uploadedBundle = await uploadFile(token, {
    name: basename(bundle.path),
    mime: 'application/zip',
    contentBase64: readFileSync(bundle.path).toString('base64'),
  })
  const prompt = buildPrompt({
    userRequest,
    bundleSummary: bundle.summary,
    files: [uploadedBundle],
    followUpNote: '',
  })
  writeFileSync(join(auditDir, 'prompt.md'), prompt)

  let task = await createTask(token, {
    mode: 'repo-bundle',
    projectId: basename(repoRoot),
    codexThreadId: process.env.CODEXUI_PRO_CONTROL_THREAD_ID || 'manual',
    prompt,
    fileIds: [uploadedBundle.fileId],
  })
  let resultTask = await waitForTask(token, task.id)
  const warnings = [...bundle.summary.warnings]
  let followUps = 0

  while (resultTask.status === 'completed' && followUps < maxFollowUps) {
    const answer = resultTask.result?.answerText || ''
    const requestedFiles = parseRequestedFiles(answer)
    if (requestedFiles.length === 0) break
    const followUpFiles = []
    const blocked = []
    for (const requestedPath of requestedFiles) {
      const allowed = readAllowedFile(requestedPath)
      if (!allowed) {
        blocked.push(requestedPath)
        continue
      }
      const uploaded = await uploadFile(token, {
        name: allowed.relativePath,
        mime: 'text/plain',
        contentBase64: allowed.content.toString('base64'),
      })
      followUpFiles.push(uploaded)
    }
    if (followUpFiles.length === 0 && blocked.length === 0) break
    followUps += 1
    const followUpPrompt = buildPrompt({
      userRequest,
      bundleSummary: bundle.summary,
      files: followUpFiles,
      followUpNote: [
        'Автоматический follow-up по requestedFiles.',
        blocked.length > 0 ? `Заблокированы политикой: ${blocked.join(', ')}` : '',
      ].filter(Boolean).join('\n'),
    })
    task = await createTask(token, {
      mode: 'follow-up',
      projectId: basename(repoRoot),
      codexThreadId: process.env.CODEXUI_PRO_CONTROL_THREAD_ID || 'manual',
      prompt: followUpPrompt,
      fileIds: followUpFiles.map((file) => file.fileId),
    })
    resultTask = await waitForTask(token, task.id)
  }
  if (followUps >= maxFollowUps) {
    warnings.push('Pro-control follow-up limit reached while ChatGPT still requested more context.')
  }

  const rawAnswer = resultTask.result?.answerText || resultTask.statusDetail || ''
  writeFileSync(join(auditDir, 'raw-pro-answer.md'), rawAnswer)
  const assessment = buildAssessment(resultTask, warnings)
  writeFileSync(join(auditDir, 'codex-assessment.md'), assessment)
  writeFileSync(join(auditDir, 'metadata.json'), `${JSON.stringify({
    taskId: resultTask.id,
    projectId: resultTask.projectId,
    codexThreadId: resultTask.codexThreadId,
    proSessionKey: resultTask.proSessionKey,
    conversationUrl: resultTask.conversationUrl || resultTask.result?.conversationUrl || '',
    bundleMode: bundle.summary.mode,
    filesSent: [uploadedBundle],
    readMethod: resultTask.result?.readMethod || null,
    clipboardRestored: resultTask.result?.clipboardRestored ?? null,
    executionModeRequested: resultTask.result?.executionModeRequested || 'foreground',
    executionModeUsed: resultTask.result?.executionModeUsed || null,
    warnings,
    attachments: resultTask.result?.attachments || [],
    status: resultTask.status,
    failureCode: resultTask.failureCode || null,
    followUps,
  }, null, 2)}\n`)

  await saveResultAttachments(token, resultTask, auditDir)
  return {
    taskId: resultTask.id,
    status: resultTask.status,
    conversationUrl: resultTask.conversationUrl || resultTask.result?.conversationUrl || '',
    warnings,
  }
}

function buildRepositoryBundle({ userRequest }) {
  const full = collectBundleEntries({ mode: 'full', userRequest })
  let mode = 'full'
  let entries = full.entries
  const warnings = [...full.warnings]
  let zip = createZip(entries)
  if (zip.length > 25 * 1024 * 1024 || entries.length > 2000) {
    mode = 'reduced'
    warnings.push('Full bundle exceeded policy limits; reduced bundle was created automatically.')
    const reduced = collectBundleEntries({ mode: 'reduced', userRequest })
    entries = reduced.entries
    warnings.push(...reduced.warnings)
    zip = createZip(entries)
    if (zip.length > 25 * 1024 * 1024) {
      throw new Error('bundle_too_large: reduced bundle still exceeds 25 MB.')
    }
  }
  mkdirSync(join(runtimeDir, 'bundles'), { recursive: true })
  const path = join(runtimeDir, 'bundles', `codex-pro-${Date.now()}-${mode}.zip`)
  writeFileSync(path, zip)
  return {
    path,
    summary: {
      mode,
      path,
      zipBytes: zip.length,
      fileCount: entries.length,
      warnings,
      manifest: entries.find((entry) => entry.name === 'CODEx_PRO_BUNDLE_MANIFEST.md')?.data.toString('utf8') || '',
    },
  }
}

function collectBundleEntries({ mode, userRequest }) {
  const warnings = []
  const entries = []
  const tracked = gitLines(['ls-files'])
  const untracked = gitLines(['ls-files', '--others', '--exclude-standard'])
  const candidates = mode === 'full'
    ? [...tracked, ...untracked]
    : selectReducedFiles([...tracked, ...untracked], userRequest)
  entries.push(textEntry('CODEx_PRO_BUNDLE_MANIFEST.md', buildBundleManifest({ mode, userRequest })))
  entries.push(textEntry('CODEx_PRO_FILE_TREE.txt', gitLines(['ls-files']).join('\n')))
  entries.push(textEntry('CODEx_PRO_GIT_STATUS.txt', gitText(['status', '--short'])))
  entries.push(textEntry('CODEx_PRO_GIT_DIFF.patch', gitText(['diff', '--stat', '--patch'])))
  entries.push(textEntry('CODEx_PRO_GIT_RECENT_COMMITS.txt', gitText(['log', '--oneline', '-25'])))
  entries.push(textEntry('CODEx_PRO_GIT_RECENT_PATCHES.patch', boundText(gitText(['log', '-10', '--patch', '--stat']), 1024 * 1024)))

  for (const file of candidates) {
    if (!isBundlePathAllowed(file)) {
      warnings.push(`Excluded by policy: ${file}`)
      continue
    }
    const absolute = join(repoRoot, file)
    if (!existsSync(absolute)) continue
    const fileStat = statSync(absolute)
    if (!fileStat.isFile()) continue
    if (fileStat.size > 2 * 1024 * 1024) {
      warnings.push(`Excluded over 2 MB: ${file}`)
      continue
    }
    const data = readFileSync(absolute)
    if (looksBinary(data)) {
      warnings.push(`Excluded binary: ${file}`)
      continue
    }
    entries.push({ name: file.split(sep).join('/'), data })
    if (entries.length >= 2000) {
      warnings.push('Bundle stopped at 2000 files.')
      break
    }
  }
  return { entries, warnings }
}

function selectReducedFiles(files, userRequest) {
  const mentioned = new Set((userRequest.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/gu) || []).map((value) => value.replace(/^\.\//u, '')))
  const changed = new Set([...gitLines(['diff', '--name-only']), ...gitLines(['diff', '--name-only', '--cached'])])
  return files.filter((file) => {
    if (changed.has(file) || mentioned.has(file)) return true
    if (/^(package\.json|pnpm-lock\.yaml|tsconfig\.json|vite\.config\.ts|vitest\.config\.ts|AGENTS\.md|tests\.md)$/u.test(file)) return true
    if (/(\.test\.ts|\.spec\.ts|README\.md)$/u.test(file)) return true
    return false
  })
}

function buildBundleManifest({ mode, userRequest }) {
  return [
    '# Codex Pro repository bundle',
    '',
    `Mode: ${mode}`,
    `Repository: ${repoRoot}`,
    `Created: ${new Date().toISOString()}`,
    '',
    '## User request',
    userRequest,
    '',
    '## Policy',
    '- Full bundle limit: 25 MB zip, 2 MB per file, 2000 files.',
    '- Secrets, credentials, browser profiles, generated artifacts, node_modules, and .git are excluded.',
    '- If context is insufficient, request exact paths in a final JSON block with requestedFiles.',
  ].join('\n')
}

function buildPrompt({ userRequest, bundleSummary, files, followUpNote }) {
  const reducedNote = bundleSummary.mode === 'reduced'
    ? 'Внимание: приложен reduced bundle из-за лимитов. Если контекста недостаточно, запроси точные пути файлов через requestedFiles.'
    : 'Приложен полный допустимый bundle репозитория.'
  return [
    'Ты консультируешь Codex по задаче в репозитории.',
    '',
    `Репозиторий: ${repoRoot}`,
    `Проект: ${basename(repoRoot)}`,
    `Bundle mode: ${bundleSummary.mode}`,
    reducedNote,
    followUpNote ? `\n${followUpNote}` : '',
    '',
    'Цель пользователя:',
    userRequest,
    '',
    'Приложенные файлы:',
    ...files.map((file) => `- ${file.name} (${file.size} bytes, sha256 ${file.sha256})`),
    '',
    'Ответь строго в формате:',
    '1. Выводы',
    '2. Рекомендуемые изменения',
    '3. Риски и предположения',
    '4. Какие проверки/тесты запустить',
    '5. Какие дополнительные файлы нужны, если контекста недостаточно',
    '',
    'Если нужны дополнительные файлы, добавь в конец machine-readable JSON-блок:',
    '```json',
    '{',
    '  "requestedFiles": []',
    '}',
    '```',
    '',
    'Не выдумывай содержимое файлов, которых нет в сообщении или вложениях.',
  ].filter(Boolean).join('\n')
}

async function uploadFile(token, file) {
  const response = await fetchJson('/codex-api/extension/pro-control/files', {
    method: 'POST',
    token,
    body: file,
  })
  return response.file
}

async function createTask(token, body) {
  const response = await fetchJson('/codex-api/extension/pro-control/tasks', {
    method: 'POST',
    token,
    body,
  })
  return response.task
}

async function waitForTask(token, taskId) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < taskTimeoutMs) {
    const response = await fetchJson(`/codex-api/extension/pro-control/tasks/${encodeURIComponent(taskId)}`, { token })
    const task = response.task
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'expired') {
      return task
    }
    await delay(taskPollMs)
  }
  throw new Error(`Timed out waiting for Pro-control task ${taskId}`)
}

async function saveResultAttachments(token, task, auditDir) {
  const attachments = task.result?.attachments || []
  if (attachments.length === 0) return
  const originalDir = join(auditDir, 'attachments', 'original')
  mkdirSync(originalDir, { recursive: true })
  const inspections = []
  for (const attachment of attachments) {
    const url = new URL(`/codex-api/extension/pro-control/files/${encodeURIComponent(attachment.fileId)}`, serverUrl)
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) continue
    const buffer = Buffer.from(await response.arrayBuffer())
    const savedPath = join(originalDir, basename(attachment.name))
    writeFileSync(savedPath, buffer)
    inspections.push(inspectAndApplyAttachment(savedPath, attachment))
  }
  writeFileSync(join(auditDir, 'attachments', 'inspection.json'), `${JSON.stringify(inspections, null, 2)}\n`)
  const applied = inspections.filter((row) => row.status === 'applied')
  const rejected = inspections.filter((row) => row.status !== 'applied')
  const assessmentPath = join(auditDir, 'codex-assessment.md')
  const appendix = [
    '',
    '## Attachment inspection',
    applied.length > 0 ? applied.map((row) => `- Applied ${row.name}: ${row.detail}`).join('\n') : '- No attachment hunks applied.',
    rejected.length > 0 ? rejected.map((row) => `- Rejected ${row.name}: ${row.detail}`).join('\n') : '- No rejected attachments.',
  ].join('\n')
  writeFileSync(assessmentPath, `${readFileSync(assessmentPath, 'utf8')}${appendix}\n`)
}

function inspectAndApplyAttachment(savedPath, attachment) {
  const name = basename(attachment.name || savedPath)
  if (!isBundlePathAllowed(name)) {
    return { name, status: 'rejected', detail: 'attachment name is blocked by policy' }
  }
  if (/\.(patch|diff)$/iu.test(name)) {
    const check = spawnSync('git', ['apply', '--check', savedPath], { cwd: repoRoot, encoding: 'utf8' })
    if (check.status !== 0) {
      return { name, status: 'rejected', detail: `git apply --check failed: ${boundText(check.stderr || check.stdout, 2000)}` }
    }
    const apply = spawnSync('git', ['apply', savedPath], { cwd: repoRoot, encoding: 'utf8' })
    if (apply.status !== 0) {
      return { name, status: 'rejected', detail: `git apply failed: ${boundText(apply.stderr || apply.stdout, 2000)}` }
    }
    return { name, status: 'applied', detail: 'patch applied after git apply --check' }
  }
  if (/\.zip$/iu.test(name)) {
    return inspectStoredZip(savedPath)
  }
  return { name, status: 'saved', detail: 'saved for manual review; not an applicable patch or supported zip' }
}

function inspectStoredZip(savedPath) {
  const name = basename(savedPath)
  const data = readFileSync(savedPath)
  const extractedDir = join(dirname(dirname(savedPath)), 'extracted', name.replace(/\.zip$/iu, ''))
  const entries = []
  let offset = 0
  while (offset + 30 <= data.length && data.readUInt32LE(offset) === 0x04034b50) {
    const method = data.readUInt16LE(offset + 8)
    const compressedSize = data.readUInt32LE(offset + 18)
    const uncompressedSize = data.readUInt32LE(offset + 22)
    const nameLength = data.readUInt16LE(offset + 26)
    const extraLength = data.readUInt16LE(offset + 28)
    const entryName = data.subarray(offset + 30, offset + 30 + nameLength).toString('utf8')
    const dataStart = offset + 30 + nameLength + extraLength
    const dataEnd = dataStart + compressedSize
    if (method !== 0) {
      return { name, status: 'rejected', detail: `zip entry ${entryName} uses unsupported compression` }
    }
    if (!isBundlePathAllowed(entryName) || entryName.endsWith('/') || uncompressedSize > 2 * 1024 * 1024) {
      return { name, status: 'rejected', detail: `zip entry ${entryName} is blocked by policy` }
    }
    entries.push({ entryName, content: data.subarray(dataStart, dataEnd) })
    offset = dataEnd
  }
  mkdirSync(extractedDir, { recursive: true })
  for (const entry of entries) {
    const target = resolve(extractedDir, entry.entryName)
    if (!target.startsWith(`${extractedDir}${sep}`)) {
      return { name, status: 'rejected', detail: `zip entry ${entry.entryName} escapes extraction directory` }
    }
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, entry.content)
  }
  return { name, status: 'saved', detail: `safe stored zip extracted for review (${entries.length} files)` }
}

async function fetchJson(path, options = {}) {
  const url = new URL(path, serverUrl)
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${options.token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : {}
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`)
  }
  return payload
}

function parseRequestedFiles(answer) {
  const matches = [...String(answer || '').matchAll(/```json\s*([\s\S]*?)```/gu)]
  for (const match of matches.reverse()) {
    try {
      const parsed = JSON.parse(match[1])
      if (Array.isArray(parsed.requestedFiles)) {
        return parsed.requestedFiles.map((value) => String(value).trim()).filter(Boolean).slice(0, 25)
      }
    } catch (_error) {
      // Keep scanning earlier JSON blocks.
    }
  }
  return []
}

function readAllowedFile(candidate) {
  const absolute = resolve(repoRoot, candidate)
  if (!absolute.startsWith(`${repoRoot}${sep}`)) return null
  const relativePath = relative(repoRoot, absolute)
  if (!isBundlePathAllowed(relativePath)) return null
  if (!existsSync(absolute)) return null
  const fileStat = statSync(absolute)
  if (!fileStat.isFile() || fileStat.size > 2 * 1024 * 1024) return null
  const content = readFileSync(absolute)
  if (looksBinary(content)) return null
  return { relativePath, content }
}

function isBundlePathAllowed(file) {
  const normalized = file.split(sep).join('/')
  if (!normalized || normalized.startsWith('../') || normalized.startsWith('/')) return false
  if (/(^|\/)(\.git|node_modules|dist|dist-cli|output|test-results|\.playwright-cli|\.codex)(\/|$)/u.test(normalized)) return false
  if (/(^|\/)\.env($|[._-])/u.test(normalized)) return false
  if (/(cookie|credential|secret|token|session|auth\.json|id_rsa)/iu.test(normalized)) return false
  return true
}

function buildAssessment(task, warnings) {
  return [
    '# Codex assessment',
    '',
    `Task: ${task.id}`,
    `Status: ${task.status}`,
    task.failureCode ? `Failure: ${task.failureCode}` : '',
    '',
    '## Accepted recommendations',
    '- Pending main Codex review of the Pro answer.',
    '',
    '## Rejected recommendations',
    '- None recorded by the helper.',
    '',
    '## Risky assumptions',
    warnings.length > 0 ? warnings.map((warning) => `- ${warning}`).join('\n') : '- None recorded.',
    '',
    '## Applied attachment hunks',
    '- None applied automatically by this helper run.',
    '',
    '## Tests run by skill',
    '- None.',
    '',
    '## Tests recommended for main workflow',
    '- Run focused repository tests for any changes accepted from this consultation.',
  ].filter(Boolean).join('\n')
}

function textEntry(name, text) {
  return { name, data: Buffer.from(text || '', 'utf8') }
}

function gitText(args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 })
  return result.status === 0 ? result.stdout : result.stderr
}

function gitLines(args) {
  return gitText(args).split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
}

function boundText(text, maxBytes) {
  const buffer = Buffer.from(text || '', 'utf8')
  return buffer.length <= maxBytes ? text : buffer.subarray(0, maxBytes).toString('utf8')
}

function looksBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000))
  return sample.includes(0)
}

function readInternalToken() {
  const fromEnv = process.env.CODEXUI_PRO_CONTROL_TOKEN
  if (fromEnv) return fromEnv
  const tokenPath = join(runtimeDir, 'server-token')
  if (!existsSync(tokenPath)) {
    throw new Error(`Missing Pro-control token at ${tokenPath}. Start Codex UI once or set CODEXUI_PRO_CONTROL_TOKEN.`)
  }
  return readFileSync(tokenPath, 'utf8').trim()
}

function createAuditDir() {
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
  const dir = join(runtimeDir, 'consultations', `${stamp}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function normalizeServerUrl(value) {
  const url = new URL(value)
  url.pathname = '/'
  url.search = ''
  url.hash = ''
  return url.toString()
}

function readStdinOrDefault() {
  try {
    const input = readFileSync(0, 'utf8').trim()
    if (input) return input
  } catch (_error) {
    // Ignore non-piped stdin.
  }
  return 'Проконсультируй Codex по текущей задаче.'
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createZip(entries) {
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
  const table = crcTable || (crcTable = Array.from({ length: 256 }, (_, index) => {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
    }
    return value >>> 0
  }))
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff]
  }
  return (crc ^ 0xffffffff) >>> 0
}
