import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { RequestGatewayDependencies } from './request-gateway-dependencies.js'
import { workspaceBrowser, WORKSPACE_HANDOFF, WORKSPACE_BROWSER_STARTED_AT } from './workspace-browser.js'

const native = vi.hoisted(() => ({
  trusted: true,
  execute: vi.fn(),
  stat: vi.fn(),
}))
vi.mock('vscode', () => ({
  workspace: {
    get isTrusted() {
      return native.trusted
    },
  },
  commands: { executeCommand: native.execute },
  Uri: { file: (path: string) => ({ fsPath: path }) },
}))
vi.mock('node:fs/promises', () => ({ stat: native.stat }))

interface BrowserFixture {
  readonly workspace: { path: string }
  readonly session: { cwd: string }
  readonly backend: { connection: { endpoint: { host: string }; pid?: number }; sessions: { open: Mock } }
  readonly history: Mock
  readonly get: Mock
  readonly update: Mock
  readonly ensure: Mock
  readonly request: (
    payload: Parameters<typeof workspaceBrowser>[1],
    signal?: AbortSignal,
  ) => Promise<unknown>
}

function fixture(): BrowserFixture {
  const workspace = { id: 'w1', name: 'Project', path: '/fixture/project', sessionCount: 1 }
  const session = { id: 's1', title: 'Task', workspaceId: 'w1', cwd: workspace.path, blank: false }
  const history = vi.fn().mockResolvedValue({
    events: [
      { event: { type: 'message.user', messageId: 'u1', markdown: 'fixture question' } },
      { event: { type: 'message.delta', messageId: 'a1', delta: 'fixture ' } },
      { event: { type: 'message.delta', messageId: 'a1', delta: 'reply' } },
    ],
    hasMore: true,
    beforeSequence: 20,
  })
  const get = vi.fn()
  const update = vi.fn().mockResolvedValue(undefined)
  const backend = {
    connection: {
      endpoint: { host: '127.0.0.1', port: 41234, baseUrl: 'http://127.0.0.1:41234' },
      ownership: 'external',
      pid: 123,
    },
    sessions: { list: vi.fn().mockResolvedValue({ items: [session] }), history, open: vi.fn() },
    workspaces: { listArchivedSessionIds: vi.fn().mockResolvedValue([]) },
  }
  const ensure = vi.fn().mockResolvedValue({ id: 'temporary' })
  const deps = {
    backendService: { requireBackend: () => backend },
    workspaceUseCases: { list: vi.fn().mockResolvedValue([workspace]) },
    listCurrentWorkspaces: vi.fn().mockResolvedValue([workspace]),
    currentWorkspaceFolders: () => [{ uri: { fsPath: workspace.path } }],
    context: { globalState: { get, update } },
    ensureCurrentWorkspace: ensure,
  } as unknown as RequestGatewayDependencies
  const request = (
    payload: Parameters<typeof workspaceBrowser>[1],
    signal = new AbortController().signal,
  ): Promise<unknown> => workspaceBrowser(deps, payload, signal)
  return { workspace, session, backend, history, get, update, ensure, request }
}

beforeEach(() => {
  vi.clearAllMocks()
  native.trusted = true
  native.stat.mockResolvedValue({ isDirectory: () => true })
})

describe('workspace browser Host boundary', () => {
  it('returns directory metadata without paths and previews without activating a session', async () => {
    const f = fixture()
    expect(await f.request({ action: 'list' })).toEqual({
      items: [{ id: 'w1', name: 'Project', count: 1, current: true, canOpen: true }],
    })
    expect(
      await f.request({ action: 'preview', workspaceId: 'w1', sessionId: 's1', beforeSequence: 40 }),
    ).toEqual({
      title: 'Task',
      items: [
        { id: 'u1', role: 'user', text: 'fixture question' },
        { id: 'a1', role: 'assistant', text: 'fixture reply' },
      ],
      hasMore: true,
      beforeSequence: 20,
    })
    expect(f.history).toHaveBeenCalledWith('s1', 40, expect.any(AbortSignal), {
      pageSize: 30,
      pagePurpose: 'transcript',
    })
    expect(f.backend.sessions.open).not.toHaveBeenCalled()
    expect(native.execute).not.toHaveBeenCalled()
  })

  it('omits producer-owned context using source metadata while retaining authored prompts and replies', async () => {
    const f = fixture()
    const authored = 'Explain <system-reminder> and <available_skills>; this is an authored question.'
    const repeatedText = 'Runtime context fixture'
    f.history.mockResolvedValue({
      events: [
        {
          event: { type: 'message.user', messageId: 'u1', source: 'user', markdown: authored },
        },
        ...['plugin', 'agent', 'command', 'session-reference', 'user-question-reply', 'future-source'].map(
          (source) => ({
            event: {
              type: 'message.user',
              messageId: `context-${source}`,
              source,
              sourceForm: 'snapshot',
              markdown: repeatedText,
            },
          }),
        ),
        { event: { type: 'message.user', messageId: 'legacy-user', markdown: repeatedText } },
        { event: { type: 'message.delta', messageId: 'a1', delta: 'partial reply' } },
        { event: { type: 'message.completed', messageId: 'a1', markdown: 'Authored question answered.' } },
      ],
      hasMore: false,
      beforeSequence: 5,
    })

    expect(await f.request({ action: 'preview', workspaceId: 'w1', sessionId: 's1' })).toEqual({
      title: 'Task',
      items: [
        { id: 'u1', role: 'user', text: authored },
        { id: 'legacy-user', role: 'user', text: repeatedText },
        { id: 'a1', role: 'assistant', text: 'Authored question answered.' },
      ],
      hasMore: false,
      beforeSequence: 5,
    })
    expect(f.backend.sessions.open).not.toHaveBeenCalled()
    expect(native.execute).not.toHaveBeenCalled()
  })

  it('retains the raw page cursor when a page contains only hidden context', async () => {
    const f = fixture()
    f.history
      .mockResolvedValueOnce({
        events: [
          {
            event: {
              type: 'message.user',
              messageId: 'context-1',
              source: 'plugin',
              markdown: 'Fixture environment and skills snapshot.',
            },
          },
        ],
        hasMore: true,
        beforeSequence: 20,
      })
      .mockResolvedValueOnce({
        events: [{ event: { type: 'message.user', messageId: 'older-user', markdown: 'Earlier question.' } }],
        hasMore: false,
        beforeSequence: 10,
      })

    expect(await f.request({ action: 'preview', workspaceId: 'w1', sessionId: 's1' })).toMatchObject({
      items: [],
      hasMore: true,
      beforeSequence: 20,
    })
    expect(
      await f.request({ action: 'preview', workspaceId: 'w1', sessionId: 's1', beforeSequence: 20 }),
    ).toMatchObject({
      items: [{ id: 'older-user', role: 'user', text: 'Earlier question.' }],
      hasMore: false,
      beforeSequence: 10,
    })
    expect(f.history).toHaveBeenLastCalledWith('s1', 20, expect.any(AbortSignal), {
      pageSize: 30,
      pagePurpose: 'transcript',
    })
  })

  it('rejects unknown workspaces and sessions before reading history or opening folders', async () => {
    const f = fixture()
    for (const payload of [
      { action: 'preview', workspaceId: 'foreign', sessionId: 's1' },
      { action: 'open', workspaceId: 'w1', sessionId: 'foreign' },
    ] as const)
      await expect(f.request(payload)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(f.history).not.toHaveBeenCalled()
    expect(native.stat).not.toHaveBeenCalled()
    expect(native.execute).not.toHaveBeenCalled()
  })

  it('opens only the registry path in a new window and stores a validated handoff', async () => {
    const f = fixture()
    await f.request({ action: 'open', workspaceId: 'w1', sessionId: 's1' })
    expect(native.stat).toHaveBeenCalledWith(f.workspace.path)
    expect(f.update).toHaveBeenCalledWith(WORKSPACE_HANDOFF, {
      path: f.workspace.path,
      sessionId: 's1',
      time: expect.any(Number) as unknown,
    })
    expect(native.execute).toHaveBeenCalledWith(
      'vscode.openFolder',
      { fsPath: f.workspace.path },
      { forceNewWindow: true },
    )
  })

  it('refuses file access for remote instances, untrusted workspaces, mismatched cwd and cancellation', async () => {
    const payload = { action: 'open', workspaceId: 'w1', sessionId: 's1' } as const
    const remote = fixture()
    remote.backend.connection.endpoint.host = 'remote.example'
    await expect(remote.request(payload)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    const forwarded = fixture()
    delete forwarded.backend.connection.pid
    expect(await forwarded.request({ action: 'list' })).toMatchObject({
      items: [{ canOpen: false }],
    })
    await expect(forwarded.request(payload)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(native.stat).not.toHaveBeenCalled()
    const untrusted = fixture()
    native.trusted = false
    await expect(untrusted.request(payload)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    await expect(untrusted.request({ action: 'temporary' })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    })
    expect(untrusted.ensure).not.toHaveBeenCalled()
    native.trusted = true
    const mismatch = fixture()
    mismatch.session.cwd = '/fixture/other'
    await expect(mismatch.request(payload)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    const controller = new AbortController()
    controller.abort()
    await expect(fixture().request(payload, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(native.execute).not.toHaveBeenCalled()
  })

  it('resumes only a current, recent, catalog-owned handoff and consumes it once', async () => {
    const f = fixture()
    f.get.mockReturnValue({ path: f.workspace.path, sessionId: 's1', time: Date.now() - 600_000 })
    expect(await f.request({ action: 'resume' })).toEqual({})
    f.get.mockReturnValue({ path: '/fixture/other', sessionId: 's1', time: WORKSPACE_BROWSER_STARTED_AT - 1 })
    expect(await f.request({ action: 'resume' })).toEqual({})
    f.get.mockReturnValue({
      path: f.workspace.path,
      sessionId: 'foreign',
      time: WORKSPACE_BROWSER_STARTED_AT - 1,
    })
    expect(await f.request({ action: 'resume' })).toEqual({})
    expect(f.update).not.toHaveBeenCalled()
    f.get.mockReturnValue({ path: f.workspace.path, sessionId: 's1', time: WORKSPACE_BROWSER_STARTED_AT + 1 })
    expect(await f.request({ action: 'resume' })).toEqual({})
    f.get.mockReturnValue({ path: f.workspace.path, sessionId: 's1', time: WORKSPACE_BROWSER_STARTED_AT - 1 })
    expect(await f.request({ action: 'resume' })).toEqual({ sessionId: 's1' })
    expect(f.update).toHaveBeenCalledWith(WORKSPACE_HANDOFF, undefined)
    expect(f.backend.sessions.open).not.toHaveBeenCalled()
  })
})
