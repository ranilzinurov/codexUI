import { describe, expect, it } from 'vitest'
import {
  normalizeCollabAgentsFromItems,
  normalizeThreadMessagesV2,
  normalizeThreadSummaryV2,
} from './v2'
import type { ThreadReadResponse } from '../appServerDtos'

function threadReadResponseWithContent(content: ThreadReadResponse['thread']['turns'][number]['items'][number][]): ThreadReadResponse {
  return {
    thread: {
      id: 'thread-1',
      preview: 'Use a skill',
      modelProvider: 'openai',
      createdAt: 1,
      updatedAt: 2,
      path: null,
      cwd: '/tmp/project',
      cliVersion: 'test',
      source: 'appServer',
      gitInfo: null,
      turns: [{
        id: 'turn-1',
        status: 'completed',
        error: null,
        items: content,
      }],
    },
  }
}

describe('normalizeThreadMessagesV2', () => {
  it('preserves selected skill inputs on the rendered user message', () => {
    const messages = normalizeThreadMessagesV2(threadReadResponseWithContent([{
      type: 'userMessage',
      id: 'user-1',
      content: [
        { type: 'text', text: 'Use the browser skill', text_elements: [] },
        { type: 'skill', name: 'browser-use:browser', path: '/Users/igor/.codex/skills/browser/SKILL.md' },
      ],
    }]))

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      id: 'user-1',
      role: 'user',
      text: 'Use the browser skill',
      skills: [{ name: 'browser-use:browser', path: '/Users/igor/.codex/skills/browser/SKILL.md' }],
    })
  })

  it('renders skill-only user messages instead of dropping them as raw blocks', () => {
    const messages = normalizeThreadMessagesV2(threadReadResponseWithContent([{
      type: 'userMessage',
      id: 'user-2',
      content: [
        { type: 'skill', name: 'composio-cli', path: '/Users/igor/.codex/skills/composio-cli/SKILL.md' },
      ],
    }]))

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      id: 'user-2',
      role: 'user',
      text: '',
      skills: [{ name: 'composio-cli', path: '/Users/igor/.codex/skills/composio-cli/SKILL.md' }],
    })
    expect(messages[0].isUnhandled).toBeUndefined()
  })

  it('decodes escaped heartbeat instructions without exposing raw XML', () => {
    const messages = normalizeThreadMessagesV2(threadReadResponseWithContent([{
      type: 'userMessage',
      id: 'automation-user-1',
      content: [{
        type: 'text',
        text: `<heartbeat>
<automation_id>automation-1</automation_id>
<current_time_iso>2026-05-09T00:00:00.000Z</current_time_iso>
<instructions>
Reply with &lt;/instructions&gt; and A &amp; B
</instructions>
</heartbeat>`,
        text_elements: [],
      }],
    }]))

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      id: 'automation-user-1',
      role: 'user',
      text: 'Reply with </instructions> and A & B',
      isAutomationRun: true,
      automationDisplayName: 'automation-1',
    })
  })

  it('applies a base turn index for paged thread slices', () => {
    const messages = normalizeThreadMessagesV2(threadReadResponseWithContent([{
      type: 'userMessage',
      id: 'user-3',
      content: [{ type: 'text', text: 'Paged message', text_elements: [] }],
    }]), 12)

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      id: 'user-3',
      turnId: 'turn-1',
      turnIndex: 12,
    })
  })

  it('normalizes MCP tool calls as renderable activity rows for collapsed summaries', () => {
    const messages = normalizeThreadMessagesV2(threadReadResponseWithContent([
      {
        type: 'mcpToolCall',
        id: 'mcp-1',
        server: 'github',
        tool: 'list_pull_requests',
        status: 'completed',
        arguments: { owner: 'openai', repo: 'codex' },
        result: { content: [{ type: 'text', text: 'No open pull requests' }] },
        error: null,
        durationMs: 420,
      },
      {
        type: 'mcpToolCall',
        id: 'mcp-2',
        server: 'notion',
        tool: 'search',
        status: 'failed',
        arguments: { query: 'collapsed agent rows' },
        result: null,
        error: { message: 'Timed out' },
        durationMs: 1500,
      },
    ]))

    expect(messages).toHaveLength(2)
    expect(messages).toMatchObject([
      {
        id: 'mcp-1',
        role: 'system',
        text: 'github.list_pull_requests',
        messageType: 'mcpToolCall',
        turnId: 'turn-1',
        turnIndex: 0,
        isUnhandled: undefined,
      },
      {
        id: 'mcp-2',
        role: 'system',
        text: 'notion.search',
        messageType: 'mcpToolCall',
        isUnhandled: undefined,
      },
    ])
    expect(messages[0].rawPayload).toContain('"server": "github"')
    expect(messages[1].rawPayload).toContain('"message": "Timed out"')
  })
})

describe('normalizeCollabAgentsFromItems', () => {
  it('keeps fallback agent names unique when thread ids share a prefix', () => {
    const agents = normalizeCollabAgentsFromItems([{
      type: 'collabAgentToolCall',
      id: 'collab-1',
      tool: 'wait',
      status: 'inProgress',
      senderThreadId: 'parent-thread',
      receiverThreadIds: [
        '019e44ef-1111-7000-8000-000000000001',
        '019e44f4-2222-7000-8000-000000000002',
      ],
      prompt: null,
      agentsStates: {},
    }])

    expect(agents.map((agent) => agent.name)).toEqual(['agent 019e44e', 'agent 019e44f'])
    expect(new Set(agents.map((agent) => agent.name)).size).toBe(2)
  })

  it('uses known sub-agent display names before id fallbacks', () => {
    const agents = normalizeCollabAgentsFromItems([{
      type: 'collabAgentToolCall',
      id: 'collab-2',
      tool: 'wait',
      status: 'inProgress',
      senderThreadId: 'parent-thread',
      receiverThreadIds: ['agent-thread-1'],
      prompt: null,
      agentsStates: {},
    }], {
      agentDisplayNames: {
        'agent-thread-1': 'Hilbert',
      },
    })

    expect(agents[0]).toMatchObject({
      id: 'agent-thread-1',
      name: 'Hilbert',
      task: 'waiting for delegated result',
    })
  })

  it('preserves deterministic many-agent rows for collapsed summary fixtures', () => {
    const agents = normalizeCollabAgentsFromItems([{
      type: 'collabAgentToolCall',
      id: 'collab-many',
      tool: 'wait',
      status: 'inProgress',
      senderThreadId: 'parent-thread',
      receiverThreadIds: [
        'agent-thread-1',
        'agent-thread-2',
        'agent-thread-3',
        'agent-thread-4',
        'agent-thread-5',
        'agent-thread-6',
      ],
      prompt: 'Review focused test fixtures',
      agentsStates: {
        'agent-thread-1': { status: 'running', message: 'Reading normalizer tests' },
        'agent-thread-2': { status: 'completed', message: 'Prepared MCP fixture' },
        'agent-thread-3': { status: 'errored', message: 'Fixture needs implementation' },
        'agent-thread-4': { status: 'shutdown', message: '' },
        'agent-thread-5': { status: 'notFound', message: null },
        'agent-thread-6': { status: 'queued', message: 'Waiting for turn' },
      },
    }], {
      agentDisplayNames: new Map([
        ['agent-thread-1', 'Ada'],
        ['agent-thread-2', 'Grace'],
        ['agent-thread-3', 'Linus'],
        ['agent-thread-4', 'Margaret'],
        ['agent-thread-5', 'Radia'],
        ['agent-thread-6', 'Ken'],
      ]),
    })

    expect(agents).toHaveLength(6)
    expect(agents).toMatchObject([
      { id: 'agent-thread-1', name: 'Ada', task: 'Reading normalizer tests', status: 'running' },
      { id: 'agent-thread-2', name: 'Grace', task: 'Prepared MCP fixture', status: 'completed' },
      { id: 'agent-thread-3', name: 'Linus', task: 'Fixture needs implementation', status: 'failed' },
      { id: 'agent-thread-4', name: 'Margaret', task: 'Review focused test fixtures', status: 'shutdown' },
      { id: 'agent-thread-5', name: 'Radia', task: 'Review focused test fixtures', status: 'notFound' },
      { id: 'agent-thread-6', name: 'Ken', task: 'Waiting for turn', status: 'pending' },
    ])
  })
})

describe('normalizeThreadSummaryV2', () => {
  it('reads AgentControl sub-agent nicknames from thread metadata', () => {
    const summary = normalizeThreadSummaryV2({
      thread: {
        id: 'agent-thread-1',
        preview: 'Sub-agent task',
        modelProvider: 'openai',
        createdAt: 1,
        updatedAt: 2,
        path: null,
        cwd: '/tmp/project',
        cliVersion: 'test',
        source: {
          subAgent: {
            thread_spawn: {
              parent_thread_id: 'parent-thread',
              depth: 1,
              agent_nickname: 'Goodall',
              agent_role: 'default',
            },
          },
        },
        agentNickname: 'Hilbert',
        gitInfo: null,
        turns: [],
      } as ThreadReadResponse['thread'],
    })

    expect(summary.agentDisplayName).toBe('Hilbert')
  })
})
