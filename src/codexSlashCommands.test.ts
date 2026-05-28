import { describe, expect, it } from 'vitest'
import { CODEX_SLASH_COMMANDS, parseCodexSlashCommand } from './codexSlashCommands'

describe('side slash command', () => {
  it('parses /side with inline args', () => {
    const parsed = parseCodexSlashCommand('/side investigate this branch')

    expect(parsed?.command.command).toBe('side')
    expect(parsed?.command.supportsInlineArgs).toBe(true)
    expect(parsed?.args).toBe('investigate this branch')
  })

  it('marks side as supported by the web UI', () => {
    const sideCommand = CODEX_SLASH_COMMANDS.find((entry) => entry.command === 'side')

    expect(sideCommand?.webSupported).toBe(true)
  })
})
