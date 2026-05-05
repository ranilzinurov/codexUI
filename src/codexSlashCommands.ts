export type CodexSlashCommand = {
  command: string
  description: string
  supportsInlineArgs: boolean
  webSupported: boolean
}

const INLINE_ARG_COMMANDS = new Set([
  'review',
  'rename',
  'plan',
  'goal',
  'fast',
  'ide',
  'keymap',
  'mcp',
  'side',
  'resume',
])

const WEB_SUPPORTED_COMMANDS = new Set([
  'compact',
  'review',
  'rename',
  'new',
  'fork',
  'plan',
  'goal',
  'mention',
  'fast',
  'model',
  'skills',
])

const UPSTREAM_COMMANDS: Array<{ command: string; description: string }> = [
  { command: 'model', description: 'choose what model and reasoning effort to use' },
  { command: 'fast', description: 'toggle Fast mode to enable fastest inference with increased plan usage' },
  { command: 'ide', description: 'include current selection, open files, and other context from your IDE' },
  { command: 'permissions', description: 'choose what Codex is allowed to do' },
  { command: 'keymap', description: 'remap TUI shortcuts' },
  { command: 'vim', description: 'toggle Vim mode for the composer' },
  { command: 'experimental', description: 'toggle experimental features' },
  { command: 'approve', description: 'approve one retry of a recent auto-review denial' },
  { command: 'memories', description: 'configure memory use and generation' },
  { command: 'skills', description: 'use skills to improve how Codex performs specific tasks' },
  { command: 'hooks', description: 'view and manage lifecycle hooks' },
  { command: 'review', description: 'review my current changes and find issues' },
  { command: 'rename', description: 'rename the current thread' },
  { command: 'new', description: 'start a new chat during a conversation' },
  { command: 'resume', description: 'resume a saved chat' },
  { command: 'fork', description: 'fork the current chat' },
  { command: 'init', description: 'create an AGENTS.md file with instructions for Codex' },
  { command: 'compact', description: 'summarize conversation to prevent hitting the context limit' },
  { command: 'plan', description: 'switch to Plan mode' },
  { command: 'goal', description: 'set or view the goal for a long-running task' },
  { command: 'collab', description: 'change collaboration mode (experimental)' },
  { command: 'agent', description: 'switch the active agent thread' },
  { command: 'side', description: 'start a side conversation in an ephemeral fork' },
  { command: 'copy', description: 'copy last response as markdown' },
  { command: 'diff', description: 'show git diff (including untracked files)' },
  { command: 'mention', description: 'mention a file' },
  { command: 'status', description: 'show current session configuration and token usage' },
  { command: 'debug-config', description: 'show config layers and requirement sources for debugging' },
  { command: 'title', description: 'configure which items appear in the terminal title' },
  { command: 'statusline', description: 'configure which items appear in the status line' },
  { command: 'theme', description: 'choose a syntax highlighting theme' },
  { command: 'mcp', description: 'list configured MCP tools; use /mcp verbose for details' },
  { command: 'apps', description: 'manage apps' },
  { command: 'plugins', description: 'browse plugins' },
  { command: 'logout', description: 'log out of Codex' },
  { command: 'quit', description: 'exit Codex' },
  { command: 'exit', description: 'exit Codex' },
  { command: 'feedback', description: 'send logs to maintainers' },
  { command: 'ps', description: 'list background terminals' },
  { command: 'stop', description: 'stop all background terminals' },
  { command: 'clear', description: 'clear the terminal and start a new chat' },
  { command: 'personality', description: 'choose a communication style for Codex' },
  { command: 'realtime', description: 'toggle realtime voice mode (experimental)' },
  { command: 'settings', description: 'configure realtime microphone/speaker' },
  { command: 'subagents', description: 'switch the active agent thread' },
]

export const CODEX_SLASH_COMMANDS: CodexSlashCommand[] = UPSTREAM_COMMANDS.map((entry) => ({
  ...entry,
  supportsInlineArgs: INLINE_ARG_COMMANDS.has(entry.command),
  webSupported: WEB_SUPPORTED_COMMANDS.has(entry.command),
}))

export type ParsedCodexSlashCommand = {
  raw: string
  command: CodexSlashCommand
  args: string
}

export function parseCodexSlashCommand(text: string): ParsedCodexSlashCommand | null {
  const raw = text.trim()
  if (!raw.startsWith('/')) return null
  const match = /^\/([a-z0-9][a-z0-9-]*)(?:\s+([\s\S]*))?$/i.exec(raw)
  if (!match) return null
  const commandName = match[1]?.toLowerCase() ?? ''
  const command = CODEX_SLASH_COMMANDS.find((entry) => entry.command === commandName)
  if (!command) return null
  return {
    raw,
    command,
    args: match[2]?.trim() ?? '',
  }
}
