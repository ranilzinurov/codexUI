import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildWorkspaceRootsProjectOrderState,
  collectWorkspaceRootPathsForProjectRemoval,
  filterGroupsByWorkspaceRoots,
  findAdjacentThreadId,
  mergeMessages,
  removeThreadFromGroups,
  isThreadUnreadByLastRead,
  useDesktopState,
} from './useDesktopState'
import type { UiProjectGroup } from '../types/codex'
import type { WorkspaceRootsState } from '../api/codexGateway'

const gatewayMocks = vi.hoisted(() => ({
  archiveThread: vi.fn(),
  forkThread: vi.fn(),
  getAccountRateLimits: vi.fn(),
  getAvailableCollaborationModes: vi.fn(),
  getAvailableModelIds: vi.fn(),
  getCurrentModelConfig: vi.fn(),
  getPendingServerRequests: vi.fn(),
  getSkillsList: vi.fn(),
  getThreadDetail: vi.fn(),
  getThreadGroupsPage: vi.fn(),
  getThreadQueueState: vi.fn(),
  getThreadSummary: vi.fn(),
  getThreadTitleCache: vi.fn(),
  getWorkspaceRootsState: vi.fn(),
  generateThreadTitle: vi.fn(),
  interruptThreadTurn: vi.fn(),
  persistThreadReadState: vi.fn(),
  persistThreadTitle: vi.fn(),
  renameThread: vi.fn(),
  replyToServerRequest: vi.fn(),
  resumeThread: vi.fn(),
  revertThreadFileChanges: vi.fn(),
  rollbackThread: vi.fn(),
  setCodexSpeedMode: vi.fn(),
  setThreadQueueState: vi.fn(),
  setWorkspaceRootsState: vi.fn(),
  startThread: vi.fn(),
  startSideThread: vi.fn(),
  startThreadTurn: vi.fn(),
  subscribeCodexNotifications: vi.fn(),
}))

vi.mock('../api/codexGateway', () => ({
  ...gatewayMocks,
  getBackgroundThreadListLimit: vi.fn(() => 100),
  pickCodexRateLimitSnapshot: vi.fn(() => null),
}))

function thread(id: string, cwd: string, options: { hasWorktree?: boolean } = {}) {
  return {
    id,
    title: id,
    projectName: cwd ? cwd.split('/').at(-1) || cwd : 'Projectless',
    cwd,
    hasWorktree: options.hasWorktree ?? false,
    createdAtIso: '2026-04-28T00:00:00.000Z',
    updatedAtIso: '2026-04-28T00:00:00.000Z',
    preview: '',
    unread: false,
    inProgress: false,
  }
}

function installTestWindow(initialStorage: Record<string, string> = {}) {
  const store = new Map(Object.entries(initialStorage))
  let timeoutId = 0
  vi.stubGlobal('window', {
    localStorage: {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store.set(key, value)
      }),
      removeItem: vi.fn((key: string) => {
        store.delete(key)
      }),
    },
    setTimeout: vi.fn(() => {
      timeoutId += 1
      return timeoutId
    }),
    clearTimeout: vi.fn(),
  })
}

type SideChatDesktopState = ReturnType<typeof useDesktopState> & {
  sideThreadId: { value: string }
  sideMessages: { value: Array<{ id: string; role: string; text: string; messageType?: string }> }
  sideLiveOverlay: { value: { activityLabel?: string; reasoningText?: string } | null }
  openSideChatForSelectedThread: () => Promise<string>
  sendMessageToSideChat: (
    text: string,
    imageUrls?: string[],
    skills?: Array<{ name: string; path: string; kind?: 'skill' | 'plugin' }>,
    mode?: 'steer' | 'queue',
    fileAttachments?: Array<{ label: string; path: string; fsPath?: string }>,
  ) => Promise<unknown>
  closeSideChat: () => void
}

function expectSideChatState(state: ReturnType<typeof useDesktopState>): SideChatDesktopState {
  const sideState = state as SideChatDesktopState
  expect(typeof sideState.openSideChatForSelectedThread).toBe('function')
  expect(typeof sideState.sendMessageToSideChat).toBe('function')
  expect(typeof sideState.closeSideChat).toBe('function')
  expect(sideState.sideThreadId).toEqual(expect.objectContaining({ value: expect.any(String) }))
  expect(sideState.sideMessages).toEqual(expect.objectContaining({ value: expect.any(Array) }))
  expect(sideState.sideLiveOverlay).toEqual(expect.objectContaining({ value: null }))
  return sideState
}

function installNotificationListener() {
  let notify: (notification: { method: string; params: unknown; atIso: string }) => void = () => {
    throw new Error('notification listener was not registered')
  }
  gatewayMocks.subscribeCodexNotifications.mockImplementation((
    listener: (notification: { method: string; params: unknown; atIso: string }) => void,
  ) => {
    notify = listener
    return () => {}
  })
  return (notification: { method: string; params: unknown; atIso: string }) => notify(notification)
}

function scheduledWindowTimeoutCallbacks(): Array<() => void> {
  const timeoutMock = window.setTimeout as unknown as { mock?: { calls: Array<[unknown, ...unknown[]]> } }
  return (timeoutMock.mock?.calls ?? [])
    .map(([callback]) => callback)
    .filter((callback): callback is () => void => typeof callback === 'function')
}

async function flushAsyncWork(): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve()
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  gatewayMocks.startSideThread.mockResolvedValue({ threadId: 'side-thread', model: 'gpt-5.4' })
  gatewayMocks.getThreadQueueState.mockResolvedValue({})
  gatewayMocks.getThreadSummary.mockRejectedValue(new Error('thread summary unavailable'))
  gatewayMocks.getThreadTitleCache.mockResolvedValue({ titles: {} })
  gatewayMocks.getWorkspaceRootsState.mockRejectedValue(new Error('no workspace roots state'))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('filterGroupsByWorkspaceRoots', () => {
  it('keeps projectless chats visible when workspace roots are configured', () => {
    const groups: UiProjectGroup[] = [
      {
        projectName: 'Projectless',
        threads: [thread('projectless-chat', '')],
      },
      {
        projectName: 'allowed-project',
        threads: [thread('allowed-chat', '/tmp/allowed-project')],
      },
      {
        projectName: 'other-project',
        threads: [thread('other-chat', '/tmp/other-project')],
      },
    ]
    const rootsState: WorkspaceRootsState = {
      order: ['/tmp/allowed-project'],
      labels: {},
      active: ['/tmp/allowed-project'],
      projectOrder: [],
    }

    expect(filterGroupsByWorkspaceRoots(groups, rootsState).map((group) => group.projectName)).toEqual([
      'Projectless',
      'allowed-project',
    ])
  })

  it('keeps child projects visible under a configured workspace container root', () => {
    const groups: UiProjectGroup[] = [
      {
        projectName: 'codexUI',
        threads: [thread('codexui-chat', '/home/rnl1/prog/codexUI')],
      },
      {
        projectName: 'todo_tg_app',
        threads: [thread('todo-chat', '/home/rnl1/prog/todo_tg_app')],
      },
      {
        projectName: 'other-project',
        threads: [thread('other-chat', '/home/rnl1/other-project')],
      },
    ]
    const rootsState: WorkspaceRootsState = {
      order: ['/home/rnl1/prog'],
      labels: {},
      active: ['/home/rnl1/prog'],
      projectOrder: [],
    }

    expect(filterGroupsByWorkspaceRoots(groups, rootsState).map((group) => group.projectName)).toEqual([
      'prog',
      'codexUI',
      'todo_tg_app',
    ])
  })

  it('keeps workspace roots with the same folder name as separate projects', () => {
    const groups: UiProjectGroup[] = [
      {
        projectName: 'api',
        threads: [
          thread('first-api-chat', '/tmp/first/api'),
          thread('second-api-chat', '/tmp/second/api'),
        ],
      },
    ]
    const rootsState: WorkspaceRootsState = {
      order: ['/tmp/first/api', '/tmp/second/api'],
      labels: {},
      active: ['/tmp/first/api', '/tmp/second/api'],
      projectOrder: [],
    }

    expect(filterGroupsByWorkspaceRoots(groups, rootsState).map((group) => group.projectName)).toEqual([
      '/tmp/first/api',
      '/tmp/second/api',
    ])
  })

  it('uses Codex project-order when workspace roots are hydrated', () => {
    const groups: UiProjectGroup[] = [
      {
        projectName: 'alpha',
        threads: [thread('alpha-chat', '/tmp/alpha')],
      },
      {
        projectName: 'beta',
        threads: [thread('beta-chat', '/tmp/beta')],
      },
    ]
    const rootsState: WorkspaceRootsState = {
      order: ['/tmp/alpha', '/tmp/beta'],
      labels: {},
      active: ['/tmp/alpha'],
      projectOrder: ['/tmp/beta', '/tmp/alpha'],
    }

    expect(filterGroupsByWorkspaceRoots(groups, rootsState).map((group) => group.projectName)).toEqual([
      'beta',
      'alpha',
    ])
  })

  it('keeps empty duplicate workspace roots visible in Codex project order', () => {
    const groups: UiProjectGroup[] = [
      {
        projectName: 'TestChat',
        threads: [thread('testchat-chat', '/Users/igor/temp/TestChat')],
      },
    ]
    const rootsState: WorkspaceRootsState = {
      order: ['/Users/igor/Documents/New project 2/TestChat', '/Users/igor/temp/TestChat'],
      labels: {},
      active: ['/Users/igor/Documents/New project 2/TestChat', '/Users/igor/temp/TestChat'],
      projectOrder: ['/Users/igor/Documents/New project 2/TestChat', '/Users/igor/temp/TestChat'],
    }

    expect(filterGroupsByWorkspaceRoots(groups, rootsState).map((group) => [group.projectName, group.threads.length])).toEqual([
      ['/Users/igor/Documents/New project 2/TestChat', 0],
      ['/Users/igor/temp/TestChat', 1],
    ])
  })

  it('keeps remote projects from Codex project order visible as empty project rows', () => {
    const groups: UiProjectGroup[] = []
    const rootsState: WorkspaceRootsState = {
      order: ['/tmp/local-project'],
      labels: {},
      active: ['/tmp/local-project'],
      projectOrder: ['remote-project-id', '/tmp/local-project'],
      remoteProjects: [{
        id: 'remote-project-id',
        hostId: 'remote-ssh-discovered:a1',
        remotePath: '/home/ubuntu',
        label: 'ubuntu',
      }],
    }

    expect(filterGroupsByWorkspaceRoots(groups, rootsState).map((group) => [group.projectName, group.threads.length])).toEqual([
      ['remote-project-id', 0],
      ['local-project', 0],
    ])
  })

  it('keeps managed worktree threads under the matching workspace root project', () => {
    const groups: UiProjectGroup[] = [
      {
        projectName: 'codex-web-local',
        threads: [
          thread('main-chat', '/Users/igor/Git-projects/codex-web-local'),
          thread('worktree-chat', '/Users/igor/.codex/worktrees/53e7/codex-web-local', { hasWorktree: true }),
        ],
      },
    ]
    const rootsState: WorkspaceRootsState = {
      order: ['/Users/igor/Git-projects/codex-web-local'],
      labels: {},
      active: ['/Users/igor/Git-projects/codex-web-local'],
      projectOrder: ['/Users/igor/Git-projects/codex-web-local'],
    }

    expect(filterGroupsByWorkspaceRoots(groups, rootsState).map((group) => [group.projectName, group.threads.map((row) => row.id)])).toEqual([
      ['codex-web-local', ['main-chat', 'worktree-chat']],
    ])
  })

  it('keeps unregistered managed worktrees under the main root when another managed worktree root is registered', () => {
    const groups: UiProjectGroup[] = [
      {
        projectName: 'codex-web-local',
        threads: [
          thread('main-chat', '/Users/igor/Git-projects/codex-web-local'),
          thread('registered-worktree-chat', '/Users/igor/.codex/worktrees/a77f/codex-web-local', { hasWorktree: true }),
          thread('unregistered-worktree-chat', '/Users/igor/.codex/worktrees/53e7/codex-web-local', { hasWorktree: true }),
        ],
      },
    ]
    const rootsState: WorkspaceRootsState = {
      order: [
        '/Users/igor/Git-projects/codex-web-local',
        '/Users/igor/.codex/worktrees/a77f/codex-web-local',
      ],
      labels: {
        '/Users/igor/.codex/worktrees/a77f/codex-web-local': 'codex-web-local2',
      },
      active: ['/Users/igor/Git-projects/codex-web-local'],
      projectOrder: ['/Users/igor/Git-projects/codex-web-local'],
    }

    expect(filterGroupsByWorkspaceRoots(groups, rootsState).map((group) => [group.projectName, group.threads.map((row) => row.id)])).toEqual([
      ['/Users/igor/Git-projects/codex-web-local', ['main-chat', 'unregistered-worktree-chat']],
      ['/Users/igor/.codex/worktrees/a77f/codex-web-local', ['registered-worktree-chat']],
    ])
  })

  it('does not group unrelated git worktrees under a same-leaf workspace root project', () => {
    const groups: UiProjectGroup[] = [
      {
        projectName: 'codex-web-local',
        threads: [
          thread('main-chat', '/Users/igor/Git-projects/codex-web-local'),
          thread('other-git-worktree-chat', '/tmp/other/.git/worktrees/codex-web-local', { hasWorktree: true }),
        ],
      },
    ]
    const rootsState: WorkspaceRootsState = {
      order: ['/Users/igor/Git-projects/codex-web-local'],
      labels: {},
      active: ['/Users/igor/Git-projects/codex-web-local'],
      projectOrder: ['/Users/igor/Git-projects/codex-web-local'],
    }

    expect(filterGroupsByWorkspaceRoots(groups, rootsState).map((group) => [group.projectName, group.threads.map((row) => row.id)])).toEqual([
      ['/Users/igor/Git-projects/codex-web-local', ['main-chat']],
    ])
  })
})

describe('removeThreadFromGroups', () => {
  it('removes an archived thread and drops the now-empty project group', () => {
    const groups: UiProjectGroup[] = [
      {
        projectName: 'alpha',
        threads: [thread('keep-alpha', '/tmp/alpha')],
      },
      {
        projectName: 'archived-project',
        threads: [thread('archive-me', '/tmp/archived-project')],
      },
      {
        projectName: 'beta',
        threads: [thread('keep-beta', '/tmp/beta')],
      },
      {
        projectName: 'empty-workspace-root',
        threads: [],
      },
    ]

    expect(removeThreadFromGroups(groups, 'archive-me').map((group) => [
      group.projectName,
      group.threads.map((row) => row.id),
    ])).toEqual([
      ['alpha', ['keep-alpha']],
      ['beta', ['keep-beta']],
      ['empty-workspace-root', []],
    ])
  })

  it('preserves referential identity when the thread is absent', () => {
    const groups: UiProjectGroup[] = [
      {
        projectName: 'alpha',
        threads: [thread('keep-alpha', '/tmp/alpha')],
      },
    ]

    expect(removeThreadFromGroups(groups, 'missing-thread')).toBe(groups)
  })
})

describe('workspace roots project persistence helpers', () => {
  it('collects duplicate-path project roots by full path when removing a project', () => {
    const rootsState: WorkspaceRootsState = {
      order: ['/tmp/first/api', '/tmp/second/api'],
      labels: {
        '/tmp/first/api': 'First API',
        '/tmp/second/api': 'Second API',
      },
      active: ['/tmp/first/api'],
      projectOrder: ['/tmp/first/api', '/tmp/second/api'],
    }

    expect([...collectWorkspaceRootPathsForProjectRemoval(rootsState, '/tmp/first/api')]).toEqual([
      '/tmp/first/api',
    ])
  })

  it('preserves remote project ids in explicit project order when persisting workspace roots', () => {
    const groups: UiProjectGroup[] = [
      {
        projectName: 'local-project',
        threads: [thread('local-chat', '/tmp/local-project')],
      },
    ]
    const rootsState: WorkspaceRootsState = {
      order: ['/tmp/local-project'],
      labels: {},
      active: ['/tmp/local-project'],
      projectOrder: ['remote-project-id', '/tmp/local-project'],
      remoteProjects: [{
        id: 'remote-project-id',
        hostId: 'remote-ssh-discovered:a1',
        remotePath: '/home/ubuntu',
        label: 'ubuntu',
      }],
    }

    expect(buildWorkspaceRootsProjectOrderState(rootsState, ['remote-project-id', 'local-project'], groups)).toEqual({
      order: ['/tmp/local-project'],
      active: ['/tmp/local-project'],
      projectOrder: ['remote-project-id', '/tmp/local-project'],
    })
  })
})

describe('thread unread state helpers', () => {
  const cutoffIso = '2026-05-01T12:00:00.000Z'

  it('uses the initialization cutoff when a thread has no read state', () => {
    expect(isThreadUnreadByLastRead('2026-05-01T11:59:59.000Z', undefined, cutoffIso)).toBe(false)
    expect(isThreadUnreadByLastRead('2026-05-01T12:00:01.000Z', undefined, cutoffIso)).toBe(true)
  })

  it('uses per-thread read state instead of the global cutoff after a thread is read', () => {
    expect(isThreadUnreadByLastRead(
      '2026-05-01T12:30:00.000Z',
      '2026-05-01T12:45:00.000Z',
      cutoffIso,
    )).toBe(false)
    expect(isThreadUnreadByLastRead(
      '2026-05-01T12:50:00.000Z',
      '2026-05-01T12:45:00.000Z',
      cutoffIso,
    )).toBe(true)
  })
})

describe('collaboration mode selection', () => {
  it('can prime an empty selected thread without clearing persisted selection', () => {
    installTestWindow({
      'codex-web-local.selected-thread-id.v1': 'thread-a',
    })

    const state = useDesktopState()

    expect(state.selectedThreadId.value).toBe('thread-a')

    state.primeSelectedThread('', { persist: false })

    expect(state.selectedThreadId.value).toBe('')
    expect(window.localStorage.getItem('codex-web-local.selected-thread-id.v1')).toBe('thread-a')
  })

  it('does not carry plan mode from new chats into existing threads', () => {
    installTestWindow({
      'codex-web-local.collaboration-mode.v1': 'plan',
    })

    const state = useDesktopState()

    expect(state.selectedCollaborationMode.value).toBe('default')

    state.setSelectedCollaborationMode('plan')

    expect(state.selectedCollaborationMode.value).toBe('plan')
    expect(window.localStorage.getItem('codex-web-local.collaboration-mode-by-context.v1')).toBe(null)

    state.primeSelectedThread('thread-a')

    expect(state.selectedCollaborationMode.value).toBe('default')

    state.setSelectedCollaborationMode('plan')
    state.primeSelectedThread('thread-b')

    expect(state.selectedCollaborationMode.value).toBe('default')

    state.primeSelectedThread('thread-a')

    expect(state.selectedCollaborationMode.value).toBe('plan')
  })
})

describe('target thread message sender', () => {
  it('queues a message for a busy target thread without selecting it', async () => {
    installTestWindow()
    gatewayMocks.getThreadSummary.mockResolvedValue({
      ...thread('target-thread', '/tmp/project'),
      inProgress: true,
    })

    const state = useDesktopState()

    const result = await state.sendMessageToThread('target-thread', 'background transcript', {
      mode: 'queue',
      collaborationModeOverride: 'plan',
      imageUrls: ['blob:image-1'],
      fileAttachments: [{ label: 'notes.md', path: '/tmp/project/notes.md', fsPath: '/tmp/project/notes.md' }],
      skills: [{ name: 'review', path: '/tmp/project/.codex/skills/review/SKILL.md' }],
      reasoningEffortOverride: 'xhigh',
    })

    expect(result).toBe('queued')
    expect(state.selectedThreadId.value).toBe('')
    expect(gatewayMocks.startThreadTurn).not.toHaveBeenCalled()
    expect(gatewayMocks.setThreadQueueState).toHaveBeenCalledWith({
      'target-thread': [
        expect.objectContaining({
          text: 'background transcript',
          imageUrls: ['blob:image-1'],
          fileAttachments: [{ label: 'notes.md', path: '/tmp/project/notes.md', fsPath: '/tmp/project/notes.md' }],
          skills: [{ name: 'review', path: '/tmp/project/.codex/skills/review/SKILL.md', kind: 'skill' }],
          collaborationMode: 'plan',
          reasoningEffort: 'xhigh',
        }),
      ],
    })
  })

  it('starts a turn for an idle target thread without selecting it', async () => {
    installTestWindow()
    gatewayMocks.getThreadSummary.mockResolvedValue({
      ...thread('target-thread', '/tmp/project'),
      inProgress: false,
    })
    gatewayMocks.resumeThread.mockResolvedValue({ model: 'gpt-5.4' })
    gatewayMocks.startThreadTurn.mockResolvedValue('turn-1')

    const state = useDesktopState()

    const result = await state.sendMessageToThread('target-thread', 'background transcript', {
      collaborationModeOverride: 'plan',
      imageUrls: ['blob:image-1'],
      fileAttachments: [{ label: 'notes.md', path: '/tmp/project/notes.md', fsPath: '/tmp/project/notes.md' }],
      skills: [{ name: 'review', path: '/tmp/project/.codex/skills/review/SKILL.md' }],
      reasoningEffortOverride: 'high',
    })

    expect(result).toBe('started')
    expect(state.selectedThreadId.value).toBe('')
    expect(gatewayMocks.resumeThread).toHaveBeenCalledWith('target-thread')
    const call = gatewayMocks.startThreadTurn.mock.calls[0]
    expect(call[0]).toBe('target-thread')
    expect(call[1]).toBe('background transcript')
    expect(call[2]).toEqual(['blob:image-1'])
    expect(call[4]).toBe('high')
    expect(call[5]).toEqual([{ name: 'review', path: '/tmp/project/.codex/skills/review/SKILL.md' }])
    expect(call[6]).toEqual([{ label: 'notes.md', path: '/tmp/project/notes.md', fsPath: '/tmp/project/notes.md' }])
    expect(call[7]).toBe('plan')
    expect(gatewayMocks.setThreadQueueState).not.toHaveBeenCalled()
  })

  it('resumes and retries once when a cached resumed thread is missing during turn start', async () => {
    installTestWindow()
    gatewayMocks.getThreadSummary.mockResolvedValue({
      ...thread('target-thread', '/tmp/project'),
      inProgress: false,
    })
    gatewayMocks.resumeThread.mockResolvedValue({ model: 'gpt-5.4' })
    gatewayMocks.startThreadTurn
      .mockResolvedValueOnce('turn-1')
      .mockRejectedValueOnce(new Error('RPC turn/start failed with HTTP 502: thread not found: target-thread'))
      .mockResolvedValueOnce('turn-2')

    const state = useDesktopState()

    await expect(state.sendMessageToThread('target-thread', 'first message')).resolves.toBe('started')
    await expect(state.sendMessageToThread('target-thread', 'second message', { mode: 'steer' })).resolves.toBe('started')
    await vi.waitFor(() => {
      expect(gatewayMocks.startThreadTurn).toHaveBeenCalledTimes(3)
    })

    expect(gatewayMocks.resumeThread).toHaveBeenCalledTimes(2)
    expect(gatewayMocks.resumeThread).toHaveBeenNthCalledWith(1, 'target-thread')
    expect(gatewayMocks.resumeThread).toHaveBeenNthCalledWith(2, 'target-thread')
    expect(gatewayMocks.startThreadTurn.mock.calls[1][1]).toBe('second message')
    expect(gatewayMocks.startThreadTurn.mock.calls[2][1]).toBe('second message')
  })

  it('steers a message into a busy target thread when requested without selecting it', async () => {
    installTestWindow()
    gatewayMocks.getThreadSummary.mockResolvedValue({
      ...thread('target-thread', '/tmp/project'),
      inProgress: true,
    })
    gatewayMocks.startThreadTurn.mockResolvedValue('turn-1')

    const state = useDesktopState()

    const result = await state.sendMessageToThread('target-thread', 'background transcript', {
      mode: 'steer',
      collaborationModeOverride: 'plan',
      imageUrls: ['blob:image-1'],
      fileAttachments: [{ label: 'notes.md', path: '/tmp/project/notes.md', fsPath: '/tmp/project/notes.md' }],
      skills: [{ name: 'review', path: '/tmp/project/.codex/skills/review/SKILL.md' }],
      reasoningEffortOverride: 'medium',
    })

    expect(result).toBe('started')
    expect(state.selectedThreadId.value).toBe('')
    const call = gatewayMocks.startThreadTurn.mock.calls[0]
    expect(call[0]).toBe('target-thread')
    expect(call[1]).toBe('background transcript')
    expect(call[2]).toEqual(['blob:image-1'])
    expect(call[4]).toBe('medium')
    expect(call[5]).toEqual([{ name: 'review', path: '/tmp/project/.codex/skills/review/SKILL.md' }])
    expect(call[6]).toEqual([{ label: 'notes.md', path: '/tmp/project/notes.md', fsPath: '/tmp/project/notes.md' }])
    expect(call[7]).toBe('plan')
    expect(gatewayMocks.setThreadQueueState).not.toHaveBeenCalled()
  })
})

describe('previous response auto-continue watcher', () => {
  it('sends one normal continuation message when previous_response_not_found is surfaced', async () => {
    installTestWindow({ 'codex-web-local.selected-thread-id.v1': 'target-thread' })
    const notify = installNotificationListener()
    gatewayMocks.resumeThread.mockResolvedValue({ model: 'gpt-5.4' })
    gatewayMocks.startThreadTurn.mockResolvedValue('auto-turn')
    const state = useDesktopState()
    state.startPolling()

    const scheduledBeforeError = scheduledWindowTimeoutCallbacks().length
    notify({
      method: 'error',
      params: {
        threadId: 'target-thread',
        error: {
          message: JSON.stringify({
            type: 'error',
            error: {
              type: 'invalid_request_error',
              code: 'previous_response_not_found',
              message: "Previous response with id 'resp_auto' not found.",
              param: 'previous_response_id',
            },
            status: 400,
          }),
        },
        willRetry: false,
      },
      atIso: '2026-06-01T00:00:00.000Z',
    })
    for (const callback of scheduledWindowTimeoutCallbacks().slice(scheduledBeforeError)) {
      callback()
    }
    await flushAsyncWork()

    expect(gatewayMocks.startThreadTurn).toHaveBeenCalledTimes(1)
    expect(gatewayMocks.startThreadTurn.mock.calls[0][0]).toBe('target-thread')
    expect(gatewayMocks.startThreadTurn.mock.calls[0][1]).toContain('У нас была ошибка')
    expect(gatewayMocks.startThreadTurn.mock.calls[0][1]).toContain('resp_auto')
    expect(gatewayMocks.startThreadTurn.mock.calls[0][1]).toContain('Продолжи с того места')
    expect(state.selectedThreadId.value).toBe('target-thread')
  })

  it('dedupes repeated previous_response_not_found notifications for the same response id', async () => {
    installTestWindow({ 'codex-web-local.selected-thread-id.v1': 'target-thread' })
    const notify = installNotificationListener()
    gatewayMocks.resumeThread.mockResolvedValue({ model: 'gpt-5.4' })
    gatewayMocks.startThreadTurn.mockResolvedValue('auto-turn')
    const state = useDesktopState()
    state.startPolling()

    const notification = {
      method: 'error',
      params: {
        threadId: 'target-thread',
        error: {
          message: "Previous response with id 'resp_dupe' not found.",
        },
        willRetry: false,
      },
      atIso: '2026-06-01T00:00:00.000Z',
    }

    let scheduledBeforeError = scheduledWindowTimeoutCallbacks().length
    notify(notification)
    notify(notification)
    for (const callback of scheduledWindowTimeoutCallbacks().slice(scheduledBeforeError)) {
      callback()
    }
    await flushAsyncWork()

    scheduledBeforeError = scheduledWindowTimeoutCallbacks().length
    notify(notification)
    for (const callback of scheduledWindowTimeoutCallbacks().slice(scheduledBeforeError)) {
      callback()
    }
    await flushAsyncWork()

    expect(gatewayMocks.startThreadTurn).toHaveBeenCalledTimes(1)
  })

  it('ignores thread-not-found and unrelated errors', async () => {
    installTestWindow({ 'codex-web-local.selected-thread-id.v1': 'target-thread' })
    const notify = installNotificationListener()
    gatewayMocks.resumeThread.mockResolvedValue({ model: 'gpt-5.4' })
    gatewayMocks.startThreadTurn.mockResolvedValue('auto-turn')
    const state = useDesktopState()
    state.startPolling()

    const scheduledBeforeError = scheduledWindowTimeoutCallbacks().length
    notify({
      method: 'error',
      params: {
        threadId: 'target-thread',
        error: {
          message: 'RPC turn/start failed with HTTP 502: thread not found: target-thread',
        },
        willRetry: false,
      },
      atIso: '2026-06-01T00:00:00.000Z',
    })
    notify({
      method: 'error',
      params: {
        threadId: 'target-thread',
        error: {
          message: 'rate_limit_exceeded',
        },
        willRetry: false,
      },
      atIso: '2026-06-01T00:00:01.000Z',
    })
    for (const callback of scheduledWindowTimeoutCallbacks().slice(scheduledBeforeError)) {
      callback()
    }
    await flushAsyncWork()

    expect(gatewayMocks.startThreadTurn).not.toHaveBeenCalled()
  })
})

describe('side-chat state API', () => {
  it('opens a side chat for the selected thread without changing selectedThreadId', async () => {
    installTestWindow({ 'codex-web-local.selected-thread-id.v1': 'main-thread' })
    const state = useDesktopState()
    const sideState = expectSideChatState(state)

    const sideThreadId = await sideState.openSideChatForSelectedThread()

    expect(gatewayMocks.startSideThread).toHaveBeenCalledWith('main-thread')
    expect(sideThreadId).toBe('side-thread')
    expect(sideState.sideThreadId.value).toBe('side-thread')
    expect(state.selectedThreadId.value).toBe('main-thread')
  })

  it('sends side-chat turns to sideThreadId while the main send remains selectedThreadId-bound', async () => {
    installTestWindow({ 'codex-web-local.selected-thread-id.v1': 'main-thread' })
    gatewayMocks.resumeThread.mockResolvedValue({ model: 'gpt-5.4' })
    gatewayMocks.startThreadTurn.mockResolvedValue('turn-1')
    const state = useDesktopState()
    const sideState = expectSideChatState(state)

    await sideState.openSideChatForSelectedThread()
    await sideState.sendMessageToSideChat('side transcript', ['blob:side-image'])
    await state.sendMessageToSelectedThread('main transcript')

    expect(sideState.sideMessages.value).toEqual([
      expect.objectContaining({
        role: 'user',
        text: 'side transcript',
        messageType: 'sideUser.optimistic',
      }),
    ])
    expect(state.messages.value).toEqual([])
    expect(gatewayMocks.startThreadTurn).toHaveBeenCalledTimes(2)
    expect(gatewayMocks.startThreadTurn.mock.calls[0][0]).toBe('side-thread')
    expect(gatewayMocks.startThreadTurn.mock.calls[0][1]).toBe('side transcript')
    expect(gatewayMocks.startThreadTurn.mock.calls[0][2]).toEqual(['blob:side-image'])
    expect(gatewayMocks.startThreadTurn.mock.calls[1][0]).toBe('main-thread')
    expect(gatewayMocks.startThreadTurn.mock.calls[1][1]).toBe('main transcript')
    expect(state.selectedThreadId.value).toBe('main-thread')
  })

  it('removes optimistic side-chat user text when side turn start fails', async () => {
    installTestWindow({ 'codex-web-local.selected-thread-id.v1': 'main-thread' })
    gatewayMocks.startThreadTurn.mockRejectedValue(new Error('side failed'))
    const state = useDesktopState()
    const sideState = expectSideChatState(state)

    await sideState.openSideChatForSelectedThread()
    await expect(sideState.sendMessageToSideChat('side transcript')).rejects.toThrow('side failed')

    expect(sideState.sideMessages.value).toEqual([])
    expect(state.messages.value).toEqual([])
    expect(state.selectedThreadId.value).toBe('main-thread')
  })

  it('routes side-thread notification deltas into the side overlay and side messages only', async () => {
    installTestWindow({ 'codex-web-local.selected-thread-id.v1': 'main-thread' })
    const notify = installNotificationListener()
    const state = useDesktopState()
    const sideState = expectSideChatState(state)
    state.startPolling()

    await sideState.openSideChatForSelectedThread()

    notify({
      method: 'turn/started',
      params: { threadId: 'side-thread', turnId: 'side-turn' },
      atIso: '2026-05-28T00:00:00.000Z',
    })
    notify({
      method: 'item/reasoning/summaryTextDelta',
      params: {
        threadId: 'side-thread',
        turnId: 'side-turn',
        itemId: 'side-reasoning',
        summaryIndex: 0,
        delta: 'Side thinking stays beside the main thread.',
      },
      atIso: '2026-05-28T00:00:01.000Z',
    })

    expect(sideState.sideLiveOverlay.value).toMatchObject({
      activityLabel: 'Thinking',
      reasoningText: 'Side thinking stays beside the main thread.',
    })

    notify({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'side-thread',
        turnId: 'side-turn',
        itemId: 'side-agent-message',
        delta: 'Side answer',
      },
      atIso: '2026-05-28T00:00:02.000Z',
    })

    expect(sideState.sideLiveOverlay.value?.activityLabel).toBe('Writing response')
    expect(sideState.sideMessages.value).toEqual([
      expect.objectContaining({
        id: 'side-agent-message',
        role: 'assistant',
        text: 'Side answer',
        messageType: 'agentMessage.live',
      }),
    ])
    expect(state.selectedLiveOverlay.value).toBe(null)
    expect(state.messages.value).toEqual([])
    expect(state.selectedThreadId.value).toBe('main-thread')
  })

  it('keeps a streamed side answer when thread-list refresh prunes thread-scoped state', async () => {
    installTestWindow({ 'codex-web-local.selected-thread-id.v1': 'main-thread' })
    const notify = installNotificationListener()
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({
      groups: [{ projectName: 'project', threads: [thread('main-thread', '/tmp/project')] }],
      nextCursor: null,
    })
    gatewayMocks.startThreadTurn.mockResolvedValue('side-turn')
    const state = useDesktopState()
    const sideState = expectSideChatState(state)
    state.startPolling()

    await sideState.openSideChatForSelectedThread()
    await sideState.sendMessageToSideChat('What is the main chat about?')
    const mainMessagesBeforeCompletion = [...state.messages.value]

    const liveSideAnswer = {
      id: 'side-agent-message',
      role: 'assistant' as const,
      text: 'The main chat is about side-chat notification sync.',
      messageType: 'agentMessage.live',
    }
    notify({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'side-thread',
        turnId: 'side-turn',
        itemId: liveSideAnswer.id,
        delta: liveSideAnswer.text,
      },
      atIso: '2026-05-28T00:00:02.000Z',
    })

    expect(sideState.sideMessages.value).toEqual([
      expect.objectContaining({
        role: 'user',
        text: 'What is the main chat about?',
      }),
      expect.objectContaining(liveSideAnswer),
    ])

    const scheduledBeforeCompletion = scheduledWindowTimeoutCallbacks().length
    notify({
      method: 'turn/completed',
      params: {
        threadId: 'side-thread',
        turnId: 'side-turn',
        turn: {
          id: 'side-turn',
          threadId: 'side-thread',
          status: 'completed',
          startedAt: '2026-05-28T00:00:00.000Z',
          completedAt: '2026-05-28T00:00:03.000Z',
        },
      },
      atIso: '2026-05-28T00:00:03.000Z',
    })
    for (const callback of scheduledWindowTimeoutCallbacks().slice(scheduledBeforeCompletion)) {
      callback()
    }
    await flushAsyncWork()

    expect(sideState.sideLiveOverlay.value).toBe(null)
    expect(sideState.sideMessages.value).toEqual(expect.arrayContaining([expect.objectContaining(liveSideAnswer)]))
    expect(sideState.sideMessages.value).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'user',
        text: 'What is the main chat about?',
      }),
    ]))
    expect(gatewayMocks.getThreadDetail).not.toHaveBeenCalledWith('side-thread')
    expect(state.messages.value).toEqual(mainMessagesBeforeCompletion)
    expect(state.selectedThreadId.value).toBe('main-thread')
  })

  it('closes the side chat by clearing side state while preserving selectedThreadId', async () => {
    installTestWindow({ 'codex-web-local.selected-thread-id.v1': 'main-thread' })
    const notify = installNotificationListener()
    const state = useDesktopState()
    const sideState = expectSideChatState(state)
    state.startPolling()

    await sideState.openSideChatForSelectedThread()
    notify({
      method: 'turn/started',
      params: { threadId: 'side-thread', turnId: 'side-turn' },
      atIso: '2026-05-28T00:00:00.000Z',
    })
    notify({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'side-thread',
        turnId: 'side-turn',
        itemId: 'side-agent-message',
        delta: 'Side answer',
      },
      atIso: '2026-05-28T00:00:01.000Z',
    })

    sideState.closeSideChat()

    expect(sideState.sideThreadId.value).toBe('')
    expect(sideState.sideMessages.value).toEqual([])
    expect(sideState.sideLiveOverlay.value).toBe(null)
    expect(state.selectedThreadId.value).toBe('main-thread')
  })
})

describe('sub-agent live status', () => {
  it('uses sub-agent nicknames and streams reasoning summaries into the parent status row', async () => {
    installTestWindow({ 'codex-web-local.selected-thread-id.v1': 'parent-thread' })
    let notify: (notification: { method: string; params: unknown; atIso: string }) => void = () => {
      throw new Error('notification listener was not registered')
    }
    gatewayMocks.subscribeCodexNotifications.mockImplementation((
      listener: (notification: { method: string; params: unknown; atIso: string }) => void,
    ) => {
      notify = listener
      return () => {}
    })
    gatewayMocks.getThreadSummary.mockResolvedValue(thread('agent-thread', '/tmp/project', {
      hasWorktree: false,
    }))

    const state = useDesktopState()
    state.startPolling()

    notify({
      method: 'thread/started',
      params: {
        thread: {
          id: 'agent-thread',
          agentNickname: 'Hilbert',
          source: {
            subAgent: {
              thread_spawn: {
                parent_thread_id: 'parent-thread',
                depth: 1,
                agent_nickname: 'Hilbert',
              },
            },
          },
        },
      },
      atIso: '2026-05-20T00:00:00.000Z',
    })
    notify({
      method: 'turn/started',
      params: { threadId: 'parent-thread', turnId: 'parent-turn' },
      atIso: '2026-05-20T00:00:01.000Z',
    })
    notify({
      method: 'item/completed',
      params: {
        threadId: 'parent-thread',
        turnId: 'parent-turn',
        item: {
          type: 'collabAgentToolCall',
          id: 'collab-1',
          tool: 'wait',
          status: 'inProgress',
          senderThreadId: 'parent-thread',
          receiverThreadIds: ['agent-thread'],
          prompt: null,
          agentsStates: {
            'agent-thread': { status: 'running', message: null },
          },
        },
      },
      atIso: '2026-05-20T00:00:02.000Z',
    })

    expect(state.selectedLiveOverlay.value?.collabAgents[0]).toMatchObject({
      name: 'Hilbert',
      task: 'waiting for delegated result',
    })

    notify({
      method: 'item/reasoning/summaryTextDelta',
      params: {
        threadId: 'agent-thread',
        turnId: 'agent-turn',
        itemId: 'reasoning-1',
        summaryIndex: 0,
        delta: 'Reviewing the agent status UI and checking how summaries should fit.',
      },
      atIso: '2026-05-20T00:00:03.000Z',
    })

    expect(state.selectedLiveOverlay.value?.collabAgents[0]).toMatchObject({
      name: 'Hilbert',
      task: 'Reviewing the agent status UI and checking how summaries should fit.',
      status: 'running',
      details: {
        reasoningSummary: 'Reviewing the agent status UI and checking how summaries should fit.',
        latestTask: 'Reviewing the agent status UI and checking how summaries should fit.',
      },
    })

    notify({
      method: 'item/started',
      params: {
        threadId: 'agent-thread',
        turnId: 'agent-turn',
        item: {
          type: 'commandExecution',
          id: 'cmd-1',
          commandExecution: { command: 'rg ThreadComposer src/components/content/ThreadComposer.vue' },
        },
      },
      atIso: '2026-05-20T00:00:04.000Z',
    })

    expect(state.selectedLiveOverlay.value?.collabAgents[0].details?.commands).toEqual([
      'rg ThreadComposer src/components/content/ThreadComposer.vue',
    ])

    notify({
      method: 'item/started',
      params: {
        threadId: 'agent-thread',
        turnId: 'agent-turn',
        item: {
          type: 'fileChange',
          id: 'file-1',
          changes: [
            { path: 'src/components/content/ThreadComposer.vue' },
            { path: 'src/style.css' },
          ],
        },
      },
      atIso: '2026-05-20T00:00:05.000Z',
    })

    expect(state.selectedLiveOverlay.value?.collabAgents[0].details?.changedPaths).toEqual([
      'src/components/content/ThreadComposer.vue',
      'src/style.css',
    ])
  })

  it('restores a sub-agent row when agent updates arrive after the parent live state was cleared', () => {
    installTestWindow({ 'codex-web-local.selected-thread-id.v1': 'parent-thread' })
    const notify = installNotificationListener()
    const state = useDesktopState()
    state.startPolling()

    notify({
      method: 'thread/started',
      params: {
        thread: {
          id: 'agent-thread',
          agentNickname: 'Noether',
          source: {
            subAgent: {
              thread_spawn: {
                parent_thread_id: 'parent-thread',
                depth: 1,
                agent_nickname: 'Noether',
              },
            },
          },
        },
      },
      atIso: '2026-05-20T00:00:00.000Z',
    })
    notify({
      method: 'item/completed',
      params: {
        threadId: 'parent-thread',
        turnId: 'parent-turn',
        item: {
          type: 'collabAgentToolCall',
          id: 'collab-restore',
          tool: 'wait',
          status: 'inProgress',
          senderThreadId: 'parent-thread',
          receiverThreadIds: ['agent-thread'],
          prompt: null,
          agentsStates: {
            'agent-thread': { status: 'running', message: 'Initial task' },
          },
        },
      },
      atIso: '2026-05-20T00:00:01.000Z',
    })
    notify({
      method: 'turn/completed',
      params: {
        threadId: 'parent-thread',
        turnId: 'parent-turn',
        turn: { id: 'parent-turn', status: 'completed', items: [], error: null },
      },
      atIso: '2026-05-20T00:00:02.000Z',
    })

    expect(state.selectedLiveOverlay.value?.collabAgents[0]).toMatchObject({
      name: 'Noether',
      task: 'Initial task',
      status: 'running',
    })

    notify({
      method: 'item/reasoning/summaryTextDelta',
      params: {
        threadId: 'agent-thread',
        turnId: 'agent-turn',
        itemId: 'reasoning-restore',
        summaryIndex: 0,
        delta: 'Still checking files after parent completion.',
      },
      atIso: '2026-05-20T00:00:03.000Z',
    })

    expect(state.selectedLiveOverlay.value?.collabAgents[0]).toMatchObject({
      name: 'Noether',
      task: 'Still checking files after parent completion.',
      status: 'running',
      details: {
        reasoningSummary: 'Still checking files after parent completion.',
      },
    })
  })
})

describe('MCP live status', () => {
  it('keeps server, tool, duration, and error metadata on realtime MCP activity', () => {
    installTestWindow({ 'codex-web-local.selected-thread-id.v1': 'target-thread' })
    const notify = installNotificationListener()
    const state = useDesktopState()
    state.startPolling()

    notify({
      method: 'turn/started',
      params: { threadId: 'target-thread', turnId: 'turn-1' },
      atIso: '2026-05-29T00:00:00.000Z',
    })
    notify({
      method: 'item/started',
      params: {
        threadId: 'target-thread',
        turnId: 'turn-1',
        item: {
          type: 'mcpToolCall',
          id: 'mcp-1',
          server: 'context7',
          tool: 'query-docs',
          status: 'running',
        },
      },
      atIso: '2026-05-29T00:00:01.000Z',
    })
    notify({
      method: 'item/completed',
      params: {
        threadId: 'target-thread',
        turnId: 'turn-1',
        item: {
          type: 'mcpToolCall',
          id: 'mcp-1',
          server: 'context7',
          tool: 'query-docs',
          status: 'failed',
          durationMs: 1420.6,
          error: { message: 'Docs unavailable' },
        },
      },
      atIso: '2026-05-29T00:00:02.000Z',
    })

    expect(state.selectedLiveOverlay.value?.mcpActivities).toEqual([
      expect.objectContaining({
        id: 'mcp-1',
        name: 'context7 MCP',
        server: 'context7',
        tool: 'query-docs',
        status: 'failed',
        durationMs: 1421,
        errorMessage: 'Docs unavailable',
        detail: 'Docs unavailable',
      }),
    ])
  })

  it('builds MCP activity metadata from pending MCP server requests', async () => {
    installTestWindow({ 'codex-web-local.selected-thread-id.v1': 'target-thread' })
    gatewayMocks.getPendingServerRequests.mockResolvedValue([
      {
        id: 1,
        method: 'mcpServer/elicitation/request',
        threadId: 'target-thread',
        turnId: 'turn-1',
        params: {
          threadId: 'target-thread',
          serverName: 'browser',
          mode: 'url',
          message: 'Open browser login?',
        },
        receivedAtIso: '2026-05-29T00:00:00.000Z',
      },
      {
        id: 2,
        method: 'item/tool/call',
        threadId: 'target-thread',
        turnId: 'turn-1',
        params: {
          tool: 'mcp__context7__query_docs',
          duration_ms: 900,
          errorMessage: 'Waiting on docs',
        },
        receivedAtIso: '2026-05-29T00:00:01.000Z',
      },
    ])
    const state = useDesktopState()
    state.startPolling()

    await flushAsyncWork()

    expect(state.selectedLiveOverlay.value?.mcpActivities).toEqual([
      expect.objectContaining({
        id: 'request:1',
        name: 'browser MCP',
        server: 'browser',
        status: 'waiting',
        detail: 'Open browser login?',
      }),
      expect.objectContaining({
        id: 'request:2',
        name: 'context7 MCP',
        server: 'context7 MCP',
        tool: 'query docs',
        status: 'running',
        durationMs: 900,
        errorMessage: 'Waiting on docs',
        detail: 'Waiting on docs',
      }),
    ])
  })
})

describe('Codex CLI availability', () => {
  it('surfaces a chat runtime error when the app-server bridge cannot find Codex CLI', async () => {
    installTestWindow()
    gatewayMocks.getThreadGroupsPage.mockRejectedValue(new Error('Codex CLI is not available. Install @openai/codex or set CODEXUI_CODEX_COMMAND.'))

    const state = useDesktopState()

    await state.refreshAll({ awaitAncillaryRefreshes: true })

    expect(state.codexCliMissingError.value).toBe('Codex CLI not found. Install @openai/codex or set CODEXUI_CODEX_COMMAND.')
  })

  it('clears a previous Codex CLI missing banner when a later refresh fails for another reason', async () => {
    installTestWindow()
    gatewayMocks.getThreadGroupsPage
      .mockRejectedValueOnce(new Error('Codex CLI is not available. Install @openai/codex or set CODEXUI_CODEX_COMMAND.'))
      .mockRejectedValueOnce(new Error('Connection lost'))

    const state = useDesktopState()

    await state.refreshAll({ awaitAncillaryRefreshes: true })
    expect(state.codexCliMissingError.value).toBe('Codex CLI not found. Install @openai/codex or set CODEXUI_CODEX_COMMAND.')

    await state.refreshAll({ awaitAncillaryRefreshes: true })
    expect(state.error.value).toBe('Connection lost')
    expect(state.codexCliMissingError.value).toBe('')
  })
})

describe('startup request deduplication', () => {
  it('reloads cached thread titles on forced thread refresh', async () => {
    installTestWindow()
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({
      groups: [{ projectName: 'Project', threads: [thread('thread-1', '/tmp/project')] }],
      nextCursor: null,
    })
    gatewayMocks.getThreadTitleCache
      .mockResolvedValueOnce({ titles: {} })
      .mockResolvedValueOnce({ titles: { 'thread-1': 'Imported title' } })

    const state = useDesktopState()
    await state.refreshAll({ includeSelectedThreadMessages: false })
    expect(state.projectGroups.value[0]?.threads[0]?.title).toBe('thread-1')

    await state.refreshAll({ includeSelectedThreadMessages: false, forceThreadRefresh: true })

    expect(gatewayMocks.getThreadTitleCache).toHaveBeenCalledTimes(2)
    expect(state.projectGroups.value[0]?.threads[0]?.title).toBe('Imported title')
  })

  it('reuses a just-loaded thread list during startup refresh bursts', async () => {
    installTestWindow()
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000)
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({
      groups: [{ projectName: 'Project', threads: [thread('thread-1', '/tmp/project')] }],
      nextCursor: null,
    })

    try {
      const state = useDesktopState()
      await state.refreshAll({ includeSelectedThreadMessages: false })
      await state.refreshAll({ includeSelectedThreadMessages: false })

      expect(gatewayMocks.getThreadGroupsPage).toHaveBeenCalledTimes(1)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('reuses a just-loaded skills list for the same selected cwd', async () => {
    installTestWindow()
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000)
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({
      groups: [{ projectName: 'Project', threads: [thread('thread-1', '/tmp/project')] }],
      nextCursor: null,
    })
    gatewayMocks.getAvailableCollaborationModes.mockResolvedValue([{ value: 'default', label: 'Default' }])
    gatewayMocks.getSkillsList.mockResolvedValue([
      {
        name: 'example',
        description: 'Example skill',
        path: '/tmp/project/.agents/skills/example/SKILL.md',
        scope: 'project',
        enabled: true,
      },
    ])
    gatewayMocks.getAccountRateLimits.mockResolvedValue(null)
    gatewayMocks.getCurrentModelConfig.mockResolvedValue({
      model: 'gpt-5.5',
      providerId: '',
      reasoningEffort: 'medium',
      speedMode: 'standard',
    })
    gatewayMocks.getAvailableModelIds.mockResolvedValue(['gpt-5.5'])

    try {
      const state = useDesktopState()
      state.primeSelectedThread('thread-1')
      await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })
      await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })

      expect(gatewayMocks.getSkillsList).toHaveBeenCalledTimes(1)
      expect(gatewayMocks.getSkillsList).toHaveBeenCalledWith(['/tmp/project'])
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('reuses a just-loaded empty skills list for the same selected cwd', async () => {
    installTestWindow()
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000)
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({
      groups: [{ projectName: 'Project', threads: [thread('thread-1', '/tmp/project')] }],
      nextCursor: null,
    })
    gatewayMocks.getAvailableCollaborationModes.mockResolvedValue([{ value: 'default', label: 'Default' }])
    gatewayMocks.getSkillsList.mockResolvedValue([])
    gatewayMocks.getAccountRateLimits.mockResolvedValue(null)
    gatewayMocks.getCurrentModelConfig.mockResolvedValue({
      model: 'gpt-5.5',
      providerId: '',
      reasoningEffort: 'medium',
      speedMode: 'standard',
    })
    gatewayMocks.getAvailableModelIds.mockResolvedValue(['gpt-5.5'])

    try {
      const state = useDesktopState()
      state.primeSelectedThread('thread-1')
      await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })
      await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })

      expect(gatewayMocks.getSkillsList).toHaveBeenCalledTimes(1)
      expect(state.installedSkills.value).toEqual([])
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('bypasses recent thread-list reuse for event-driven thread refreshes', async () => {
    installTestWindow()
    let notificationHandler: ((notification: { method: string; params?: unknown }) => void) | undefined
    gatewayMocks.subscribeCodexNotifications.mockImplementation((handler) => {
      notificationHandler = handler as typeof notificationHandler
      return vi.fn()
    })
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000)
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({
      groups: [{ projectName: 'Project', threads: [thread('thread-1', '/tmp/project')] }],
      nextCursor: null,
    })

    try {
      const state = useDesktopState()
      await state.refreshAll({ includeSelectedThreadMessages: false })
      const callsBeforeNotification = gatewayMocks.getThreadGroupsPage.mock.calls.length
      state.startPolling()

      expect(notificationHandler).toBeDefined()
      notificationHandler!({
        method: 'thread/name/updated',
        params: {
          threadId: 'thread-1',
          threadName: 'Updated title',
        },
      })

      const callbacks = scheduledWindowTimeoutCallbacks()
      callbacks.at(-1)?.()
      await flushAsyncWork()

      expect(gatewayMocks.getThreadGroupsPage.mock.calls.length).toBeGreaterThan(callsBeforeNotification)
    } finally {
      nowSpy.mockRestore()
    }
  })
})

describe('thread selection refresh', () => {
  it('replaces a persisted selected thread when it is absent from the refreshed thread list', async () => {
    installTestWindow({
      'codex-web-local.selected-thread-id.v1': 'missing-thread',
    })
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({
      groups: [
        {
          projectName: 'Project',
          threads: [thread('available-thread', '/tmp/project')],
        },
      ],
      nextCursor: null,
    })

    const state = useDesktopState()

    await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })

    expect(state.selectedThreadId.value).toBe('available-thread')
    expect(window.localStorage.getItem('codex-web-local.selected-thread-id.v1')).toBe('available-thread')
  })

  it('can refresh the thread list without auto-selecting a fallback thread', async () => {
    installTestWindow({
      'codex-web-local.selected-thread-id.v1': 'thread-a',
    })
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({
      groups: [
        {
          projectName: 'Project',
          threads: [thread('available-thread', '/tmp/project')],
        },
      ],
      nextCursor: null,
    })

    const state = useDesktopState()
    state.primeSelectedThread('', { persist: false })

    await state.refreshAll({
      includeSelectedThreadMessages: false,
      awaitAncillaryRefreshes: true,
      autoSelectThreadFallback: false,
    })

    expect(state.selectedThreadId.value).toBe('')
    expect(window.localStorage.getItem('codex-web-local.selected-thread-id.v1')).toBe('thread-a')
  })
})

describe('thread loading stability', () => {
  it('drops optimistic user messages once an equivalent persisted user message arrives', () => {
    const previous = [
      {
        id: 'optimistic-user',
        role: 'user' as const,
        text: 'Summarize this file',
        images: ['blob:image-1'],
        fileAttachments: [{ label: 'notes.md', path: '/tmp/project/notes.md', fsPath: '/tmp/project/notes.md' }],
        messageType: 'userMessage.optimistic',
      },
      {
        id: 'live-assistant',
        role: 'assistant' as const,
        text: 'Thinking...',
        messageType: 'agentMessage.live',
      },
    ]
    const incoming = [
      {
        id: 'persisted-user',
        role: 'user' as const,
        text: '  Summarize   this file ',
        images: ['blob:image-1'],
        fileAttachments: [{ label: 'notes.md', path: '/tmp/project/notes.md', fsPath: '/tmp/project/notes.md' }],
      },
      {
        id: 'persisted-assistant',
        role: 'assistant' as const,
        text: 'Summary ready.',
      },
    ]

    const merged = mergeMessages(previous, incoming, { preserveMissing: true })

    expect(merged).toEqual([
      previous[1],
      incoming[0],
      incoming[1],
    ])
    expect(merged).not.toContain(previous[0])
  })

  it('returns not-found and surfaces an in-chat error when the selected thread is missing', async () => {
    installTestWindow()
    gatewayMocks.resumeThread.mockRejectedValue(
      new Error('RPC thread/read failed with HTTP 404: thread not found: missing-thread'),
    )
    gatewayMocks.getAvailableModelIds.mockResolvedValue(['gpt-5.5'])
    gatewayMocks.getCurrentModelConfig.mockResolvedValue({
      model: 'gpt-5.5',
      providerId: '',
      reasoningEffort: 'medium',
      speedMode: 'standard',
    })
    gatewayMocks.getSkillsList.mockResolvedValue([])

    const state = useDesktopState()

    await expect(state.selectThread('missing-thread')).resolves.toBe('not-found')
    expect(state.selectedThreadId.value).toBe('missing-thread')
    expect(state.selectedLiveOverlay.value?.errorText).toContain('thread not found')
  })

  it('refreshes an already loaded active thread after a dirty completion notification', async () => {
    installTestWindow({ 'codex-web-local.selected-thread-id.v1': 'active-thread' })
    const notify = installNotificationListener()
    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValue(1_000)
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({
      groups: [{ projectName: 'Project', threads: [thread('active-thread', '/tmp/project')] }],
      nextCursor: null,
    })
    gatewayMocks.resumeThread.mockResolvedValue({
      model: 'gpt-5.5',
      modelProvider: '',
      messages: [{ id: 'user-1', role: 'user', text: 'Initial prompt' }],
      inProgress: false,
      activeTurnId: '',
      hasMoreOlder: false,
      turnIndexByTurnId: {},
      collabAgents: [],
    })
    gatewayMocks.getThreadDetail.mockResolvedValue({
      model: 'gpt-5.5',
      modelProvider: '',
      messages: [
        { id: 'user-1', role: 'user', text: 'Initial prompt' },
        { id: 'assistant-1', role: 'assistant', text: 'Completed answer' },
      ],
      inProgress: false,
      activeTurnId: '',
      hasMoreOlder: false,
      turnIndexByTurnId: {},
      collabAgents: [],
    })

    const state = useDesktopState()
    try {
      await state.loadMessages('active-thread')
      nowSpy.mockReturnValue(4_000)
      state.startPolling()

      notify({
        method: 'turn/completed',
        params: { threadId: 'active-thread', turnId: 'turn-1' },
        atIso: '2026-06-14T00:00:00.000Z',
      })
      for (const callback of scheduledWindowTimeoutCallbacks()) {
        callback()
      }
      await flushAsyncWork()

      expect(gatewayMocks.getThreadDetail).toHaveBeenCalledTimes(1)
      expect(state.messages.value).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'user-1', text: 'Initial prompt' }),
        expect.objectContaining({ id: 'assistant-1', text: 'Completed answer' }),
      ]))
    } finally {
      nowSpy.mockRestore()
    }
  })
})

describe('provider model selection', () => {
  it('ignores global selected-model localStorage when OpenCode Zen is the active provider', async () => {
    installTestWindow({
      'codex-web-local.selected-model-by-context.v1': JSON.stringify({
        '__new-thread__': 'gpt-5.5',
      }),
      'codex-web-local.selected-model-id.v1': 'gpt-5.5',
    })
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({ groups: [], nextCursor: null })
    gatewayMocks.getAvailableCollaborationModes.mockResolvedValue([{ value: 'default', label: 'Default' }])
    gatewayMocks.getSkillsList.mockResolvedValue([])
    gatewayMocks.getAccountRateLimits.mockResolvedValue(null)
    gatewayMocks.getCurrentModelConfig.mockResolvedValue({
      model: 'big-pickle',
      providerId: 'opencode-zen',
      reasoningEffort: 'medium',
      speedMode: 'standard',
    })
    gatewayMocks.getAvailableModelIds.mockResolvedValue([
      'big-pickle',
      'deepseek-v4-flash-free',
      'ring-2.6-1t-free',
    ])

    const state = useDesktopState()
    await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })

    expect(gatewayMocks.getAvailableModelIds).toHaveBeenCalledWith({
      includeProviderModels: true,
      requireProviderModels: true,
      providerId: 'opencode-zen',
    })
    expect(state.availableModelIds.value).toEqual([
      'big-pickle',
      'deepseek-v4-flash-free',
      'ring-2.6-1t-free',
    ])
    expect(state.selectedModelId.value).toBe('big-pickle')
    expect(state.readModelIdForThread('').trim()).toBe('big-pickle')
    expect(JSON.parse(window.localStorage.getItem('codex-web-local.selected-model-by-context.v1') ?? '{}')).toEqual({
      '__new-thread-provider__::opencode-zen': 'big-pickle',
    })
    expect(window.localStorage.getItem('codex-web-local.selected-model-id.v1')).toBe(null)
  })

  it('restores a valid provider-scoped OpenCode Zen selected model from localStorage', async () => {
    installTestWindow({
      'codex-web-local.selected-model-by-context.v1': JSON.stringify({
        '__new-thread-provider__::opencode-zen': 'ring-2.6-1t-free',
      }),
    })
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({ groups: [], nextCursor: null })
    gatewayMocks.getAvailableCollaborationModes.mockResolvedValue([{ value: 'default', label: 'Default' }])
    gatewayMocks.getSkillsList.mockResolvedValue([])
    gatewayMocks.getAccountRateLimits.mockResolvedValue(null)
    gatewayMocks.getCurrentModelConfig.mockResolvedValue({
      model: 'big-pickle',
      providerId: 'opencode-zen',
      reasoningEffort: 'medium',
      speedMode: 'standard',
    })
    gatewayMocks.getAvailableModelIds.mockResolvedValue([
      'big-pickle',
      'deepseek-v4-flash-free',
      'ring-2.6-1t-free',
    ])

    const state = useDesktopState()
    await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })

    expect(state.availableModelIds.value).toEqual([
      'big-pickle',
      'deepseek-v4-flash-free',
      'ring-2.6-1t-free',
    ])
    expect(state.selectedModelId.value).toBe('ring-2.6-1t-free')
    expect(state.readModelIdForThread('').trim()).toBe('ring-2.6-1t-free')
    expect(JSON.parse(window.localStorage.getItem('codex-web-local.selected-model-by-context.v1') ?? '{}')).toEqual({
      '__new-thread-provider__::opencode-zen': 'ring-2.6-1t-free',
    })
  })

  it('keeps an existing OpenCode Zen thread locked to Zen models after Codex auth becomes active', async () => {
    installTestWindow()
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({
      groups: [{ projectName: 'Project', threads: [thread('legacy-zen-thread', '/tmp/project')] }],
      nextCursor: null,
    })
    gatewayMocks.getAvailableCollaborationModes.mockResolvedValue([{ value: 'default', label: 'Default' }])
    gatewayMocks.getSkillsList.mockResolvedValue([])
    gatewayMocks.getAccountRateLimits.mockResolvedValue(null)
    gatewayMocks.getCurrentModelConfig.mockResolvedValue({
      model: 'gpt-5.4-mini',
      providerId: '',
      reasoningEffort: 'medium',
      speedMode: 'standard',
    })
    gatewayMocks.getAvailableModelIds.mockImplementation(async (options?: { providerId?: string }) => {
      if (options?.providerId === 'opencode-zen') {
        return ['big-pickle', 'ring-2.6-1t-free']
      }
      return ['gpt-5.5', 'gpt-5.4-mini']
    })
    gatewayMocks.resumeThread.mockResolvedValue({
      model: 'gpt-5.4-mini',
      modelProvider: 'opencode_zen',
      messages: [],
      inProgress: false,
      activeTurnId: '',
      hasMoreOlder: false,
      turnIndexByTurnId: {},
      collabAgents: [],
    })

    const state = useDesktopState()
    state.primeSelectedThread('legacy-zen-thread')
    await state.loadMessages('legacy-zen-thread')
    await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })

    expect(gatewayMocks.getAvailableModelIds).toHaveBeenLastCalledWith({
      includeProviderModels: true,
      requireProviderModels: true,
      providerId: 'opencode-zen',
    })
    expect(state.availableModelIds.value).toEqual([
      'big-pickle',
      'ring-2.6-1t-free',
    ])
    expect(state.selectedModelId.value).toBe('big-pickle')
    expect(state.readModelIdForThread('legacy-zen-thread')).toBe('big-pickle')
    expect(state.readModelIdForThread('')).toBe('gpt-5.4-mini')
  })

  it('loads provider models for a selected provider-backed thread during scheduled refreshes', async () => {
    installTestWindow()
    vi.mocked(window.setTimeout).mockImplementation(((callback: TimerHandler) => {
      if (typeof callback === 'function') {
        void Promise.resolve().then(() => callback())
      }
      return 1
    }) as typeof window.setTimeout)
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({
      groups: [{ projectName: 'Project', threads: [thread('legacy-zen-thread', '/tmp/project')] }],
      nextCursor: null,
    })
    gatewayMocks.getAvailableCollaborationModes.mockResolvedValue([{ value: 'default', label: 'Default' }])
    gatewayMocks.getSkillsList.mockResolvedValue([])
    gatewayMocks.getAccountRateLimits.mockResolvedValue(null)
    gatewayMocks.getCurrentModelConfig.mockResolvedValue({
      model: 'gpt-5.4-mini',
      providerId: '',
      reasoningEffort: 'medium',
      speedMode: 'standard',
    })
    gatewayMocks.getAvailableModelIds.mockImplementation(async (options?: { providerId?: string }) => {
      if (options?.providerId === 'opencode-zen') {
        return ['big-pickle', 'ring-2.6-1t-free']
      }
      return ['gpt-5.5', 'gpt-5.4-mini']
    })
    gatewayMocks.resumeThread.mockResolvedValue({
      model: 'gpt-5.4-mini',
      modelProvider: 'opencode_zen',
      messages: [],
      inProgress: false,
      activeTurnId: '',
      hasMoreOlder: false,
      turnIndexByTurnId: {},
      collabAgents: [],
    })

    const state = useDesktopState()
    state.primeSelectedThread('legacy-zen-thread')
    await state.loadMessages('legacy-zen-thread')
    await state.refreshAll({ includeSelectedThreadMessages: false })
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0))

    expect(gatewayMocks.getAvailableModelIds).toHaveBeenLastCalledWith({
      includeProviderModels: true,
      requireProviderModels: true,
      providerId: 'opencode-zen',
    })
    expect(state.availableModelIds.value).toEqual(['big-pickle', 'ring-2.6-1t-free'])
    expect(state.selectedModelId.value).toBe('big-pickle')
  })

  it('captures the active provider when creating a new thread', async () => {
    installTestWindow()
    gatewayMocks.getThreadGroupsPage.mockResolvedValue({ groups: [], nextCursor: null })
    gatewayMocks.getAvailableCollaborationModes.mockResolvedValue([{ value: 'default', label: 'Default' }])
    gatewayMocks.getSkillsList.mockResolvedValue([])
    gatewayMocks.getAccountRateLimits.mockResolvedValue(null)
    gatewayMocks.getCurrentModelConfig.mockResolvedValue({
      model: 'gpt-5.5',
      providerId: '',
      reasoningEffort: 'medium',
      speedMode: 'standard',
    })
    gatewayMocks.getAvailableModelIds.mockResolvedValue(['gpt-5.5', 'gpt-5.4-mini'])
    gatewayMocks.startThread.mockResolvedValue({
      threadId: 'codex-thread',
      model: 'gpt-5.5',
      modelProvider: 'openai',
    })
    gatewayMocks.startThreadTurn.mockResolvedValue('turn-1')
    gatewayMocks.getThreadDetail.mockResolvedValue({
      model: 'gpt-5.5',
      modelProvider: 'openai',
      messages: [],
      inProgress: false,
      activeTurnId: '',
      hasMoreOlder: false,
      turnIndexByTurnId: {},
      collabAgents: [],
    })

    const state = useDesktopState()
    await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })
    const threadId = await state.sendMessageToNewThread('hello', '/tmp/project')
    await state.loadMessages(threadId)
    await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })

    expect(gatewayMocks.getAvailableModelIds).toHaveBeenLastCalledWith({
      includeProviderModels: true,
      requireProviderModels: false,
      providerId: undefined,
    })
    expect(state.readModelIdForThread(threadId)).toBe('gpt-5.5')
  })
})

describe('findAdjacentThreadId', () => {
  it('selects the next thread after the archived thread', () => {
    const threads = [
      thread('first-thread', '/tmp/project'),
      thread('selected-thread', '/tmp/project'),
      thread('next-thread', '/tmp/project'),
    ]

    expect(findAdjacentThreadId(threads, 'selected-thread')).toBe('next-thread')
  })

  it('falls back to the previous thread when the last thread is archived', () => {
    const threads = [
      thread('previous-thread', '/tmp/project'),
      thread('selected-thread', '/tmp/project'),
    ]

    expect(findAdjacentThreadId(threads, 'selected-thread')).toBe('previous-thread')
  })

  it('returns no fallback when there is no adjacent thread', () => {
    expect(findAdjacentThreadId([thread('selected-thread', '/tmp/project')], 'selected-thread')).toBe('')
  })
})
