// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import type { HostMessage, FeatureHostMessage, WebviewRequest } from '@dsh-vscode/webview-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppState, AppStore, DshSettingsSnapshot, OpenFileCandidate } from './app/store.js'
import type * as StoreModule from './app/store.js'

let currentStore: AppStore

vi.mock('./app/store.js', () => ({
  createAppStore: () => currentStore,
}))

vi.mock('./features/chat/Timeline.js', () => ({
  Timeline: (props: {
    readonly transcriptView?: string
    readonly performanceUsage?: string
    readonly codingToolsEnabled?: boolean
  }) => (
    <div
      data-testid="timeline"
      data-transcript-view={props.transcriptView}
      data-performance-usage={props.performanceUsage}
      data-coding-tools-enabled={props.codingToolsEnabled}
    >
      Timeline
    </div>
  ),
}))

import { App } from './App.js'
import { CONVERSATION_FONT_SIZE_STORAGE_KEY, THEME_PREFERENCE_STORAGE_KEY } from './app/ui-preferences.js'
import { I18nProvider, LOCALE_EXPLICIT_STORAGE_KEY, LOCALE_STORAGE_KEY, useI18n } from './i18n.js'

function connectedState(activeSession: boolean): AppState {
  return {
    // The connection snapshot is a safe Host projection, not the full
    // Extension Host backend object.
    backend: { kind: 'connected' },
    connectionEpoch: 1,
    connectedDshVersion: '0.1.0-rc.6',
    subagentImagePrompts: false,
    dshCompatibilityWarning: undefined,
    dshUpdate: undefined,
    dshUpdateProgress: undefined,
    sessions: activeSession
      ? [
          {
            id: 's1',
            title: 'Session',
            workspaceId: 'w1',
            blank: false,
            status: 'idle',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ]
      : [],
    archivedSessionIds: [],
    archivedSessions: [],
    workspaces: [
      {
        id: 'w1',
        name: 'Workspace',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        sessionIds: activeSession ? ['s1'] : [],
        sessionCount: activeSession ? 1 : 0,
      },
    ],
    activeSessionId: activeSession ? 's1' : undefined,
    pendingSession: undefined,
    preferredOpenFileId: undefined,
    timeline: { sessionId: activeSession ? 's1' : undefined, nodes: [], lastSequence: -1 },
    historyHasMore: false,
    historyBeforeSequence: undefined,
    historyLoading: false,
    projections: {},
    configuration: activeSession
      ? {
          preset: 'standard',
          toolMode: 'native',
          permissionPreset: 'workspace-write',
          planMode: false,
          model: { providerId: '', modelId: '' },
        }
      : undefined,
    providers: [],
    models: [],
    sessionModels: [],
    sessionModelFailures: [],
    sessionModelCurrent: undefined,
    sessionModelRoutable: undefined,
    sessionModelDirectoryLoading: false,
    sessionModelDirectoryError: undefined,
    presets: [],
    permissionPresets: [],
    commands: [],
    pluginInventoryRevision: 0,
    pluginInstallProgress: undefined,
    pluginInstallOperation: undefined,
    accountLifecycleAvailable: false,
    accountLifecycle: null,
    accountLifecycleLoading: false,
    accountLifecycleBusy: false,
    accountLifecycleImpact: undefined,
    accountSessionExpired: false,
    accountLifecycleError: undefined,
    accountLifecycleRequestFailed: false,
    accountProfileDetails: null,
    accountProfileLoading: false,
    accountProfileRequestFailed: false,
    goals: [],
    todos: [],
    jobs: [],
    jobControllerAvailable: false,
    jobFollow: undefined,
    feedback: {},
    subagents: { entries: [], parentAvailable: false },
    activeSubagent: undefined,
    queue: [],
    editorContext: [],
    editorContextAvailableKinds: [],
    editorContextLoading: false,
    changes: [],
    changesLoading: false,
    changesRefreshFailed: false,
    tasks: [],
    tasksLoading: false,
    taskScope: 'current-session',
    tasksComplete: true,
    tasksOmittedSessions: 0,
    checkpoints: [],
    checkpointsLoading: false,
    promptTemplates: [],
    promptTemplatesLoading: false,
    promptMode: 'ask',
    permissions: [],
    questions: [],
    busyEnter: 'queue',
    drawer: undefined,
    surface: undefined,
    editorChats: 0,
  }
}

function dshUiSettingsSnapshot(
  enabled?: boolean,
  busyEnter?: 'queue' | 'steer',
  performanceUsage?: 'compact' | 'detailed',
): DshSettingsSnapshot {
  const fields: DshSettingsSnapshot['schema']['fields'][number][] = []
  const values: Record<string, unknown> = {}
  if (enabled !== undefined) {
    fields.push({
      path: 'ui-settings.enabled',
      label: 'enabled',
      type: 'boolean',
      required: false,
      restartRequired: false,
    })
    values['ui-settings'] = { enabled }
  }
  if (busyEnter !== undefined) {
    fields.push({
      path: 'ui-conversation.busyEnter',
      label: 'busyEnter',
      type: 'enum',
      required: false,
      enumValues: ['queue', 'steer'],
      restartRequired: false,
    })
    values['ui-conversation'] = { busyEnter }
  }
  if (performanceUsage !== undefined) {
    fields.push({
      path: 'ui-chat.performanceUsage',
      label: 'performanceUsage',
      type: 'enum',
      required: false,
      enumValues: ['compact', 'detailed'],
      restartRequired: false,
    })
    values['ui-chat'] = { performanceUsage }
  }
  return {
    schema: {
      version: 'rc2-settings-v1',
      writable: true,
      hasDocument: false,
      fields,
      namespaces: [
        ...(enabled === undefined
          ? []
          : [
              {
                ns: 'ui-settings',
                applies: 'live' as const,
                revision: 1,
                userFields: ['enabled'],
                secrets: [],
              },
            ]),
        ...(busyEnter === undefined
          ? []
          : [
              {
                ns: 'ui-conversation',
                applies: 'live' as const,
                revision: 1,
                userFields: ['busyEnter'],
                secrets: [],
              },
            ]),
        ...(performanceUsage === undefined
          ? []
          : [
              {
                ns: 'ui-chat',
                applies: 'live' as const,
                revision: 1,
                userFields: ['performanceUsage'],
                secrets: [],
              },
            ]),
      ],
    },
    values,
  }
}

function dshLocaleSettingsSnapshot(preference: string, advertised = true): DshSettingsSnapshot {
  const base = dshUiSettingsSnapshot()
  return {
    ...base,
    schema: {
      ...base.schema,
      fields: advertised
        ? [
            ...base.schema.fields,
            {
              path: 'locale.preference',
              label: 'preference',
              type: 'string',
              required: false,
              restartRequired: false,
            },
          ]
        : base.schema.fields,
      namespaces: advertised
        ? [
            ...base.schema.namespaces,
            {
              ns: 'locale',
              applies: 'live',
              revision: 1,
              userFields: ['preference'],
              secrets: [],
            },
          ]
        : base.schema.namespaces,
    },
    values: { locale: { preference } },
  }
}

function storeFor(state: AppState): AppStore {
  return {
    ...state,
    getState: () => state,
    subscribe: () => () => undefined,
    watchSessionTurnEnd: vi.fn(() => ({ completion: Promise.resolve(), dispose: vi.fn() })),
    initialize: vi.fn().mockResolvedValue(undefined),
    reconnect: vi.fn().mockResolvedValue(undefined),
    readDiagnostics: vi.fn().mockResolvedValue(undefined),
    showDiagnostics: vi.fn().mockResolvedValue(undefined),
    configureConnection: vi.fn().mockResolvedValue(undefined),
    startTemporaryChat: vi.fn().mockResolvedValue(undefined),
    workspaceBrowser: vi.fn().mockResolvedValue({ items: [] }),
    refreshSessions: vi.fn().mockResolvedValue(undefined),
    searchSessions: vi.fn().mockResolvedValue({ items: [] }),
    refreshCommands: vi.fn().mockResolvedValue(undefined),
    openSession: vi.fn().mockResolvedValue(undefined),
    openSessionInEditor: vi.fn().mockResolvedValue(undefined),
    runMovetoCommand: vi.fn().mockResolvedValue('editor'),
    loadOlderHistory: vi.fn().mockResolvedValue(undefined),
    navigateTranscript: vi.fn().mockResolvedValue(undefined),
    openTranscriptContent: vi.fn().mockResolvedValue(undefined),
    openSubagent: vi.fn().mockResolvedValue(undefined),
    renameSession: vi.fn().mockResolvedValue(undefined),
    renameWorkspace: vi.fn().mockResolvedValue(undefined),
    addWorkspaceFolder: vi.fn().mockResolvedValue(undefined),
    openSkillDocument: vi.fn().mockResolvedValue(undefined),
    removeWorkspace: vi.fn().mockResolvedValue(undefined),
    moveWorkspace: vi.fn().mockResolvedValue(undefined),
    moveSession: vi.fn().mockResolvedValue(undefined),
    forkSession: vi.fn().mockResolvedValue(undefined),
    createSession: vi.fn().mockResolvedValue(undefined),
    stageSession: vi.fn().mockResolvedValue(undefined),
    configurePendingSession: vi.fn(),
    sendPendingPrompt: vi.fn().mockResolvedValue(undefined),
    removeSession: vi.fn().mockResolvedValue(undefined),
    loadArchivedSessions: vi.fn().mockResolvedValue(undefined),
    restoreSession: vi.fn().mockResolvedValue(undefined),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    configureSession: vi.fn(),
    executeCommand: vi.fn(),
    sendPrompt: vi.fn().mockResolvedValue(undefined),
    cancelSession: vi.fn().mockResolvedValue(undefined),
    followJob: vi.fn().mockResolvedValue(undefined),
    stopFollowingJob: vi.fn().mockResolvedValue(undefined),
    killJob: vi.fn().mockResolvedValue('requested'),
    updateQueue: vi.fn(),
    removeQueue: vi.fn(),
    steerQueue: vi.fn(),
    steerAllQueued: vi.fn().mockResolvedValue(undefined),
    loadFeedback: vi.fn().mockResolvedValue(undefined),
    ensureFeedback: vi.fn().mockResolvedValue(undefined),
    toggleFeedback: vi.fn().mockResolvedValue(undefined),
    submitFeedback: vi.fn().mockResolvedValue(undefined),
    setFeedbackNote: vi.fn().mockResolvedValue(undefined),
    removeFeedback: vi.fn().mockResolvedValue(undefined),
    listReferences: vi.fn().mockResolvedValue([]),
    respondToPermission: vi.fn(),
    respondToQuestion: vi.fn(),
    cancelQuestion: vi.fn(),
    captureEditorContext: vi.fn().mockResolvedValue(undefined),
    refreshEditorContext: vi.fn().mockResolvedValue(undefined),
    previewEditorContext: vi.fn().mockResolvedValue(undefined),
    releaseEditorContext: vi.fn().mockResolvedValue(undefined),
    refreshChanges: vi.fn().mockResolvedValue(undefined),
    getChangeDetail: vi.fn().mockResolvedValue(undefined),
    markChangeReviewed: vi.fn().mockResolvedValue(undefined),
    openChange: vi.fn().mockResolvedValue(undefined),
    refreshTasks: vi.fn().mockResolvedValue(undefined),
    getTask: vi.fn().mockResolvedValue(undefined),
    stopTask: vi.fn().mockResolvedValue(undefined),
    answerTask: vi.fn().mockResolvedValue(undefined),
    refreshCheckpoints: vi.fn().mockResolvedValue(undefined),
    createCheckpoint: vi.fn().mockResolvedValue(undefined),
    previewCheckpoint: vi.fn().mockResolvedValue(undefined),
    deleteCheckpoint: vi.fn().mockResolvedValue(undefined),
    restoreCheckpoint: vi.fn().mockResolvedValue(undefined),
    refreshPromptTemplates: vi.fn().mockResolvedValue(undefined),
    readPromptTemplate: vi.fn().mockResolvedValue(undefined),
    insertPromptTemplate: vi.fn().mockResolvedValue(undefined),
    createPromptTemplate: vi.fn().mockResolvedValue(undefined),
    updatePromptTemplate: vi.fn().mockResolvedValue(undefined),
    deletePromptTemplate: vi.fn().mockResolvedValue(undefined),
    setPromptMode: vi.fn().mockResolvedValue(true),
    pickAttachment: vi.fn().mockResolvedValue(undefined),
    ingestAttachment: vi.fn().mockResolvedValue(undefined),
    previewAttachment: vi.fn().mockResolvedValue(undefined),
    readSessionAttachment: vi.fn().mockResolvedValue(undefined),
    releaseAttachments: vi.fn().mockResolvedValue(undefined),
    listOpenFiles: vi.fn().mockResolvedValue([]),
    attachOpenFile: vi.fn().mockResolvedValue(undefined),
    rememberOpenFile: vi.fn(),
    openLink: vi.fn().mockResolvedValue(undefined),
    showInFolder: vi.fn().mockResolvedValue(undefined),
    runtimeAction: vi.fn().mockResolvedValue(undefined),
    checkDshUpdates: vi.fn().mockResolvedValue(undefined),
    installDshVersion: vi.fn().mockResolvedValue(undefined),
    readSettings: vi.fn().mockResolvedValue(undefined),
    readDshSettings: vi.fn().mockResolvedValue(dshUiSettingsSnapshot()),
    openDshSettingsDocument: vi.fn().mockResolvedValue(undefined),
    openKeyboardShortcuts: vi.fn().mockResolvedValue(undefined),
    updateDshSetting: vi.fn().mockResolvedValue(undefined),
    unsetDshSetting: vi.fn().mockResolvedValue(undefined),
    mutateDshSettings: vi.fn().mockResolvedValue(undefined),
    createCustomProvider: vi.fn().mockResolvedValue({
      profileCommitted: true,
      credentialConfigured: false,
    }),
    discoverModels: vi.fn().mockResolvedValue([]),
    discoverCustomProviderModels: vi.fn().mockResolvedValue([]),
    configureProviderSecret: vi.fn().mockResolvedValue(false),
    removeProviderSecret: vi.fn().mockResolvedValue(undefined),
    configurePluginCredential: vi.fn().mockResolvedValue(false),
    removePluginCredential: vi.fn().mockResolvedValue(undefined),
    refreshModelCatalog: vi.fn().mockResolvedValue(undefined),
    refreshSessionModels: vi.fn().mockResolvedValue(undefined),
    loadPresetRoster: vi.fn().mockResolvedValue(undefined),
    readPresetDocument: vi.fn().mockResolvedValue(undefined),
    copyPreset: vi.fn().mockResolvedValue(undefined),
    removePreset: vi.fn().mockResolvedValue(undefined),
    openPresetDocument: vi.fn().mockResolvedValue(undefined),
    loadPluginInventory: vi.fn().mockResolvedValue(undefined),
    startPluginInstall: vi.fn().mockResolvedValue(undefined),
    cancelPluginInstall: vi.fn().mockResolvedValue(undefined),
    recoverPluginInstall: vi.fn().mockResolvedValue(undefined),
    loadSubagentChildren: vi.fn().mockResolvedValue(undefined),
    updateGoal: vi.fn().mockResolvedValue(undefined),
    clearGoal: vi.fn().mockResolvedValue(undefined),
    exportSession: vi.fn().mockResolvedValue(undefined),
    moveChatToSidebar: vi.fn().mockResolvedValue(undefined),
    setDrawer: vi.fn(),
    featureRequest: vi.fn().mockResolvedValue(undefined),
    subscribeFeature: vi.fn(() => () => undefined),
    loadAccountLifecycle: vi.fn().mockResolvedValue(undefined),
    startAccountSignIn: vi.fn().mockResolvedValue(undefined),
    cancelAccountSignIn: vi.fn().mockResolvedValue(undefined),
    checkAccountSignOutImpact: vi.fn().mockResolvedValue(undefined),
    signOutAccount: vi.fn().mockResolvedValue(undefined),
    loadAccountDetails: vi.fn().mockResolvedValue(undefined),
    acknowledgeAccountBonus: vi.fn().mockResolvedValue(true),
    openAccountPage: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
  }
}

function ActiveLocaleOutput(): ReactElement {
  const { locale } = useI18n()
  return <output data-testid="active-locale">{locale}</output>
}

function renderWithMutableState(initialState: AppState): {
  readonly stageSessionCalls: Array<[string | undefined, string | undefined]>
  readonly updateState: (state: AppState) => void
} {
  let currentState = initialState
  const stageSessionCalls: Array<[string | undefined, string | undefined]> = []
  const store: AppStore = {
    ...storeFor(initialState),
    getState: () => currentState,
    stageSession: vi.fn((workspaceId?: string, presetId?: string) => {
      stageSessionCalls.push([workspaceId, presetId])
      return Promise.resolve()
    }),
  }
  currentStore = store
  const view = render(<App />)
  return {
    stageSessionCalls,
    updateState: (state) => {
      currentState = state
      view.rerender(<App />)
    },
  }
}

function presetSelectionState(enabled: boolean, defaultPresetId: string | undefined): AppState {
  return {
    ...connectedState(false),
    presetSelectionEnabled: enabled,
    presets: ['standard', 'alternate', 'updated-default'].map((id) => ({
      id,
      trust: 'system' as const,
      isDefault: id === defaultPresetId,
      name: id,
    })),
  }
}

describe('App connected rendering', () => {
  it.each(['ordinary', 'approval', 'question'] as const)(
    'delivers %s Stop through the real store, protocol and Host router despite a failed model catalog',
    async (mode) => {
      const { createAppStore } = await vi.importActual<typeof StoreModule>('./app/store.js')
      const { ProtocolClient } = await import('./app/protocol-client.js')
      // Load the actual Host at runtime: it belongs to a separate TypeScript
      // project. This narrow test port keeps Host implementation types out of UI.
      const { WebviewMessageRouter } = await vi.importActual<{
        WebviewMessageRouter: new (dependencies: {
          postMessage: (message: HostMessage | FeatureHostMessage) => Promise<boolean>
          handleRequest: (request: WebviewRequest) => Promise<unknown>
          handleFeatureRequest: () => Promise<unknown>
        }) => { handle(message: unknown, surfaceId: string): Promise<void>; cancelAll(): void }
      }>('../../extension/src/view/message-router.js')
      const { AppError } = await import('@dsh-vscode/domain')
      const { transcriptWindowFixture } = await vi.importActual<{
        transcriptWindowFixture: () => {
          forSurface(surfaceId: string): {
            begin(sessionId: string): number
            installPage(
              sessionId: string,
              page: { readonly events: readonly never[]; readonly hasMore: boolean },
              generation: number,
            ): unknown
          }
          dispose(): void
        }
      }>('../../extension/src/view/transcript-window.fixture.js')
      const transcripts = transcriptWindowFixture()
      const transcript = transcripts.forSurface('sidebar')
      const initial = connectedState(true)
      const requests: Array<{ type: string; payload?: unknown }> = []
      let failStop = true
      const router = new WebviewMessageRouter({
        postMessage: (message) => {
          window.dispatchEvent(new MessageEvent('message', { data: { protocolVersion: 1, message } }))
          return Promise.resolve(true)
        },
        handleRequest: (request) => {
          requests.push(request)
          if (request.type === 'session.open')
            return Promise.resolve({
              ...initial.sessions[0],
              configuration: initial.configuration,
              history: [],
              transcript: transcript.installPage(
                request.payload.sessionId,
                { events: [], hasMore: false },
                transcript.begin(request.payload.sessionId),
              ),
            })
          if (request.type === 'models.session.list')
            throw new AppError({
              code: 'BACKEND_UNREACHABLE',
              message: 'Catalog unavailable',
              retryable: true,
            })
          if (request.type === 'session.cancel' && failStop)
            throw new AppError({
              code: 'BACKEND_UNREACHABLE',
              message: 'Stop delivery failed',
              retryable: true,
            })
          if (request.type === 'subagent.list') return Promise.resolve({ entries: [], parentAvailable: true })
          return Promise.resolve([])
        },
        handleFeatureRequest: () => Promise.resolve({ kind: 'empty' }),
      })
      const client = new ProtocolClient({
        getState: () => undefined,
        setState: () => undefined,
        postMessage: (message) => {
          void router.handle(message, 'sidebar')
        },
      })
      const realStore = createAppStore(client)
      try {
        await realStore.openSession('s1')
        const permissions: AppState['permissions'] =
          mode === 'approval'
            ? [
                {
                  id: 'p1',
                  sessionId: 's1',
                  title: 'User approval',
                  description: 'Choose an action',
                  risk: 'low',
                  options: [{ id: 'custom-deny-id', label: 'Reject', kind: 'deny' }],
                },
              ]
            : []
        const questions: AppState['questions'] =
          mode === 'question'
            ? [
                {
                  id: 'q1',
                  sessionId: 's1',
                  prompt: 'Choose a mode',
                  choices: [],
                  allowFreeText: true,
                },
              ]
            : []
        const sessions = initial.sessions.map((session) => ({ ...session, status: 'running' as const }))
        const backend = { kind: 'connected' as const }
        let source = realStore.getState()
        let snapshot = { ...source, backend, permissions, questions, sessions }
        currentStore = {
          ...realStore,
          initialize: () => Promise.resolve(),
          getState: () => {
            const next = realStore.getState()
            if (next !== source) {
              source = next
              snapshot = { ...next, backend, permissions, questions, sessions }
            }
            return snapshot
          },
        }
        render(<App />)
        const stop = screen.getByRole('button', { name: 'Stop response' })
        expect(stop.hasAttribute('disabled')).toBe(false)
        fireEvent.click(stop)
        await screen.findByText('The local DSH instance is unreachable.')
        expect(requests.filter((request) => request.type === 'session.cancel')).toEqual([
          expect.objectContaining({ payload: { sessionId: 's1' } }),
        ])
        failStop = false
        fireEvent.click(stop)
        await waitFor(() =>
          expect(requests.filter((request) => request.type === 'session.cancel')).toHaveLength(2),
        )
        if (mode === 'approval') {
          fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
          await waitFor(() =>
            expect(requests).toContainEqual(
              expect.objectContaining({
                type: 'interaction.permission.respond',
                payload: { interactionId: 'p1', optionId: 'custom-deny-id' },
              }),
            ),
          )
        }
      } finally {
        cleanup()
        realStore.dispose()
        transcripts.dispose()
        router.cancelAll()
      }
    },
    30_000,
  )

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    document.documentElement.lang = 'en'
  })

  it.each([false, true])('renders the page when connected (active=%s)', (activeSession) => {
    currentStore = storeFor(connectedState(activeSession))
    render(<App />)
    expect(screen.queryByText('DeepSeek Harness view failed')).toBeNull()
    expect(screen.getByRole('main')).toBeDefined()
  })

  it('shows the project landing before a draft or conversation is selected', () => {
    currentStore = storeFor(connectedState(false))
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Choose a project to start' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'New session here' })).toBeNull()
  })

  it('keeps sidebar composition and new-session controls available beside editor chats', () => {
    const stageSession = vi.fn().mockResolvedValue(undefined)
    currentStore = {
      ...storeFor({ ...connectedState(true), surface: { kind: 'sidebar' }, editorChats: 2 }),
      stageSession,
    }
    render(<App />)

    expect(screen.getByTestId('timeline')).toBeDefined()
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toBeDefined()
    expect(
      within(screen.getByRole('toolbar', { name: 'DSH toolbar' })).getByText('Session', {
        selector: '.dsh-app-toolbar__title',
      }),
    ).toBeDefined()
    expect(document.querySelector('.dsh-conversation__header-title')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'New Session' }))
    expect(stageSession).toHaveBeenCalledWith('w1', undefined)
  })

  it('runs the client /moveto command instead of sending it to DSH', async () => {
    const executeCommand = vi.fn().mockResolvedValue(true)
    const sendPrompt = vi.fn().mockResolvedValue(undefined)
    const runMovetoCommand = vi.fn().mockResolvedValue('editor')
    currentStore = {
      ...storeFor({
        ...connectedState(true),
        commands: [{ name: 'moveto', description: 'Move the chat', input: { hint: '[editor|sidebar]' } }],
      }),
      executeCommand,
      sendPrompt,
      runMovetoCommand,
    }
    render(<App />)

    const prompt = screen.getByRole('textbox', { name: 'Prompt' })
    fireEvent.change(prompt, { target: { value: '/moveto:editor' } })
    await act(async () => {
      fireEvent.keyDown(prompt, { key: 'Enter' })
      await Promise.resolve()
    })

    expect(runMovetoCommand).toHaveBeenCalledWith('/moveto editor')
    expect(executeCommand).not.toHaveBeenCalled()
    expect(sendPrompt).not.toHaveBeenCalled()
  })

  it('reports an unusable /moveto target on the error surface', async () => {
    const executeCommand = vi.fn().mockResolvedValue(true)
    const sendPrompt = vi.fn().mockResolvedValue(undefined)
    const runMovetoCommand = vi.fn().mockResolvedValue('unknown-target')
    currentStore = {
      ...storeFor({
        ...connectedState(true),
        commands: [{ name: 'moveto', description: 'Move the chat', input: { hint: '[editor|sidebar]' } }],
      }),
      executeCommand,
      sendPrompt,
      runMovetoCommand,
    }
    render(<App />)

    const prompt = screen.getByRole('textbox', { name: 'Prompt' })
    fireEvent.change(prompt, { target: { value: '/moveto:bogus' } })
    await act(async () => {
      fireEvent.keyDown(prompt, { key: 'Enter' })
      await Promise.resolve()
    })

    await waitFor(() =>
      expect(document.querySelector('.dsh-toolbar-notices [role="status"]')?.textContent).toContain(
        'Unknown /moveto',
      ),
    )
    expect(executeCommand).not.toHaveBeenCalled()
    expect(sendPrompt).not.toHaveBeenCalled()
  })

  it('renders the conversation on an editor surface even while editor tabs exist', () => {
    currentStore = storeFor({
      ...connectedState(true),
      surface: { kind: 'editor', sessionId: 's1' },
      editorChats: 1,
    })
    render(<App />)

    expect(screen.queryByRole('heading', { name: 'Chat is open in the editor area' })).toBeNull()
    expect(screen.getByTestId('timeline')).toBeDefined()
  })

  it('keeps an idle send in the composer through RPC acceptance until its durable message appears', async () => {
    let state = connectedState(true)
    const listeners = new Set<() => void>()
    const publish = (next: AppState): void => {
      state = next
      for (const listener of listeners) listener()
    }
    let acknowledge!: () => void
    const ack = new Promise<void>((resolve) => {
      acknowledge = resolve
    })
    currentStore = {
      ...storeFor(state),
      getState: () => state,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      sendPrompt: vi.fn(() => {
        publish({
          ...state,
          directPromptRequestIds: ['direct-request'],
          queue: [
            {
              id: 'direct-message',
              rpcId: 'direct-request',
              textOnly: true,
              sessionId: 's1',
              text: 'Hello',
              attachments: [],
              mode: 'queue',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        })
        return ack
      }),
    }
    render(<App />)
    const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Prompt' })
    fireEvent.change(input, { target: { value: 'Hello' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input.value).toBe('Hello')
    expect(screen.queryByRole('region', { name: 'Queued prompts' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancel sending' }).getAttribute('aria-busy')).toBe('true')
    await act(async () => {
      acknowledge()
      await ack
    })
    expect(input.value).toBe('Hello')
    expect(screen.getByRole('button', { name: 'Cancel sending' })).toBeTruthy()
    // Identity wins even if DSH expands a reference in the displayed text.
    act(() => {
      publish({
        ...state,
        queue: [],
        timeline: {
          ...state.timeline,
          nodes: [
            {
              kind: 'user-message',
              id: 'direct-message',
              rpcId: 'direct-request',
              markdown: 'Hello (expanded reference)',
            },
          ],
        },
      })
    })
    await waitFor(() => {
      expect(input.value).toBe('')
      expect(screen.queryByRole('button', { name: 'Cancel sending' })).toBeNull()
    })
    expect(screen.queryByRole('region', { name: 'Queued prompts' })).toBeNull()
  })

  it('renders a local draft and routes its first message through deferred creation', async () => {
    const state = connectedState(false)
    const sendPendingPrompt = vi.fn().mockResolvedValue(undefined)
    const createSession = vi.fn().mockResolvedValue(undefined)
    currentStore = {
      ...storeFor({
        ...state,
        pendingSession: {
          revision: 1,
          workspaceId: 'w1',
          configuration: connectedState(true).configuration!,
        },
      }),
      sendPendingPrompt,
      createSession,
    }
    render(<App />)

    const input = document.querySelector('.dsh-composer textarea')
    expect(input).toBeInstanceOf(HTMLTextAreaElement)
    expect(screen.queryByText('Welcome to DSH')).toBeNull()
    fireEvent.change(input!, { target: { value: 'Hello' } })
    const form = input?.closest('form')
    expect(form).not.toBeNull()
    fireEvent.submit(form!)

    await waitFor(() =>
      expect(sendPendingPrompt).toHaveBeenCalledWith('Hello', [], 'queue', expect.any(AbortSignal)),
    )
    expect(createSession).not.toHaveBeenCalled()
  })

  it('keeps a failed active prompt for retry without rendering an untrusted error message', async () => {
    let rejectSubmission: (reason: Error) => void = () => undefined
    const submission = new Promise<void>((_resolve, reject) => {
      rejectSubmission = reject
    })
    const sendPrompt = vi.fn().mockReturnValueOnce(submission).mockResolvedValue(undefined)
    currentStore = { ...storeFor(connectedState(true)), sendPrompt }
    render(<App />)

    const prompt = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Prompt' })
    fireEvent.change(prompt, { target: { value: 'retry this prompt' } })
    fireEvent.keyDown(prompt, { key: 'Enter' })
    await waitFor(() =>
      expect(sendPrompt).toHaveBeenCalledWith(
        's1',
        'retry this prompt',
        [],
        'queue',
        expect.any(AbortSignal),
      ),
    )
    expect(screen.getByRole('button', { name: 'Cancel sending' }).hasAttribute('disabled')).toBe(false)

    await act(async () => {
      rejectSubmission(new Error('Host delivery failed: raw prompt diagnostics'))
      await submission.catch(() => undefined)
    })

    expect(await screen.findByText(/^Prompt failed\./)).toBeDefined()
    // One Session has one writer across instances; unexplained failures must
    // still suggest checking for it rather than leaving a silent draft.
    expect(screen.getByText(/If sending keeps failing/)).toBeDefined()
    // The report belongs to the draft it failed to deliver, not to the timed
    // toolbar toast that would vanish before the user releases the Session.
    expect(document.querySelector('.dsh-composer__submit-error')?.textContent).toContain('Prompt failed.')
    expect(screen.queryByText('Host delivery failed: raw prompt diagnostics')).toBeNull()
    expect(prompt.value).toBe('retry this prompt')
    expect(screen.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(false)

    fireEvent.keyDown(prompt, { key: 'Enter' })
    await waitFor(() => expect(sendPrompt).toHaveBeenCalledTimes(2))
  })

  it('sanitizes a failed empty-draft queue steer and permits retry after settlement', async () => {
    const active = connectedState(true)
    const runningState = {
      ...active,
      sessions: active.sessions.map((session) => ({ ...session, status: 'running' as const })),
      queue: [
        {
          id: 'queue-1',
          sessionId: 's1',
          text: 'queued follow-up',
          attachments: [],
          textOnly: true,
          mode: 'queue' as const,
          createdAt: '2026-08-17T05:00:00.000Z',
        },
      ],
    }
    const steerAllQueued = vi
      .fn()
      .mockRejectedValueOnce(new Error('raw queue transport diagnostic'))
      .mockResolvedValue(undefined)
    currentStore = { ...storeFor(runningState), steerAllQueued }
    render(<App />)

    const prompt = screen.getByRole('textbox', { name: 'Prompt' })
    fireEvent.keyDown(prompt, { key: 'Enter', ctrlKey: true })
    expect(steerAllQueued).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/^Steering the queue failed\./)).toBeDefined()
    expect(screen.getByText(/If sending keeps failing/)).toBeDefined()
    expect(screen.queryByText('raw queue transport diagnostic')).toBeNull()

    fireEvent.keyDown(prompt, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(steerAllQueued).toHaveBeenCalledTimes(2))
  })

  it('retains attachments after a failed busy steer and retries with the accelerated queue mode', async () => {
    const active = connectedState(true)
    const runningState = {
      ...active,
      sessions: active.sessions.map((session) => ({ ...session, status: 'running' as const })),
    }
    const uri = 'dsh-attachment:00000000-0000-4000-8000-000000000021'
    const attachment = { uri, name: 'notes.txt', mimeType: 'text/plain' }
    let rejectFirstSubmission: ((reason: Error) => void) | undefined
    const firstSubmission = new Promise<void>((_resolve, reject) => {
      rejectFirstSubmission = reject
    })
    const sendPrompt = vi.fn().mockReturnValueOnce(firstSubmission).mockResolvedValue(undefined)
    const ingestAttachment = vi.fn().mockResolvedValue(attachment)
    const readDshSettings = vi.fn().mockResolvedValue(dshUiSettingsSnapshot(true, 'steer'))
    currentStore = {
      ...storeFor(runningState),
      ingestAttachment,
      readDshSettings,
      sendPrompt,
    }
    render(<App />)

    await waitFor(() => expect(readDshSettings).toHaveBeenCalled())
    const prompt = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Prompt' })
    fireEvent.paste(prompt, {
      clipboardData: { files: [new File(['notes'], 'notes.txt', { type: 'text/plain' })] },
    })
    await waitFor(() => expect(ingestAttachment).toHaveBeenCalled())
    await screen.findByRole('button', { name: 'Remove notes.txt' })

    fireEvent.change(prompt, { target: { value: 'retry with the attachment' } })
    fireEvent.keyDown(prompt, { key: 'Enter' })
    await waitFor(() =>
      expect(sendPrompt).toHaveBeenCalledWith(
        's1',
        'retry with the attachment',
        [attachment],
        'steer',
        expect.any(AbortSignal),
      ),
    )
    fireEvent.keyDown(prompt, { key: 'Enter' })
    expect(sendPrompt).toHaveBeenCalledTimes(1)

    await act(async () => {
      rejectFirstSubmission?.(new Error('Host delivery failed: raw prompt diagnostics'))
      await firstSubmission.catch(() => undefined)
    })
    expect(await screen.findByText(/^Prompt failed\./)).toBeDefined()
    expect(prompt.value).toBe('retry with the attachment')
    expect(screen.getByRole('button', { name: 'Remove notes.txt' })).toBeDefined()

    fireEvent.keyDown(prompt, { key: 'Enter', ctrlKey: true })
    await waitFor(() =>
      expect(sendPrompt).toHaveBeenCalledWith(
        's1',
        'retry with the attachment',
        [attachment],
        'queue',
        expect.any(AbortSignal),
      ),
    )
    expect(sendPrompt).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['idle', 'DSH is not connected'],
    ['starting', 'Starting DSH'],
    ['connecting', 'Connecting to DSH'],
  ] as const)('shows connection progress instead of an empty-session message (%s)', (kind, title) => {
    currentStore = storeFor({ ...connectedState(false), backend: { kind } })
    render(<App />)

    expect(screen.getByRole('heading', { name: title })).toBeDefined()
    expect(screen.queryByText('No active session')).toBeNull()
    expect(screen.queryByRole('button', { name: 'New session here' })).toBeNull()
  })

  it('shows catalog loading after DSH connects before workspace data arrives', () => {
    currentStore = storeFor({
      ...connectedState(false),
      workspaces: [],
      sessionDirectoryStatus: 'loading',
      sessionStartup: { kind: 'loading' },
    })
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Loading workspaces and sessions…' })).toBeDefined()
    expect(screen.queryByText('No active session')).toBeNull()
  })

  it('renders the shared application header controls', () => {
    currentStore = storeFor(connectedState(true))
    render(<App />)

    expect(screen.getByRole('toolbar', { name: 'DSH toolbar' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Switch session: Session' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'New Session' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeDefined()
  })

  it('restores and applies the conversation font size from General settings', async () => {
    window.localStorage.setItem(CONVERSATION_FONT_SIZE_STORAGE_KEY, 'large')
    currentStore = storeFor({ ...connectedState(true), drawer: 'settings' })
    render(<App />)

    expect(document.querySelector('.dsh-conversation')?.getAttribute('data-conversation-font-size')).toBe(
      'large',
    )
    // The first settings opening loads a separate chunk; allow module loading
    // under the full parallel suite before checking the actual preference write.
    const input = await screen.findByRole(
      'spinbutton',
      { name: 'Conversation font size' },
      { timeout: 5_000 },
    )
    expect(input).toHaveProperty('value', '17')
    fireEvent.change(input, { target: { value: '12' } })
    fireEvent.blur(input)
    const conversation = document.querySelector<HTMLElement>('.dsh-conversation')
    expect(conversation?.getAttribute('data-conversation-font-size-px')).toBe('12')
    expect(conversation?.style.fontSize).toBe('12px')
    expect(window.localStorage.getItem(CONVERSATION_FONT_SIZE_STORAGE_KEY)).toBe('12')
  })

  it('preserves local theme after Desktop settings load and persists local changes', async () => {
    window.localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, 'light')
    const base = dshUiSettingsSnapshot()
    const snapshot: DshSettingsSnapshot = {
      ...base,
      schema: {
        ...base.schema,
        fields: [
          {
            path: 'ui-theme.preference',
            label: 'preference',
            type: 'enum',
            required: false,
            enumValues: ['light', 'dark', 'system'],
            restartRequired: false,
          },
        ],
      },
      values: { 'ui-theme': { preference: 'dark' } },
    }
    const readDshSettings = vi.fn().mockResolvedValue(snapshot)
    currentStore = { ...storeFor({ ...connectedState(true), drawer: 'settings' }), readDshSettings }
    render(<App />)
    await act(async () => {
      await Promise.resolve()
    })
    await waitFor(() => expect(readDshSettings).toHaveBeenCalled())
    expect(document.documentElement.dataset.dshTheme).toBe('light')
    expect(window.localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)).toBe('light')
    fireEvent.click(await screen.findByRole('button', { name: 'system' }, { timeout: 5_000 }))
    expect(document.documentElement.dataset.dshTheme).toBe('system')
    expect(window.localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)).toBe('system')
  })

  it('restores the selected Webview theme on the application root', () => {
    window.localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, 'light')
    currentStore = storeFor(connectedState(true))

    render(<App />)

    expect(document.documentElement.dataset.dshTheme).toBe('light')
    expect(screen.getByRole('main').getAttribute('data-dsh-theme')).toBe('light')
  })

  it('keeps the session picker available while an existing session is not active', () => {
    const state = connectedState(false)
    const existingSession = {
      id: 's1',
      title: 'Existing session',
      workspaceId: 'w1',
      blank: false,
      status: 'completed' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    currentStore = storeFor({
      ...state,
      sessions: [existingSession],
      workspaces: [
        {
          ...state.workspaces[0]!,
          sessionIds: ['s1'],
          sessionCount: 1,
        },
      ],
      drawer: 'sessions',
    })

    render(<App />)

    expect(document.querySelector('.dsh-conversation__utility')).toBeNull()
    expect(screen.getByRole('button', { name: 'Open sessions' })).toBeDefined()
    expect(screen.getByRole('dialog', { name: 'Sessions' })).toBeDefined()
    expect(screen.getByText('Existing session')).toBeDefined()
  })

  it('loads the trajectory surface when the user selects it', async () => {
    currentStore = storeFor(connectedState(true))
    render(<App />)

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Trajectory' })).toBeDefined())
    fireEvent.click(screen.getByRole('tab', { name: 'Trajectory' }))

    await waitFor(() => expect(screen.getByLabelText('Trajectory ledger')).toBeDefined())
  })

  it('keeps both conversation views available when Coding Tools is disabled', async () => {
    const readDshSettings = vi.fn().mockResolvedValue(dshUiSettingsSnapshot(false))
    currentStore = { ...storeFor(connectedState(true)), readDshSettings }
    render(<App />)

    await waitFor(() => expect(readDshSettings).toHaveBeenCalled())
    expect(screen.getByRole('tab', { name: 'Chat' })).toBeDefined()
    expect(screen.getByRole('tab', { name: 'Trajectory' })).toBeDefined()
    expect(screen.getByTestId('timeline')).toBeDefined()
    fireEvent.click(screen.getByRole('tab', { name: 'Trajectory' }))
    await screen.findByLabelText('Trajectory ledger')
  })

  it.each(['pending', 'unavailable', 'disabled'] as const)(
    'shows usable view tabs when opening a session from the initial page with %s settings',
    async (settings) => {
      let state: AppState = {
        ...connectedState(false),
        pendingSession: {
          revision: 1,
          workspaceId: 'w1',
          configuration: connectedState(true).configuration!,
        },
      }
      const listeners = new Set<() => void>()
      let resolveSettings!: (value: DshSettingsSnapshot) => void
      const pendingSettings = new Promise<DshSettingsSnapshot>((resolve) => {
        resolveSettings = resolve
      })
      const readDshSettings = vi.fn(() =>
        settings === 'pending'
          ? pendingSettings
          : settings === 'unavailable'
            ? Promise.reject(new Error('settings unavailable'))
            : Promise.resolve(dshUiSettingsSnapshot(false)),
      )
      currentStore = {
        ...storeFor(state),
        getState: () => state,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        readDshSettings,
        openSession: vi.fn(() => {
          state = { ...connectedState(true), pendingSession: undefined }
          for (const listener of listeners) listener()
          return Promise.resolve()
        }),
      }
      render(<App />)
      expect(screen.queryByRole('tab', { name: 'Trajectory' })).toBeNull()
      await act(async () => {
        await currentStore.openSession('s1')
      })
      const chat = screen.getByRole('tab', { name: 'Chat' })
      const trajectory = screen.getByRole('tab', { name: 'Trajectory' })
      expect(chat.getAttribute('aria-selected')).toBe('true')
      fireEvent.keyDown(chat, { key: 'ArrowRight' })
      await screen.findByLabelText('Trajectory ledger')
      expect(trajectory.getAttribute('aria-selected')).toBe('true')
      // A late settings response must not reset the reader's chosen view.
      if (settings === 'pending')
        await act(async () => {
          resolveSettings(dshUiSettingsSnapshot(false))
          await pendingSettings
        })
      expect(screen.getByRole('tab', { name: 'Trajectory' }).getAttribute('aria-selected')).toBe('true')
      fireEvent.click(chat)
      expect(screen.getByTestId('timeline')).toBeDefined()
    },
  )

  it('uses the accepted Host busy-send value after a successful write even if refresh fails', async () => {
    const active = connectedState(true)
    const runningState = {
      ...active,
      drawer: 'settings' as const,
      sessions: active.sessions.map((session) => ({ ...session, status: 'running' as const })),
    }
    const readDshSettings = vi
      .fn()
      .mockResolvedValueOnce(dshUiSettingsSnapshot(true, 'queue'))
      .mockResolvedValueOnce(dshUiSettingsSnapshot(true, 'queue'))
      .mockRejectedValue(new Error('refresh unavailable'))
    const sendPrompt = vi.fn().mockResolvedValue(undefined)
    const updateDshSetting = vi.fn().mockResolvedValue(undefined)
    currentStore = {
      ...storeFor(runningState),
      readDshSettings,
      sendPrompt,
      updateDshSetting,
    }
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    )

    const busyEnter = await screen.findByRole('group', { name: 'Enter while running' })
    fireEvent.click(within(busyEnter).getByRole('button', { name: 'steer' }))
    await waitFor(() =>
      expect(updateDshSetting).toHaveBeenCalledWith('ui-conversation.busyEnter', 'steer', 1),
    )
    await waitFor(() => expect(readDshSettings).toHaveBeenCalledTimes(3))
    expect(within(busyEnter).getByRole('button', { name: 'steer' }).getAttribute('aria-pressed')).toBe('true')

    const prompt = screen.getByRole('textbox', { name: 'Prompt' })
    fireEvent.change(prompt, { target: { value: 'follow-up' } })
    fireEvent.keyDown(prompt, { key: 'Enter' })

    await waitFor(() =>
      expect(sendPrompt).toHaveBeenCalledWith('s1', 'follow-up', [], 'steer', expect.any(AbortSignal)),
    )
    expect(updateDshSetting).toHaveBeenCalledTimes(1)
  })

  it('does not replay a rejected settings write when its refresh also fails', async () => {
    const readDshSettings = vi
      .fn()
      .mockResolvedValueOnce(dshUiSettingsSnapshot(true, 'queue'))
      .mockResolvedValueOnce(dshUiSettingsSnapshot(true, 'queue'))
      .mockRejectedValue(new Error('refresh unavailable'))
    const updateDshSetting = vi.fn().mockRejectedValue(new Error('write rejected'))
    const state = { ...connectedState(true), drawer: 'settings' as const }
    const store: AppStore = {
      ...storeFor(state),
      getState: () => state,
      readDshSettings,
      updateDshSetting,
    }
    currentStore = store
    const view = render(<App />)

    const busyEnter = await screen.findByRole('group', { name: 'Enter while running' })
    fireEvent.click(within(busyEnter).getByRole('button', { name: 'steer' }))
    await waitFor(() => expect(updateDshSetting).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(readDshSettings).toHaveBeenCalledTimes(3))

    view.rerender(<App />)

    expect(updateDshSetting).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('timeline').getAttribute('data-coding-tools-enabled')).toBe('true')
  })

  it('keeps new-session mode selection when rc2 Developer Tools is off', async () => {
    // Coding Tools only removes the shipped PTC/Minimal presets upstream; it
    // never refuses a preset switch. The Host's own roster answer is the only
    // refusal that may withdraw the choice.
    const state = {
      ...presetSelectionState(true, 'standard'),
      pendingSession: { revision: 1, workspaceId: 'w1', configuration: connectedState(true).configuration! },
    }
    const readDshSettings = vi.fn().mockResolvedValue(dshUiSettingsSnapshot(false))
    currentStore = {
      ...storeFor(state),
      readDshSettings,
    }
    render(<App />)

    await waitFor(() => expect(readDshSettings).toHaveBeenCalled())
    await waitFor(() =>
      expect(document.querySelector('.dsh-session-controls__mode .dsh-select-menu__trigger')).not.toBeNull(),
    )
  })

  it('exposes tabpanel relationships and arrow-key navigation for conversation views', async () => {
    currentStore = storeFor(connectedState(true))
    render(<App />)

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Trajectory' })).toBeDefined())
    const chat = screen.getByRole('tab', { name: 'Chat' })
    const trajectory = screen.getByRole('tab', { name: 'Trajectory' })
    expect(chat.getAttribute('aria-controls')).toBe('dsh-conversation-panel-chat')
    expect(trajectory.getAttribute('aria-controls')).toBe('dsh-conversation-panel-trajectory')
    expect(chat.getAttribute('tabindex')).toBe('0')
    expect(trajectory.getAttribute('tabindex')).toBe('-1')

    fireEvent.keyDown(chat, { key: 'ArrowRight' })
    expect(trajectory.getAttribute('aria-selected')).toBe('true')
    expect(chat.getAttribute('tabindex')).toBe('-1')
    expect(trajectory.getAttribute('tabindex')).toBe('0')
    expect(document.activeElement).toBe(trajectory)
  })

  it('does not render a duplicate in-webview settings trigger', () => {
    currentStore = storeFor(connectedState(false))
    render(<App />)

    expect(screen.queryByRole('button', { name: 'Open settings' })).toBeNull()
  })

  it('keeps successful compatibility connections quiet but still reports actual failures', async () => {
    const state = {
      ...connectedState(true),
      connectedDshVersion: '0.2.2',
      dshCompatibilityWarning: 'Runtime contract has not been individually verified.',
    }
    const pickAttachment = vi.fn().mockRejectedValue(new Error('DSH communication failed'))
    currentStore = { ...storeFor(state), pickAttachment }

    render(<App />)

    expect(screen.queryByRole('button', { name: /^Show notifications/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Connected' }))
    const details = within(screen.getByRole('dialog', { name: 'Connection details' }))
    expect(
      details.getByText('Connected in compatibility mode. Some features depend on the DSH version.'),
    ).toBeDefined()
    expect(details.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close connection details' }))

    fireEvent.click(screen.getByRole('button', { name: 'Editor context' }))
    fireEvent.click(screen.getByRole('button', { name: 'Attach file' }))
    expect(await screen.findByText('DSH communication failed')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Show notifications (1)' })).toBeDefined()
  })

  it('reports an actual connection failure during a conversation and reports it again after a retry', () => {
    const state = connectedState(true)
    const failed: AppState = {
      ...state,
      backend: { kind: 'failed', message: 'DSH could not communicate.', retryable: true },
    }
    const view = renderWithMutableState(state)

    view.updateState(failed)
    fireEvent.click(screen.getByRole('button', { name: 'Show notifications (1)' }))
    expect(screen.getByText('DSH could not communicate.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss connection error' }))
    expect(screen.queryByRole('button', { name: /^Show notifications/ })).toBeNull()

    view.updateState({ ...state, backend: { kind: 'connecting' } })
    view.updateState(failed)
    expect(screen.getByRole('button', { name: 'Show notifications (1)' })).toBeDefined()
  })

  it('lets the user dismiss an update notice for the current upstream version', () => {
    currentStore = storeFor({
      ...connectedState(false),
      dshUpdate: {
        status: 'ready',
        currentVersion: '0.1.0-rc.8',
        latestVersion: '0.1.0-rc.9',
        availableVersions: ['0.1.0-rc.9', '0.1.0-rc.8'],
        updateAvailable: true,
        checkedAt: '2026-08-21T00:00:00.000Z',
      },
    })

    render(<App />)

    expect(screen.getByRole('button', { name: 'Show notifications (2)' })).toBeDefined()
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show notifications (2)' }))
    const notices = screen.getByRole('dialog', { name: 'Notifications' })
    expect(within(notices).getByText('Welcome to DSH')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss update notice' }))
    expect(screen.queryByText('DSH update available')).toBeNull()
    expect(window.localStorage.getItem('dsh-runtime-update-dismissed-version')).toBe('0.1.0-rc.9')
  })

  it('shows a newer update after an older notice was dismissed', () => {
    window.localStorage.setItem('dsh-runtime-update-dismissed-version', '0.1.0-rc.9')
    currentStore = storeFor({
      ...connectedState(false),
      dshUpdate: {
        status: 'ready',
        currentVersion: '0.1.0-rc.8',
        latestVersion: '0.1.0-rc.10',
        availableVersions: ['0.1.0-rc.10'],
        updateAvailable: true,
        checkedAt: '2026-08-21T00:00:00.000Z',
      },
    })

    render(<App />)

    expect(document.querySelector('.dsh-toolbar-notices [role="status"]')?.textContent).toBe(
      'DSH update available',
    )
  })

  it('hides the top update notice once the latest version is installed globally', () => {
    currentStore = storeFor({
      ...connectedState(false),
      dshUpdate: {
        status: 'ready',
        currentVersion: '0.1.0-rc.8',
        globalVersion: '0.1.0-rc.9',
        latestVersion: '0.1.0-rc.9',
        availableVersions: ['0.1.0-rc.9', '0.1.0-rc.8'],
        updateAvailable: true,
        restartRequired: true,
        checkedAt: '2026-08-21T00:00:00.000Z',
      },
    })

    render(<App />)

    expect(screen.queryByText('DSH update available')).toBeNull()
  })

  it('keeps the settings entry point available when the runtime is missing', () => {
    const setDrawer = vi.fn()
    currentStore = {
      ...storeFor({
        ...connectedState(false),
        backend: {
          kind: 'runtime-missing',
          searchedLocations: ['C:\\Users\\Direwolf\\AppData\\Roaming\\npm\\dsh.cmd'],
        },
      }),
      setDrawer,
    }

    render(<App />)

    expect(screen.getByRole('heading', { name: 'DSH was not found' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
    expect(setDrawer).toHaveBeenCalledWith('settings')
  })

  it('keeps removed quick actions out of General settings', async () => {
    const setDrawer = vi.fn()
    currentStore = { ...storeFor({ ...connectedState(true), drawer: 'settings' }), setDrawer }

    render(<App />)

    fireEvent.click(await screen.findByRole('tab', { name: 'General' }))
    expect(screen.queryByRole('region', { name: 'Quick actions' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Schedules' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open Web UI' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open in Editor Area' })).toBeNull()
  })

  it('keeps navigation in the page header without the retired conversation tools menu', () => {
    const stageSession = vi.fn().mockResolvedValue(undefined)
    const setDrawer = vi.fn()
    currentStore = { ...storeFor(connectedState(true)), stageSession, setDrawer }
    render(<App />)
    expect(screen.queryByRole('button', { name: 'Conversation tools' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Trajectory' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(setDrawer).toHaveBeenCalledWith('settings')
    fireEvent.click(screen.getByRole('button', { name: 'New Session' }))
    expect(stageSession).toHaveBeenCalledWith('w1', undefined)
  })

  it('renders one-shot subagent history as read-only', () => {
    const state = connectedState(true)
    currentStore = storeFor({
      ...state,
      activeSessionId: 'child-1',
      configuration: undefined,
      activeSubagent: {
        workspaceId: 'w1',
        parentAvailable: true,
        entry: {
          kind: 'child',
          id: 'child-1',
          activity: 'inactive',
          parentSessionId: 's1',
          mode: 'one-shot',
          hasChildren: false,
        },
      },
      timeline: { sessionId: 'child-1', nodes: [], lastSequence: -1 },
    })

    render(<App />)

    expect(screen.getByText('One-shot tasks do not accept follow-up messages.')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Send message' })).toBeNull()
  })

  it('keeps Stop available for a running continuable child whose parent is offline', () => {
    const state = connectedState(true)
    const cancelSession = vi.fn().mockResolvedValue(undefined)
    currentStore = {
      ...storeFor({
        ...state,
        activeSessionId: 'child-1',
        configuration: undefined,
        activeSubagent: {
          workspaceId: 'w1',
          parentAvailable: false,
          entry: {
            kind: 'child',
            id: 'child-1',
            label: 'Worker',
            activity: 'running',
            parentSessionId: 's1',
            mode: 'continuable',
            hasChildren: false,
          },
        },
        timeline: { sessionId: 'child-1', nodes: [], lastSequence: -1 },
      }),
      cancelSession,
    }

    render(<App />)
    expect(screen.getByRole('textbox', { name: 'Prompt' }).hasAttribute('disabled')).toBe(true)
    const stop = screen.getByRole('button', { name: 'Stop response' })
    expect(stop.hasAttribute('disabled')).toBe(false)
    fireEvent.click(stop)
    expect(cancelSession).toHaveBeenCalledWith('child-1')
  })

  it('allows text follow-up but disables attachments for an available continuable child', () => {
    const state = connectedState(true)
    const sendPrompt = vi.fn().mockResolvedValue(undefined)
    currentStore = {
      ...storeFor({
        ...state,
        activeSessionId: 'child-1',
        configuration: undefined,
        activeSubagent: {
          workspaceId: 'w1',
          parentAvailable: true,
          entry: {
            kind: 'child',
            id: 'child-1',
            label: 'Worker',
            activity: 'inactive',
            parentSessionId: 's1',
            mode: 'continuable',
            hasChildren: false,
          },
        },
        timeline: { sessionId: 'child-1', nodes: [], lastSequence: -1 },
      }),
      sendPrompt,
    }

    render(<App />)
    expect(screen.getByRole('button', { name: 'Editor context' }).hasAttribute('disabled')).toBe(false)
    fireEvent.change(screen.getByRole('textbox', { name: 'Prompt' }), {
      target: { value: 'continue' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(sendPrompt).toHaveBeenCalledWith('child-1', 'continue', [], 'queue', expect.any(AbortSignal))
  })

  it('uses DSH context pressure instead of estimating tokens from rendered text', () => {
    const state = connectedState(true)
    currentStore = storeFor({
      ...state,
      projections: {
        s1: {
          contextPressure: { pressureTokens: 1_024, contextWindow: 1_000_000 },
          contextBreakdown: { systemTokens: 1_600, toolsTokens: 6_700, messageTokens: 19_500 },
        },
      },
    })
    render(<App />)

    expect(screen.getByLabelText('Context ~1.0k / 1.0m tokens')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Context ~1.0k / 1.0m tokens' }))
    expect(screen.getByRole('dialog').textContent).toContain('System prompt')
    expect(screen.getByRole('dialog').textContent).toContain('~1.6K')
    expect(screen.getByRole('dialog').textContent).toContain('Conversation messages')
  })

  it('does not render a partial token-usage projection as a complete total', () => {
    const state = connectedState(true)
    currentStore = storeFor({
      ...state,
      projections: { s1: { tokenUsage: { outputTokens: 100 } } },
    })
    render(<App />)

    expect(screen.queryByText('↓100')).toBeNull()
  })

  it('derives the RC2 projected total from its complete four-bucket aggregate', () => {
    const state = connectedState(true)
    currentStore = storeFor({
      ...state,
      projections: {
        s1: {
          tokenUsage: { uncachedInputTokens: 100, outputTokens: 10, cacheReadTokens: 5, cacheWriteTokens: 2 },
        },
      },
    })
    render(<App />)

    expect(screen.getByText('Σ 117 tokens')).toBeDefined()
  })

  it('does not infer a projected total from incomplete legacy cache buckets', () => {
    const state = connectedState(true)
    currentStore = storeFor({
      ...state,
      projections: { s1: { tokenUsage: { uncachedInputTokens: 100, outputTokens: 10, cacheReadTokens: 5 } } },
    })
    render(<App />)

    expect(screen.queryByText(/Σ/u)).toBeNull()
  })

  it('does not render a partial context-pressure projection as complete', () => {
    const state = connectedState(true)
    currentStore = storeFor({
      ...state,
      projections: { s1: { contextPressure: { pressureTokens: 1_024, contextWindow: 'broken' } } },
    })
    render(<App />)

    expect(screen.queryByRole('button', { name: /Context/u })).toBeNull()
  })

  it('pre-checks rc.8 image limits before sending bytes to the Extension Host', () => {
    const state = connectedState(true)
    const ingestAttachment = vi.fn().mockResolvedValue(undefined)
    currentStore = {
      ...storeFor({
        ...state,
        projections: {
          s1: {
            imageLimits: {
              maxImageBytes: 2,
              maxImagesPerMessage: 20,
              maxMessageImageBytes: 100,
              maxImagePixels: 100,
              maxImageDimension: 10,
              mediaTypes: ['image/png'],
            },
          },
        },
      }),
      ingestAttachment,
    }
    render(<App />)
    const file = new File(['too-large'], 'screenshot.png', { type: 'image/png' })
    fireEvent.paste(screen.getByRole('textbox', { name: 'Prompt' }), {
      clipboardData: { files: [file] },
    })

    expect(document.querySelector('.dsh-toolbar-notices [role="status"]')?.textContent).toContain(
      'DSH image limit of 2 B',
    )
    expect(ingestAttachment).not.toHaveBeenCalled()
  })

  it('pre-checks image limits that also list a type this client cannot encode', () => {
    const state = connectedState(true)
    const ingestAttachment = vi.fn().mockResolvedValue(undefined)
    currentStore = {
      ...storeFor({
        ...state,
        projections: {
          s1: {
            imageLimits: {
              maxImageBytes: 2,
              maxImagesPerMessage: 20,
              maxMessageImageBytes: 100,
              maxImagePixels: 100,
              maxImageDimension: 10,
              mediaTypes: ['image/png', 'image/avif'],
            },
          },
        },
      }),
      ingestAttachment,
    }
    render(<App />)
    const file = new File(['too-large'], 'screenshot.png', { type: 'image/png' })
    fireEvent.paste(screen.getByRole('textbox', { name: 'Prompt' }), {
      clipboardData: { files: [file] },
    })

    // The unknown type only narrows what may be sent; the advertised byte
    // limit still applies to the types this Webview can produce.
    expect(document.querySelector('.dsh-toolbar-notices [role="status"]')?.textContent).toContain(
      'DSH image limit of 2 B',
    )
    expect(ingestAttachment).not.toHaveBeenCalled()
  })

  it('does not use a partially malformed image-limit projection as an admission policy', async () => {
    const state = connectedState(true)
    const ingestAttachment = vi.fn().mockResolvedValue(undefined)
    currentStore = {
      ...storeFor({
        ...state,
        projections: {
          s1: {
            imageLimits: {
              maxImageBytes: 2,
              maxImagesPerMessage: 20,
              maxMessageImageBytes: 100,
              maxImagePixels: 100,
              mediaTypes: ['image/png', 'text/plain'],
            },
          },
        },
      }),
      ingestAttachment,
    }
    render(<App />)
    fireEvent.paste(screen.getByRole('textbox', { name: 'Prompt' }), {
      clipboardData: { files: [new File(['small'], 'screenshot.png', { type: 'image/png' })] },
    })

    await waitFor(() => expect(ingestAttachment).toHaveBeenCalled())
    expect(screen.queryByText(/DSH image limit/u)).toBeNull()
  })

  it('pre-checks the message image byte total before sending bytes to the Extension Host', () => {
    const state = connectedState(true)
    const ingestAttachment = vi.fn().mockResolvedValue(undefined)
    currentStore = {
      ...storeFor({
        ...state,
        projections: {
          s1: {
            imageLimits: {
              maxImageBytes: 100,
              maxImagesPerMessage: 20,
              maxMessageImageBytes: 15,
              maxImagePixels: 100,
              mediaTypes: ['image/png'],
            },
          },
        },
      }),
      ingestAttachment,
    }
    render(<App />)
    fireEvent.paste(screen.getByRole('textbox', { name: 'Prompt' }), {
      clipboardData: { files: [new File(['x'.repeat(20)], 'screenshot.png', { type: 'image/png' })] },
    })

    // The single image fits the per-image limit; only the message total
    // rejects it, so the adapter must never see the bytes first.
    expect(document.querySelector('.dsh-toolbar-notices [role="status"]')?.textContent).toContain(
      'The combined image size exceeds the DSH image limit of 15 B.',
    )
    expect(ingestAttachment).not.toHaveBeenCalled()
  })

  it('counts image pastes that are still being read toward the per-message image limit', async () => {
    const state = connectedState(true)
    let resolveIngest: ((value: undefined) => void) | undefined
    const ingestAttachment = vi
      .fn()
      .mockImplementation(() => new Promise<undefined>((resolve) => (resolveIngest = resolve)))
    currentStore = {
      ...storeFor({
        ...state,
        projections: {
          s1: {
            imageLimits: {
              maxImageBytes: 100,
              maxImagesPerMessage: 1,
              maxMessageImageBytes: 100_000,
              maxImagePixels: 100,
              mediaTypes: ['image/png'],
            },
          },
        },
      }),
      ingestAttachment,
    }
    render(<App />)
    const prompt = screen.getByRole('textbox', { name: 'Prompt' })
    fireEvent.paste(prompt, {
      clipboardData: { files: [new File(['first'], 'first.png', { type: 'image/png' })] },
    })
    await waitFor(() => expect(ingestAttachment).toHaveBeenCalledTimes(1))

    // The first image has not landed in the draft yet; the second paste has
    // to be measured against it instead of slipping past the limit.
    fireEvent.paste(prompt, {
      clipboardData: { files: [new File(['second'], 'second.png', { type: 'image/png' })] },
    })
    expect(document.querySelector('.dsh-toolbar-notices [role="status"]')?.textContent).toContain(
      'accepts at most 1 images',
    )
    expect(ingestAttachment).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveIngest?.(undefined)
      await Promise.resolve()
    })
  })

  it('releases an opaque Host attachment handle when its draft chip is removed', async () => {
    const state = connectedState(true)
    const uri = 'dsh-attachment:00000000-0000-4000-8000-000000000001'
    const pickAttachment = vi.fn().mockResolvedValue({ uri, name: 'notes.txt', mimeType: 'text/plain' })
    const releaseAttachments = vi.fn().mockResolvedValue(undefined)
    currentStore = {
      ...storeFor(state),
      pickAttachment,
      releaseAttachments,
    }

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Editor context' }))
    fireEvent.click(screen.getByRole('button', { name: 'Attach file' }))
    const remove = await screen.findByRole('button', { name: 'Remove notes.txt' })
    fireEvent.click(remove)

    await waitFor(() => expect(releaseAttachments).toHaveBeenCalledWith([uri]))
    expect(screen.queryByRole('button', { name: 'Remove notes.txt' })).toBeNull()
  })

  it.each(['success', 'failure'] as const)(
    'previews a pasted image before creating a session and retains its handle through first-send handoff: %s',
    async (outcome) => {
      const base = connectedState(true)
      let state: AppState = {
        ...base,
        activeSessionId: undefined,
        pendingSession: { revision: 1, workspaceId: 'w1', configuration: base.configuration! },
      }
      const listeners = new Set<() => void>()
      const publish = (next: AppState): void => {
        state = next
        for (const listener of listeners) listener()
      }
      const uri = 'dsh-attachment:00000000-0000-4000-8000-000000000031'
      const image = { uri, name: 'pasted.png', mimeType: 'image/png' }
      const handles = new Set([uri])
      const preview = 'data:image/png;base64,AAAA'
      const releaseAttachments = vi.fn((uris: readonly string[]) => {
        for (const uri of uris) handles.delete(uri)
        return Promise.resolve()
      })
      let finish!: () => void
      let fail!: (error: Error) => void
      const receipt = new Promise<void>((resolve, reject) => {
        finish = resolve
        fail = reject
      })
      const sendPendingPrompt = vi.fn(() => {
        // Both updates may be batched by React. Host handles must nevertheless
        // remain owned by this composition until admission finishes.
        publish({ ...state, pendingSession: { ...state.pendingSession!, createdSessionId: 's1' } })
        publish({ ...base, activeSessionId: 's1', pendingSession: undefined })
        return receipt
      })
      currentStore = {
        ...storeFor(state),
        getState: () => state,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        ingestAttachment: vi.fn().mockResolvedValue(image),
        previewAttachment: vi.fn(() => Promise.resolve(handles.has(uri) ? preview : undefined)),
        releaseAttachments,
        sendPendingPrompt,
      }
      render(<App />)
      const input = screen.getByRole('textbox', { name: 'Prompt' })
      fireEvent.paste(input, {
        clipboardData: { files: [new File(['png'], 'pasted.png', { type: 'image/png' })] },
      })
      const thumb = await screen.findByRole('button', { name: 'Preview pasted.png' })
      await waitFor(() => expect(thumb.querySelector('img')?.getAttribute('src')).toBe(preview))
      fireEvent.click(thumb)
      const lightbox = await screen.findByRole('dialog', { name: 'Preview pasted.png' })
      expect(within(lightbox).getByRole('img', { name: 'pasted.png' }).getAttribute('src')).toBe(preview)
      fireEvent.keyDown(lightbox, { key: 'Escape' })
      fireEvent.submit(input.closest('form')!)
      await waitFor(() => expect(sendPendingPrompt).toHaveBeenCalled())
      expect(handles.has(uri)).toBe(true)
      expect(releaseAttachments).not.toHaveBeenCalled()
      expect(
        screen.getByRole('button', { name: 'Preview pasted.png' }).querySelector('img')?.getAttribute('src'),
      ).toBe(preview)
      await act(async () => {
        if (outcome === 'success') {
          handles.delete(uri)
          finish()
        } else fail(new Error('Backend rejected the message'))
        await receipt.catch(() => undefined)
      })
      if (outcome === 'success') {
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove pasted.png' })).toBeNull())
      } else {
        expect(screen.getByRole('button', { name: 'Remove pasted.png' })).toBeDefined()
        expect(handles.has(uri)).toBe(true)
        expect(releaseAttachments).not.toHaveBeenCalled()
        const retry = vi.fn((_sessionId: string, _text: string, attachments: readonly { uri: string }[]) => {
          expect(attachments.map((attachment) => attachment.uri)).toEqual([uri])
          expect(handles.has(uri)).toBe(true)
          handles.delete(uri)
          return Promise.resolve()
        })
        currentStore.sendPrompt = retry
        fireEvent.submit(screen.getByRole('textbox', { name: 'Prompt' }).closest('form')!)
        await waitFor(() => expect(retry).toHaveBeenCalledOnce())
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove pasted.png' })).toBeNull())
      }
    },
  )

  it('reports an unavailable attachment preview instead of a permanent loading state', async () => {
    const state = connectedState(true)
    const uri = 'dsh-attachment:00000000-0000-4000-8000-000000000002'
    const pickAttachment = vi.fn().mockResolvedValue({ uri, name: 'photo.png', mimeType: 'image/png' })
    // A dead or expired Host handle answers with `{cancelled: true}`, which the
    // store flattens to `undefined` — an outcome the lightbox must not dress up
    // as "still loading".
    const previewAttachment = vi.fn().mockResolvedValue(undefined)
    currentStore = { ...storeFor(state), pickAttachment, previewAttachment }

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Editor context' }))
    fireEvent.click(screen.getByRole('button', { name: 'Attach file' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Preview photo.png' }))

    const lightbox = await screen.findByRole('dialog', { name: 'Preview photo.png' })
    await waitFor(() => expect(within(lightbox).getByText('Unable to load image')).toBeDefined())
    expect(within(lightbox).queryByText('Loading preview…')).toBeNull()
    // The failure is terminal: it must not re-request the same handle forever.
    await waitFor(() => expect(previewAttachment).toHaveBeenCalledTimes(1))
  })

  it('shows the resolved attachment preview in the lightbox', async () => {
    const state = connectedState(true)
    const uri = 'dsh-attachment:00000000-0000-4000-8000-000000000003'
    const pickAttachment = vi.fn().mockResolvedValue({ uri, name: 'photo.png', mimeType: 'image/png' })
    const previewAttachment = vi.fn().mockResolvedValue('data:image/png;base64,AAAA')
    currentStore = { ...storeFor(state), pickAttachment, previewAttachment }

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Editor context' }))
    fireEvent.click(screen.getByRole('button', { name: 'Attach file' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Preview photo.png' }))

    const lightbox = await screen.findByRole('dialog', { name: 'Preview photo.png' })
    await waitFor(() =>
      expect(within(lightbox).getByRole('img', { name: 'photo.png' }).getAttribute('src')).toBe(
        'data:image/png;base64,AAAA',
      ),
    )
    expect(within(lightbox).queryByText('Unable to load image')).toBeNull()
  })

  it('retries the preview after a failed attachment is removed and picked again', async () => {
    const state = connectedState(true)
    const uri = 'dsh-attachment:00000000-0000-4000-8000-000000000004'
    const pickAttachment = vi.fn().mockResolvedValue({ uri, name: 'photo.png', mimeType: 'image/png' })
    const previewAttachment = vi.fn().mockResolvedValue(undefined)
    currentStore = { ...storeFor(state), pickAttachment, previewAttachment }

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Editor context' }))
    fireEvent.click(screen.getByRole('button', { name: 'Attach file' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Preview photo.png' }))
    const lightbox = await screen.findByRole('dialog', { name: 'Preview photo.png' })
    await waitFor(() => expect(within(lightbox).getByText('Unable to load image')).toBeDefined())
    fireEvent.click(within(lightbox).getByRole('button', { name: 'Close preview' }))

    fireEvent.click(screen.getByRole('button', { name: 'Remove photo.png' }))
    fireEvent.click(screen.getByRole('button', { name: 'Editor context' }))
    fireEvent.click(screen.getByRole('button', { name: 'Attach file' }))
    await screen.findByRole('button', { name: 'Preview photo.png' })

    await waitFor(() => expect(previewAttachment).toHaveBeenCalledTimes(2))
  })

  it('offers the open-file picker on a session whose candidate list was never listed', async () => {
    const state = connectedState(true)
    const listOpenFiles = vi
      .fn()
      .mockResolvedValue([{ id: 'dsh-open-file-1', name: 'LICENSE', active: true, supported: true }])
    const attachOpenFile = vi.fn().mockResolvedValue({
      uri: 'dsh-attachment:00000000-0000-4000-8000-000000000001',
      name: 'LICENSE',
      mimeType: 'text/plain',
    })
    currentStore = { ...storeFor(state), listOpenFiles, attachOpenFile }

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Editor context' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Choose an open file' }))
    fireEvent.click(await screen.findByRole('option', { name: /LICENSE/u }))

    await waitFor(() => expect(attachOpenFile).toHaveBeenCalledWith('dsh-open-file-1', expect.any(Function)))
    expect(await screen.findByRole('button', { name: 'Remove LICENSE' })).toBeDefined()
  })

  it('restarts the error dismissal window when the same failure repeats', async () => {
    vi.useFakeTimers()
    try {
      const state = connectedState(true)
      const pickAttachment = vi.fn().mockRejectedValue(new Error('Host refused the attachment'))
      currentStore = { ...storeFor(state), pickAttachment }

      render(<App />)
      const failAttachment = async (): Promise<void> => {
        fireEvent.click(screen.getByRole('button', { name: 'Editor context' }))
        fireEvent.click(screen.getByRole('button', { name: 'Attach file' }))
        await act(async () => {
          await Promise.resolve()
        })
      }

      await failAttachment()
      expect(screen.queryByText('Host refused the attachment')).not.toBeNull()

      act(() => {
        vi.advanceTimersByTime(5_000)
      })
      await failAttachment()

      // 3s after the repeat the toast must still be up: the second failure owns
      // a fresh window, it does not inherit the first one's deadline.
      act(() => {
        vi.advanceTimersByTime(3_000)
      })
      expect(screen.queryByText('Host refused the attachment')).not.toBeNull()

      act(() => {
        vi.advanceTimersByTime(5_000)
      })
      expect(screen.queryByText('Host refused the attachment')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('dismisses the error toast on demand', async () => {
    const state = connectedState(true)
    const pickAttachment = vi.fn().mockRejectedValue(new Error('Host refused the attachment'))
    currentStore = { ...storeFor(state), pickAttachment }

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Editor context' }))
    fireEvent.click(screen.getByRole('button', { name: 'Attach file' }))
    await screen.findByText('Host refused the attachment')

    fireEvent.click(screen.getByRole('button', { name: /^Show notifications/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss error' }))

    expect(screen.queryByText('Host refused the attachment')).toBeNull()
  })

  it('keeps the open-file row hidden when the listed open files cannot be attached', async () => {
    const state = connectedState(true)
    const listOpenFiles = vi
      .fn()
      .mockResolvedValue([{ id: 'dsh-open-file-1', name: 'archive.bin', active: true, supported: false }])
    currentStore = { ...storeFor(state), listOpenFiles }

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Editor context' }))
    await act(async () => {
      await Promise.resolve()
    })

    expect(listOpenFiles).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Attach file' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Choose an open file' })).toBeNull()
  })

  it('does not leave the open-file picker open after its menu is dismissed', async () => {
    const state = connectedState(true)
    currentStore = {
      ...storeFor(state),
      listOpenFiles: vi
        .fn()
        .mockResolvedValue([{ id: 'dsh-open-file-1', name: 'LICENSE', active: true, supported: true }]),
    }

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Editor context' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Choose an open file' }))
    await screen.findByRole('option', { name: /LICENSE/u })

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Editor context' }))

    expect(screen.queryByRole('dialog', { name: 'Open files' })).toBeNull()
  })

  it('keeps the picker loading while a superseded open-file request is still settling', async () => {
    const state = connectedState(true)
    const deferred: Array<(value: OpenFileCandidate[]) => void> = []
    const candidates: OpenFileCandidate[] = [
      { id: 'dsh-open-file-1', name: 'LICENSE', active: true, supported: true },
    ]
    // The menu-open refresh answers; both picker requests hang until the test
    // settles them out of order.
    const listOpenFiles = vi
      .fn<() => Promise<OpenFileCandidate[]>>()
      .mockImplementationOnce(() => Promise.resolve(candidates))
      .mockImplementation(() => new Promise((resolve) => deferred.push(resolve)))
    currentStore = { ...storeFor(state), listOpenFiles }

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Editor context' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Choose an open file' }))
    await screen.findByRole('dialog', { name: 'Open files' })
    expect(screen.getByText('Loading…')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Close open files' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Choose an open file' }))
    expect(await screen.findByRole('dialog', { name: 'Open files' })).toBeDefined()
    expect(screen.getByText('Loading…')).toBeDefined()

    // The first picker request settles after being superseded; ending the
    // loading here would strand the user on a stale or empty candidate list.
    await act(async () => {
      deferred[0]?.([])
      await Promise.resolve()
    })
    expect(screen.getByText('Loading…')).toBeDefined()

    await act(async () => {
      deferred[1]?.(candidates)
      await Promise.resolve()
    })
    expect(screen.queryByText('Loading…')).toBeNull()
    expect(screen.getByRole('option', { name: /LICENSE/u })).toBeDefined()
  })

  it('keeps one draft chip when the same picker file is selected twice', async () => {
    const state = connectedState(true)
    const firstUri = 'dsh-attachment:00000000-0000-4000-8000-000000000001'
    const secondUri = 'dsh-attachment:00000000-0000-4000-8000-000000000002'
    const pickAttachment = vi
      .fn()
      .mockResolvedValueOnce({ uri: firstUri, name: 'notes.txt', mimeType: 'text/plain' })
      .mockResolvedValueOnce({ uri: secondUri, name: 'notes.txt', mimeType: 'text/plain' })
    const releaseAttachments = vi.fn().mockResolvedValue(undefined)
    currentStore = {
      ...storeFor(state),
      pickAttachment,
      releaseAttachments,
    }

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Editor context' }))
    fireEvent.click(screen.getByRole('button', { name: 'Attach file' }))
    fireEvent.click(screen.getByRole('button', { name: 'Editor context' }))
    fireEvent.click(screen.getByRole('button', { name: 'Attach file' }))

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Remove notes.txt' })).toHaveLength(1))
    expect(releaseAttachments).toHaveBeenCalledWith([secondUri])
  })

  it.each(['rejected', 'superseded'])('keeps the draft when another-session open is %s', async (outcome) => {
    const state = connectedState(true)
    const uri = 'dsh-attachment:00000000-0000-4000-8000-000000000009'
    const pickAttachment = vi.fn().mockResolvedValue({ uri, name: 'notes.txt', mimeType: 'text/plain' })
    const releaseAttachments = vi.fn().mockResolvedValue(undefined)
    // A disconnected or restarted DSH rejects the open after the store's own
    // bounded retries, so a rejected `session.open` is a normal outcome.
    // Superseded opens resolve without changing the active session.
    const openSession =
      outcome === 'rejected'
        ? vi.fn().mockRejectedValue(new Error('Unable to open session.'))
        : vi.fn().mockResolvedValue(undefined)
    const withSecond: AppState = {
      ...state,
      sessions: [
        ...state.sessions,
        {
          id: 's2',
          title: 'Another',
          workspaceId: 'w1',
          blank: false,
          status: 'idle' as const,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      workspaces: [{ ...state.workspaces[0]!, sessionIds: ['s1', 's2'], sessionCount: 2 }],
      drawer: 'sessions',
    }
    currentStore = { ...storeFor(withSecond), pickAttachment, releaseAttachments, openSession }

    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Prompt' }), {
      target: { value: 'a prompt I do not want to retype' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Editor context' }))
    fireEvent.click(screen.getByRole('button', { name: 'Attach file' }))
    await screen.findByRole('button', { name: 'Remove notes.txt' })

    fireEvent.click(await screen.findByText('Another'))
    await waitFor(() => expect(openSession).toHaveBeenCalledWith('s2'))

    // The open failed, so the user is still in the session that owns the draft.
    // Losing it here would cost them both the text and the host-file handle.
    expect(screen.getByRole('textbox', { name: 'Prompt' }).textContent).toBe(
      'a prompt I do not want to retype',
    )
    expect(screen.getByRole('button', { name: 'Remove notes.txt' })).toBeDefined()
    expect(releaseAttachments).not.toHaveBeenCalled()
  })

  it.each(['rejected', 'superseded'])('keeps the draft when new-session staging is %s', async (outcome) => {
    const state = connectedState(true)
    const uri = 'dsh-attachment:00000000-0000-4000-8000-000000000010'
    const pickAttachment = vi.fn().mockResolvedValue({ uri, name: 'notes.txt', mimeType: 'text/plain' })
    const releaseAttachments = vi.fn().mockResolvedValue(undefined)
    // `stageSession` throws while no workspace is resolvable yet, which is a
    // normal transient state on first load.
    const stageSession =
      outcome === 'rejected'
        ? vi.fn().mockRejectedValue(new Error('Loading workspaces…'))
        : vi.fn().mockResolvedValue(undefined)
    currentStore = { ...storeFor(state), pickAttachment, releaseAttachments, stageSession }

    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Prompt' }), {
      target: { value: 'a prompt I do not want to retype' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Editor context' }))
    fireEvent.click(screen.getByRole('button', { name: 'Attach file' }))
    await screen.findByRole('button', { name: 'Remove notes.txt' })

    fireEvent.click(screen.getByRole('button', { name: 'New Session' }))
    await waitFor(() => expect(stageSession).toHaveBeenCalled())

    // No session was staged, so the draft still belongs to the composer.
    expect(screen.getByRole('textbox', { name: 'Prompt' }).textContent).toBe(
      'a prompt I do not want to retype',
    )
    expect(screen.getByRole('button', { name: 'Remove notes.txt' })).toBeDefined()
    expect(releaseAttachments).not.toHaveBeenCalled()
  })

  it('keeps the draft and a still-valid attachment when a superseded pending send reports cancelled', async () => {
    const state = connectedState(false)
    let rejectSend: (reason: unknown) => void = () => undefined
    const send = new Promise<void>((_resolve, reject) => {
      rejectSend = reject
    })
    const sendPendingPrompt = vi.fn().mockReturnValueOnce(send)
    const uri = 'dsh-attachment:00000000-0000-4000-8000-000000000012'
    const laterUri = 'dsh-attachment:00000000-0000-4000-8000-000000000013'
    const ingestAttachment = vi
      .fn()
      .mockResolvedValueOnce({ uri, name: 'notes.txt', mimeType: 'text/plain' })
      .mockResolvedValue({ uri: laterUri, name: 'later.txt', mimeType: 'text/plain' })
    const releaseAttachments = vi.fn().mockResolvedValue(undefined)
    const { updateState } = renderWithMutableState({
      ...state,
      pendingSession: { revision: 1, workspaceId: 'w1', configuration: state.configuration! },
    })
    Object.assign(currentStore, { sendPendingPrompt, ingestAttachment, releaseAttachments })

    const input = document.querySelector('.dsh-composer textarea')
    expect(input).toBeInstanceOf(HTMLTextAreaElement)
    fireEvent.change(input!, { target: { value: 'a prompt I do not want to retype' } })
    fireEvent.paste(input!, {
      clipboardData: { files: [new File(['notes'], 'notes.txt', { type: 'text/plain' })] },
    })
    await screen.findByRole('button', { name: 'Remove notes.txt' })
    fireEvent.submit(input!.closest('form')!)
    await waitFor(() =>
      expect(sendPendingPrompt).toHaveBeenCalledWith(
        'a prompt I do not want to retype',
        [expect.anything()],
        'queue',
        expect.any(AbortSignal),
      ),
    )

    // The user navigates to an existing session while the send is still
    // working: the switch discards the pending composition's own attachment,
    // and the draft text survives the navigation by design.
    updateState({
      ...state,
      activeSessionId: 's2',
      sessions: [
        ...state.sessions,
        {
          id: 's2',
          title: 'Another',
          workspaceId: 'w1',
          blank: false,
          status: 'idle' as const,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      workspaces: [{ ...state.workspaces[0]!, sessionIds: ['s1', 's2'], sessionCount: 2 }],
    })
    await waitFor(() => expect(releaseAttachments).toHaveBeenCalledWith([uri]))
    const sessionPrompt = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Prompt' })
    fireEvent.paste(sessionPrompt, {
      clipboardData: { files: [new File(['later'], 'later.txt', { type: 'text/plain' })] },
    })
    await screen.findByRole('button', { name: 'Remove later.txt' })

    // The send reports cancelled — nothing was delivered — so the composer
    // must keep both the visible draft and the attachment added afterwards.
    await act(async () => {
      rejectSend(Object.assign(new Error('cancelled'), { code: 'REQUEST_CANCELLED' }))
      await send.catch(() => undefined)
    })
    expect(await screen.findByText(/^Prompt failed\./)).toBeDefined()
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Prompt' }).value).toBe(
      'a prompt I do not want to retype',
    )
    expect(screen.getByRole('button', { name: 'Remove later.txt' })).toBeDefined()
  })

  it('releases the previous attachment handles only when the displayed draft changes', async () => {
    const state = connectedState(true)
    const { updateState } = renderWithMutableState(state)
    const uri = 'dsh-attachment:00000000-0000-4000-8000-000000000011'
    vi.spyOn(currentStore, 'pickAttachment').mockResolvedValue({
      uri,
      name: 'notes.txt',
      mimeType: 'text/plain',
    })
    const releaseAttachments = vi.spyOn(currentStore, 'releaseAttachments')
    fireEvent.change(screen.getByRole('textbox', { name: 'Prompt' }), { target: { value: 'Old draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Editor context' }))
    fireEvent.click(screen.getByRole('button', { name: 'Attach file' }))
    await screen.findByRole('button', { name: 'Remove notes.txt' })

    updateState({
      ...state,
      activeSessionId: undefined,
      pendingSession: { revision: 1, workspaceId: 'w1', configuration: state.configuration! },
    })
    await waitFor(() => expect(releaseAttachments).toHaveBeenCalledWith([uri]))
    expect(screen.queryByRole('button', { name: 'Remove notes.txt' })).toBeNull()
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Prompt' }).value).toBe('')
    updateState({
      ...state,
      activeSessionId: undefined,
      pendingSession: { revision: 1, workspaceId: 'w1', configuration: state.configuration! },
    })
    expect(releaseAttachments).toHaveBeenCalledOnce()
  })

  it('applies the selected interface language from Settings across the conversation', async () => {
    let dshLocale = 'en'
    const readDshSettings = vi.fn(() => Promise.resolve(dshLocaleSettingsSnapshot(dshLocale)))
    const updateDshSetting = vi.fn((path: string, value: unknown) => {
      if (path === 'locale.preference' && typeof value === 'string') dshLocale = value
      return Promise.resolve()
    })
    currentStore = {
      ...storeFor({ ...connectedState(true), drawer: 'settings' }),
      readDshSettings,
      updateDshSetting,
    }
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    )

    await waitFor(() => expect(readDshSettings).toHaveBeenCalledTimes(1))

    fireEvent.click(await screen.findByRole('button', { name: '中文' }))

    expect(screen.getByRole('toolbar', { name: 'DSH 工具栏' })).toBeDefined()
    expect(screen.getByPlaceholderText('输入消息…')).toBeDefined()
    expect(screen.getByRole('button', { name: '发送消息' })).toBeDefined()
    expect(document.documentElement.lang).toBe('zh-CN')

    await waitFor(() => expect(updateDshSetting).toHaveBeenCalledWith('locale.preference', 'zh', 1))
  })

  it('uses the Settings language control for the shared extension and DSH preference', async () => {
    let dshLocale = 'en'
    const readDshSettings = vi.fn(() => Promise.resolve(dshLocaleSettingsSnapshot(dshLocale)))
    const updateDshSetting = vi.fn((path: string, value: unknown) => {
      if (path === 'locale.preference' && typeof value === 'string') dshLocale = value
      return Promise.resolve()
    })
    currentStore = {
      ...storeFor({ ...connectedState(true), drawer: 'settings' }),
      readDshSettings,
      updateDshSetting,
    }

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    )

    const group = await screen.findByRole('group', { name: 'Interface language' })
    fireEvent.click(within(group).getByRole('button', { name: '中文' }))

    expect(document.documentElement.lang).toBe('zh-CN')
    await waitFor(() => expect(updateDshSetting).toHaveBeenCalledWith('locale.preference', 'zh', 1))
    expect(window.localStorage.getItem(LOCALE_EXPLICIT_STORAGE_KEY)).toBe('true')
  })

  it.each([
    { preference: 'en', local: 'zh', advertised: true, expected: 'Message…', lang: 'en' },
    { preference: 'zh-Hans', local: 'en', advertised: true, expected: '输入消息…', lang: 'zh-CN' },
    { preference: 'fr-FR', local: 'zh', advertised: true, expected: 'Message…', lang: 'en' },
    { preference: 'en', local: 'zh', advertised: false, expected: '输入消息…', lang: 'zh-CN' },
  ])(
    'adopts only an advertised DSH locale preference ($preference, advertised=$advertised)',
    async ({ preference, local, advertised, expected, lang }) => {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, local)
      window.localStorage.setItem(LOCALE_EXPLICIT_STORAGE_KEY, 'true')
      document.documentElement.lang = local === 'zh' ? 'en' : 'zh-CN'
      const updateDshSetting = vi.fn().mockResolvedValue(undefined)
      const readDshSettings = vi.fn().mockResolvedValue(dshLocaleSettingsSnapshot(preference, advertised))
      currentStore = {
        ...storeFor(connectedState(true)),
        readDshSettings,
        updateDshSetting,
      }

      render(
        <I18nProvider>
          <App />
        </I18nProvider>,
      )

      await screen.findByPlaceholderText(expected)
      await waitFor(() => expect(document.documentElement.lang).toBe(lang))
      expect(readDshSettings).toHaveBeenCalled()
      expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe(local)
      expect(window.localStorage.getItem(LOCALE_EXPLICIT_STORAGE_KEY)).toBe('true')
      expect(updateDshSetting).not.toHaveBeenCalled()
    },
  )

  it('keeps the editor language fallback when DSH settings cannot be read', async () => {
    document.documentElement.lang = 'zh-Hant'
    const readDshSettings = vi.fn().mockRejectedValue(new Error('settings are unavailable'))
    currentStore = { ...storeFor(connectedState(true)), readDshSettings }

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    )

    await screen.findByPlaceholderText('输入消息…')
    await waitFor(() => expect(document.documentElement.lang).toBe('zh-CN'))
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull()
    expect(window.localStorage.getItem(LOCALE_EXPLICIT_STORAGE_KEY)).toBeNull()
  })

  it('restores the editor locale after the connected DSH disconnects', async () => {
    document.documentElement.lang = 'zh-Hans'
    let state = connectedState(true)
    const store: AppStore = {
      ...storeFor(state),
      getState: () => state,
      readDshSettings: vi.fn().mockResolvedValue(dshLocaleSettingsSnapshot('en')),
    }
    currentStore = store
    const tree = (): ReactElement => (
      <I18nProvider>
        <>
          <ActiveLocaleOutput />
          <App />
        </>
      </I18nProvider>
    )
    const view = render(tree())

    await screen.findByPlaceholderText('Message…')
    expect(screen.getByTestId('active-locale').textContent).toBe('en')
    expect(document.documentElement.lang).toBe('en')

    state = { ...state, backend: { kind: 'idle' } }
    view.rerender(tree())

    await waitFor(() => expect(screen.getByTestId('active-locale').textContent).toBe('zh'))
    expect(document.documentElement.lang).toBe('zh-CN')
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull()
    expect(window.localStorage.getItem(LOCALE_EXPLICIT_STORAGE_KEY)).toBeNull()
  })

  it('keeps an explicit local locale through disconnect and DSH version replacement', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'zh')
    window.localStorage.setItem(LOCALE_EXPLICIT_STORAGE_KEY, 'true')
    document.documentElement.lang = 'en'
    let state = connectedState(true)
    const readDshSettings = vi
      .fn()
      .mockResolvedValueOnce(dshLocaleSettingsSnapshot('en'))
      .mockResolvedValue(dshUiSettingsSnapshot())
    const store: AppStore = {
      ...storeFor(state),
      getState: () => state,
      readDshSettings,
    }
    currentStore = store
    const tree = (): ReactElement => (
      <I18nProvider>
        <>
          <ActiveLocaleOutput />
          <App />
        </>
      </I18nProvider>
    )
    const view = render(tree())

    await waitFor(() => expect(screen.getByTestId('active-locale').textContent).toBe('en'))
    expect(document.documentElement.lang).toBe('en')

    state = { ...state, backend: { kind: 'idle' } }
    view.rerender(tree())
    await waitFor(() => expect(screen.getByTestId('active-locale').textContent).toBe('zh'))
    expect(document.documentElement.lang).toBe('zh-CN')

    state = {
      ...state,
      backend: { kind: 'connected' },
      connectedDshVersion: '0.1.0-rc.7',
    }
    view.rerender(tree())
    await waitFor(() => expect(readDshSettings).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByTestId('active-locale').textContent).toBe('zh'))
    expect(document.documentElement.lang).toBe('zh-CN')
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh')
    expect(window.localStorage.getItem(LOCALE_EXPLICIT_STORAGE_KEY)).toBe('true')
  })

  it.each(['disconnect', 'version replacement'] as const)(
    'ignores a successful settings read that arrives after %s',
    async (transition) => {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, 'zh')
      window.localStorage.setItem(LOCALE_EXPLICIT_STORAGE_KEY, 'true')
      document.documentElement.lang = 'en'
      let resolveOldRead: (snapshot: DshSettingsSnapshot) => void = () => undefined
      let resolveNewRead: (snapshot: DshSettingsSnapshot) => void = () => undefined
      const oldRead = new Promise<DshSettingsSnapshot>((resolve) => {
        resolveOldRead = resolve
      })
      const newRead = new Promise<DshSettingsSnapshot>((resolve) => {
        resolveNewRead = resolve
      })
      let state = connectedState(true)
      const readDshSettings = vi
        .fn()
        .mockImplementationOnce(() => oldRead)
        .mockImplementation(() => newRead)
      const store: AppStore = {
        ...storeFor(state),
        getState: () => state,
        readDshSettings,
      }
      currentStore = store
      const tree = (): ReactElement => (
        <I18nProvider>
          <>
            <ActiveLocaleOutput />
            <App />
          </>
        </I18nProvider>
      )
      const view = render(tree())

      await screen.findByPlaceholderText('输入消息…')
      await waitFor(() => expect(readDshSettings).toHaveBeenCalledTimes(1))
      if (transition === 'disconnect') {
        state = { ...state, backend: { kind: 'idle' } }
      } else {
        state = { ...state, connectedDshVersion: '0.1.0-rc.7' }
      }
      view.rerender(tree())

      if (transition === 'version replacement') {
        await waitFor(() => expect(readDshSettings).toHaveBeenCalledTimes(2))
      }
      await waitFor(() => expect(screen.getByTestId('active-locale').textContent).toBe('zh'))
      await act(async () => {
        resolveOldRead(dshLocaleSettingsSnapshot('en'))
        await oldRead
      })
      expect(screen.getByTestId('active-locale').textContent).toBe('zh')
      expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh')
      expect(window.localStorage.getItem(LOCALE_EXPLICIT_STORAGE_KEY)).toBe('true')

      if (transition === 'version replacement') {
        await act(async () => {
          resolveNewRead(dshUiSettingsSnapshot())
          await newRead
        })
        await waitFor(() => expect(screen.getByTestId('active-locale').textContent).toBe('zh'))
      }
      await waitFor(() => expect(document.documentElement.lang).toBe('zh-CN'))
    },
  )

  it('folds todo content into the goals/tasks header dock', () => {
    const state = connectedState(true)
    currentStore = storeFor({
      ...state,
      todos: [
        { id: 'todo-1', content: '查询系统信息', status: 'completed' },
        { id: 'todo-2', content: '执行子代理调研', status: 'in-progress' },
      ],
    })
    const { container } = render(<App />)

    const dock = container.querySelector('.dsh-goals-tasks')
    expect(dock).not.toBeNull()
    const todoList = dock?.querySelector('.dsh-todo-list')
    expect(todoList).not.toBeNull()
    const todoToggle = todoList?.querySelector<HTMLButtonElement>('.dsh-todo-list__toggle')
    expect(todoToggle?.textContent).toContain('执行子代理调研')
    expect(todoToggle?.textContent).not.toContain('查询系统信息')
    expect(container.querySelector('.dsh-compose-area .dsh-todo-list')).toBeNull()
    expect(container.querySelector('.dsh-conversation > .dsh-goal-strip')).toBeNull()
  })

  it('keeps the goals/tasks dock in flow above the transcript', () => {
    const state = connectedState(true)
    currentStore = storeFor({
      ...state,
      goals: [{ id: 'goal-1', title: 'Ship the dock placement', status: 'in-progress' }],
    })
    const { container } = render(<App />)

    const dock = container.querySelector<HTMLElement>('.dsh-goals-tasks')
    const timeline = screen.getByTestId('timeline')
    expect(dock).not.toBeNull()
    // jsdom has no layout engine, so containment and document order stand in
    // for geometry: the dock is ordinary conversation content that sits above
    // the transcript, never a modal or a floating overlay.
    expect(dock?.closest('.dsh-conversation')).not.toBeNull()
    expect(dock?.closest('[role="dialog"]')).toBeNull()
    expect(dock?.getAttribute('role')).not.toBe('dialog')
    expect(dock!.compareDocumentPosition(timeline) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('hides the performance line when performance usage is compact', async () => {
    const readDshSettings = vi.fn().mockResolvedValue(dshUiSettingsSnapshot(undefined, undefined, 'compact'))
    currentStore = { ...storeFor(connectedState(true)), readDshSettings }
    const { container } = render(<App />)

    await waitFor(() => expect(readDshSettings).toHaveBeenCalled())
    expect(container.querySelector('.dsh-composer__status')).toBeNull()
  })

  it('keeps the performance line when performance usage is detailed', async () => {
    const readDshSettings = vi.fn().mockResolvedValue(dshUiSettingsSnapshot(undefined, undefined, 'detailed'))
    currentStore = { ...storeFor(connectedState(true)), readDshSettings }
    const { container } = render(<App />)

    await waitFor(() => expect(readDshSettings).toHaveBeenCalled())
    expect(container.querySelector('.dsh-composer__status')).not.toBeNull()
  })

  it('floats pending questions outside the composer layout', () => {
    const state = connectedState(true)
    currentStore = storeFor({
      ...state,
      questions: [
        {
          id: 'question-1',
          sessionId: 's1',
          prompt: 'Choose a mode',
          choices: [{ id: 'chat', label: 'Chat' }],
          allowFreeText: false,
        },
      ],
    })
    const { container } = render(<App />)

    const interactions = container.querySelector('.dsh-conversation__interactions')
    expect(interactions).not.toBeNull()
    expect(interactions?.parentElement?.classList.contains('dsh-conversation')).toBe(true)
    // The slot itself must not be a live region. A timed question rewrites its
    // countdown every 250ms, and a `polite` container turns that into a stream
    // of interruptions for as long as the card is visible.
    expect(interactions?.getAttribute('aria-live')).toBeNull()
    expect(interactions?.getAttribute('role')).toBeNull()
    expect(container.querySelector('.dsh-compose-area .dsh-interaction')).toBeNull()
  })

  it('shows the command of the paired tool call on a pending approval', () => {
    const command = 'rm -rf build && pnpm install --frozen-lockfile && pnpm build'
    const state = connectedState(true)
    currentStore = storeFor({
      ...state,
      permissions: [
        {
          id: 'approval-1',
          sessionId: 's1',
          title: 'bash',
          description: 'The command needs approval.',
          callId: 'call-bash-1',
          risk: 'medium',
          options: [
            { id: 'allowed-once', label: 'Allow once', kind: 'allow-once' },
            { id: 'rejected', label: 'Reject', kind: 'deny' },
          ],
        },
      ],
      timeline: {
        ...state.timeline,
        nodes: [
          {
            kind: 'tool',
            id: 'call-bash-1',
            tool: {
              id: 'call-bash-1',
              name: 'bash',
              category: 'terminal',
              title: command,
              status: 'running',
              presentation: { phase: 'call', card: 'terminal', title: command },
              metadata: {},
            },
          },
        ],
      },
    })
    render(<App />)

    // The request itself names the tool, not the command: what the user is
    // authorizing only exists on the paired call.
    expect(screen.getByText(command)).toBeDefined()
  })
})
