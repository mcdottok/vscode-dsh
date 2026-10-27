import * as vscode from 'vscode'
import { DesktopPairing } from './backend/desktop-pairing.js'
import { canRecoverDesktop, desktopRecoveryState } from './backend/desktop-recovery.js'
import {
  DesktopAutoDiscovery,
  allowsAutomaticDesktop,
  AUTOMATIC_DESKTOP_ORIGIN,
} from './backend/desktop-auto-discovery.js'
import { connectDesktop } from './vscode/connect-desktop.js'
import { WindowsDesktopDiscoveryProvider } from './backend/discovery/windows-desktop-provider.js'
import type { DshRuntimeUpdateProgress, EditorContextOwner, SessionSummary } from '@dsh-vscode/domain'
import {
  featureHostEnvelopeSchema,
  featureHostMessageSchema,
  hostEnvelopeSchema,
  hostMessageSchema,
  type FeatureHostMessage,
  type HostMessage,
} from '@dsh-vscode/webview-protocol'

export {
  JobFollowRegistry,
  relayJobFollowFrames,
  resolveJobFollowOffset,
} from './backend/job-follow-registry.js'
export { createManagedEndpointLoginHandler } from './composition/connection-assembly.js'
import { PluginInstallRequestCoordinator } from './plugins/plugin-bundle-feature-handler.js'
import { diagnosticLevel, RedactedDiagnostics } from './backend/diagnostics.js'
import { VsCodeConfigurationSource } from './config/configuration-source.js'
import { OUTPUT_CHANNEL_NAME } from './constants.js'
import { workspaceFolderId } from './editor/workspace-path-guard.js'
import { DSH_CHAT_VIEW_OWNER_ID } from './editor/editor-context-provider.js'
import { sessionWorkspaceFolderId, hasLocalWorkspaceAuthority } from './view/session-workspace-scope.js'
import { readExtensionVersion, endpointFromServerUrl } from './composition/runtime.js'
import { AppError, type BackendEndpoint, type ConnectedBackend } from '@dsh-vscode/domain'
import { sameWorkspacePath } from './composition/workspace-state.js'
import { createSessionScope } from './composition/session-scope.js'
import { createUseCasesAssembly } from './composition/use-cases-assembly.js'
import { createConnectionLifecycle, createRuntimeAssembly } from './composition/connection-assembly.js'
import { createHostEventPipeline } from './composition/host-event-pipeline.js'
import { createChangeCheckpointTaskAssembly } from './composition/change-checkpoint-task-assembly.js'
import { createJobFollowHost } from './composition/job-follow-host.js'
import { createBackendAttach } from './composition/backend-attach.js'
import { createFeatureContext } from './composition/feature-context.js'
import { createFeatureRequestHandler } from './composition/feature-request-handler.js'
import { createRequestGateway } from './composition/request-handler.js'
import { WebviewSurfaceRegistry } from './view/webview-surface-registry.js'
import { createCommandsAssembly } from './composition/commands-assembly.js'
import { TranscriptWindowService } from './view/transcript-window.js'
import { TranscriptWindowRegistry } from './view/transcript-window-registry.js'
import { publicValue } from './composition/public-projection.js'
import type { SessionNavigation } from './composition/session-navigation.js'

export interface CompositionRoot extends vscode.Disposable {
  start(): Promise<void>
}

/**
 * Orchestration shell: builds the shared base services and closures, then
 * assembles the subsystems from `composition/` in dependency order. Every
 * moved body lives in a dedicated assembly module; the start/dispose sequence
 * in `commands-assembly.ts` preserves the original teardown order exactly.
 */
export function createCompositionRoot(context: vscode.ExtensionContext): CompositionRoot {
  const pluginInstallRequests = new PluginInstallRequestCoordinator()
  const configuration = new VsCodeConfigurationSource(vscode.workspace)
  const extensionVersion = readExtensionVersion(context)
  const channel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME)
  const diagnostics = new RedactedDiagnostics(channel, () =>
    diagnosticLevel(vscode.workspace.getConfiguration('dsh.developer').get<string>('logLevel')),
  )
  const currentWorkspaceFolders = (): readonly vscode.WorkspaceFolder[] => {
    const folders = vscode.workspace.workspaceFolders
    if (folders !== undefined && folders.length > 0) return folders
    const activeEditor = vscode.window.activeTextEditor
    const activeFolder =
      activeEditor === undefined ? undefined : vscode.workspace.getWorkspaceFolder(activeEditor.document.uri)
    return activeFolder === undefined ? [] : [activeFolder]
  }
  const currentWorkspaceFolder = (): vscode.WorkspaceFolder | undefined => {
    const activeEditor = vscode.window.activeTextEditor
    const activeFolder =
      activeEditor === undefined ? undefined : vscode.workspace.getWorkspaceFolder(activeEditor.document.uri)
    return activeFolder ?? currentWorkspaceFolders()[0]
  }
  // Every live chat Webview. Surfaces are registered below, so `post` and
  // `postTo` read them through this binding; no message can be posted before
  // composition has finished.
  const surfaces = new WebviewSurfaceRegistry()
  const nativeNavigation: { current?: SessionNavigation } = {}
  const hostEnvelope = (message: HostMessage | FeatureHostMessage): object | undefined => {
    const legacy = hostMessageSchema.safeParse(message)
    if (legacy.success) return hostEnvelopeSchema.parse({ protocolVersion: 1, message: legacy.data })
    const feature = featureHostMessageSchema.safeParse(message)
    if (feature.success) return featureHostEnvelopeSchema.parse({ protocolVersion: 1, message: feature.data })
    diagnostics.log('warn', 'host-message-rejected', { code: 'PROTOCOL_ERROR' })
    return undefined
  }
  const post = (message: HostMessage | FeatureHostMessage): Thenable<boolean> => {
    const envelope = hostEnvelope(message)
    return envelope === undefined ? Promise.resolve(false) : surfaces.post(envelope)
  }
  const postTo = (surfaceId: string, message: HostMessage | FeatureHostMessage): Thenable<boolean> => {
    const envelope = hostEnvelope(message)
    return envelope === undefined ? Promise.resolve(false) : surfaces.postTo(surfaceId, envelope)
  }
  const currentWorkspaceFolderId = (): string | undefined => {
    const folder = currentWorkspaceFolder()
    return folder === undefined ? undefined : workspaceFolderId(folder)
  }
  const workspaceFolderIdForSession = (session: Pick<SessionSummary, 'cwd'>): string | undefined => {
    const state = coordinator.getState()
    return hasLocalWorkspaceAuthority(state.kind === 'connected' ? state.backend : undefined)
      ? sessionWorkspaceFolderId({
          folders: currentWorkspaceFolders().map((folder) => ({
            id: workspaceFolderId(folder),
            path: folder.uri.fsPath,
          })),
          session,
          samePath: sameWorkspacePath,
        })
      : undefined
  }
  // The runtime update progress publisher is late-bound: the updater exists
  // before the event pipeline that owns the real implementation.
  const runtimeUpdateProgress = {
    current: (_progress: DshRuntimeUpdateProgress): void => undefined,
  }

  const {
    runtimeLocator,
    coordinator,
    backendService,
    supervisor,
    runtimeInstaller,
    runtimeUseCases,
    endpointLaunchUrls,
    externalConnection,
  } = createRuntimeAssembly({
    context,
    configuration,
    diagnostics,
    currentWorkspaceFolder,
    onRuntimeUpdateProgress: (progress) => runtimeUpdateProgress.current(progress),
  })
  const {
    workspaceUseCases,
    sessionUseCases,
    modelUseCases,
    interactionUseCases,
    settingsUseCases,
    providerSettingsUseCases,
    advancedUseCases,
    exportUseCases,
    temporaryWorkspaceManager,
    attachmentTokens,
    editorContextProvider,
    editorContextUseCases,
    navigationUseCases,
  } = createUseCasesAssembly({ backendService, context })
  const {
    listCurrentWorkspaces,
    listCurrentArchivedSessionIds,
    ensureCurrentWorkspace,
    invalidateCurrentWorkspaceSessionDetails,
    requireCurrentWorkspaceSession,
    requireCurrentWorkspaceId,
    requireOwnedQueuedInput,
    requireOwnedGoal,
    requireOwnedPermission,
    requireOwnedQuestion,
  } = createSessionScope({
    backendService,
    workspaceUseCases,
    temporaryWorkspaceManager,
    currentWorkspaceFolders,
    currentWorkspaceFolder,
  })
  const featureOwner = (): EditorContextOwner => ({
    ownerId: DSH_CHAT_VIEW_OWNER_ID,
    ownerViewId: DSH_CHAT_VIEW_OWNER_ID,
    contextStoreGeneration: 1,
  })
  const currentConnectedBackend = (): ConnectedBackend | undefined => {
    const state = coordinator.getState()
    return state.kind === 'connected' ? state.backend : undefined
  }
  const transcript = new TranscriptWindowRegistry(
    (surfaceId, isCurrent) =>
      new TranscriptWindowService({
        read: (sessionId, before, signal, child) =>
          child
            ? advancedUseCases.listSubagentHistory(
                sessionId,
                { ...(before === undefined ? {} : { beforeSequence: before }), pageSize: 50 },
                signal,
              )
            : backendService
                .requireBackend()
                .sessions.history(sessionId, before, signal, { pageSize: 50, pagePurpose: 'transcript' }),
        publicValue: (value, cwd) =>
          publicValue(
            value,
            [
              ...currentWorkspaceFolders().map((folder) => folder.uri.fsPath),
              ...(temporaryWorkspaceManager.current?.path === undefined
                ? []
                : [temporaryWorkspaceManager.current.path]),
              ...(temporaryWorkspaceManager.reference?.path === undefined
                ? []
                : [temporaryWorkspaceManager.reference.path]),
            ],
            hasLocalWorkspaceAuthority(currentConnectedBackend()) ? cwd : undefined,
          ),
        post: (window) => postEventTo(surfaceId, 'session.transcript', window, isCurrent),
        postPatch: (patch) => postEventTo(surfaceId, 'session.transcript.patch', patch, isCurrent),
        observeTiming: (phase, durationMs, count) =>
          diagnostics.log('info', 'session-recovery', { phase, durationMs, count }),
        invalidate: (sessionId) => {
          void postEventTo(surfaceId, 'session.transcript.invalidated', { sessionId }, isCurrent)
        },
      }),
    (surfaceId) => {
      const surface = surfaces.get(surfaceId)
      return surface?.isReady === true && surface.visible
    },
  )
  let desktopRecoveryDepth = 0
  let recoverDesktop: () => boolean = () => false
  const {
    postFeatureEvent,
    publishAccountSnapshot,
    publishAccountSessionExpired,
    publishAccountError,
    postEditorContextAvailabilityEvent,
    postEvent,
    postEventTo,
    postBackendEvent,
    publishState: publishRawState,
    nextFeatureLocalSequence,
    dispose: disposeHostEventPipeline,
  } = createHostEventPipeline({
    transcript,
    post,
    postTo,
    onEvent: (name, payload) => nativeNavigation.current?.acceptEvent(name, payload),
    backendService,
    diagnostics,
    editorContextUseCases,
    featureOwner,
    currentWorkspaceFolders,
    temporaryWorkspaceManager,
    runtimeUpdateProgress,
  })
  const publishState = (state: Parameters<typeof publishRawState>[0]): void => {
    publishRawState(desktopRecoveryState(state, desktopRecoveryDepth > 0))
  }
  const {
    changeTracker,
    changeUseCases,
    checkpointUseCases,
    promptTemplateUseCases,
    taskRegistry,
    taskUseCases,
    taskFocus,
    postCheckpointFeatureEvent,
  } = createChangeCheckpointTaskAssembly({
    context,
    diagnostics,
    post,
    backendService,
    nextFeatureLocalSequence,
    workspaceFolderIdForSession,
    currentWorkspaceFolders,
    currentWorkspaceFolderId,
  })
  const { startJobFollow, stopJobFollow, stopAllJobFollows } = createJobFollowHost({
    advancedUseCases,
    backendService,
    diagnostics,
    requireCurrentWorkspaceSession,
  })
  const { attach, disposeAccountLifecycleHost, getAccountLifecycleHost, detachSessionAdapters } =
    createBackendAttach({
      backendService,
      sessionUseCases,
      extensionVersion,
      diagnostics,
      stopAllJobFollows,
      invalidateCurrentWorkspaceSessionDetails,
      changeTracker,
      taskRegistry,
      editorContextProvider,
      currentWorkspaceFolderId,
      taskFocus,
      postFeatureEvent,
      postBackendEvent,
      publishAccountSnapshot,
      publishAccountSessionExpired,
      publishAccountError,
      recoverDesktop: () => recoverDesktop(),
      publishRecoveredState: (backend) => {
        const state = coordinator.getState()
        if (state.kind === 'connected' && state.backend === backend.connection) publishState(state)
      },
    })
  const desktopPairing = new DesktopPairing(context.secrets)
  const desktopAutoDiscovery = new DesktopAutoDiscovery()
  const localAutomaticDiscovery = process.platform === 'win32' && vscode.env.remoteName === undefined
  const {
    connect,
    reconnect,
    reconnectOnTransportChange,
    configureConnection,
    resetConnection,
    pauseAutomaticConnection,
    isAutomaticConnectionPaused,
  } = createConnectionLifecycle({
    desktopPairing,
    ...(localAutomaticDiscovery
      ? {
          discoverAutomaticDesktop: (signal?: AbortSignal, expectedKey?: string) =>
            desktopAutoDiscovery.discover(signal, expectedKey),
        }
      : {}),
    onDesktopRecoveryState: (active) => {
      desktopRecoveryDepth += active ? 1 : -1
      if (active)
        diagnostics.connectionProgress({
          phase: 'connect',
          status: 'started',
          mode: configuration.read().connection.mode,
        })
    },
    onDesktopRecoveryFailure: (code) =>
      diagnostics.connectionProgress({ phase: 'connect', status: 'failed', code }),
    discoverDesktopVersion: async (endpoint, signal) => {
      const candidates = await new WindowsDesktopDiscoveryProvider().discoverEndpoints([endpoint], signal)
      const versions = new Set(
        candidates
          .filter((candidate) => candidate.runtimeVersionEvidence === 'process-manifest')
          .map((candidate) => candidate.runtimeVersion),
      )
      return versions.size === 1 ? [...versions][0] : undefined
    },
    context,
    configuration,
    coordinator,
    currentWorkspaceFolders,
    endpointLaunchUrls,
    externalConnection,
    attach,
    publishState,
    disposeAccountLifecycleHost,
    detachSessionAdapters,
  })
  const pairingLifetime = new AbortController()
  let lossRecoveryPending = false
  recoverDesktop = () => {
    if (lossRecoveryPending) return true
    if (
      !localAutomaticDiscovery ||
      !vscode.workspace.isTrusted ||
      isAutomaticConnectionPaused() ||
      pairingLifetime.signal.aborted ||
      !canRecoverDesktop(configuration.read().connection)
    )
      return false
    lossRecoveryPending = true
    desktopRecoveryDepth++
    publishState({ kind: 'discovering', attempt: 1, phase: 'discovery' })
    void reconnect(pairingLifetime.signal)
      .catch(() => undefined)
      .finally(() => {
        lossRecoveryPending = false
        desktopRecoveryDepth--
        if (!pairingLifetime.signal.aborted) publishState(coordinator.getState())
      })
    return true
  }
  let wasConnected = false
  const stopWatchingConnection = coordinator.subscribe((state) => {
    if (state.kind === 'connected') wasConnected = true
  })
  let checkingPair = false
  let lastAutomaticAvailable = true
  let lastPairAvailable = true
  const pairingTimer = setInterval(() => {
    if (
      checkingPair ||
      desktopRecoveryDepth > 0 ||
      isAutomaticConnectionPaused() ||
      !vscode.workspace.isTrusted ||
      pairingLifetime.signal.aborted
    )
      return
    const settings = configuration.read().connection
    const origin = settings.serverUrl
    const state = coordinator.getState()
    if (
      !['idle', 'failed', 'connected', 'runtime-missing', 'port-conflict'].includes(state.kind) ||
      (state.kind === 'idle' && wasConnected)
    )
      return
    const automaticOrigin = context.globalState.get<string>(AUTOMATIC_DESKTOP_ORIGIN)
    const automatic =
      localAutomaticDiscovery &&
      (allowsAutomaticDesktop(settings, automaticOrigin) ||
        (state.kind === 'failed' && canRecoverDesktop(settings)))
    const paired =
      settings.mode === 'custom' &&
      !!origin &&
      (context.workspaceState.get<string>('dsh.desktop.lastEndpoint') === origin ||
        automaticOrigin === origin)
    if (!automatic && !paired) return
    checkingPair = true
    void (async () => {
      if (automatic && (!origin || !(await desktopPairing.has(origin)))) {
        const available = await desktopAutoDiscovery.available(pairingLifetime.signal)
        const newlyAvailable = available && !lastAutomaticAvailable
        lastAutomaticAvailable = available
        if (state.kind !== 'connected' && newlyAvailable)
          if (!isAutomaticConnectionPaused()) await reconnect(pairingLifetime.signal)
        return
      }
      if (!origin) return
      if (!(await desktopPairing.has(origin))) return
      let changed: boolean
      try {
        changed = await desktopPairing.changed(origin, pairingLifetime.signal)
      } catch {
        lastPairAvailable = false
        return
      }
      const current = configuration.read().connection
      if (
        isAutomaticConnectionPaused() ||
        pairingLifetime.signal.aborted ||
        current.mode !== 'custom' ||
        current.serverUrl !== origin
      )
        return
      const currentState = coordinator.getState()
      const returned = !lastPairAvailable
      lastPairAvailable = true
      if (changed || (returned && currentState.kind === 'failed')) await reconnect(pairingLifetime.signal)
    })()
      .catch(() => undefined)
      .finally(() => {
        checkingPair = false
      })
  }, 3000)
  pairingTimer.unref()
  context.subscriptions.push({
    dispose: () => {
      pairingLifetime.abort()
      clearInterval(pairingTimer)
      stopWatchingConnection()
    },
  })
  const {
    featureContextOwner,
    currentFeatureSessionBinding,
    contextOwnerForSession,
    featureWorkspaceFolderId,
  } = createFeatureContext({
    backendService,
    featureOwner,
    currentWorkspaceFolders,
    workspaceFolderIdForSession,
    currentWorkspaceFolderId,
  })
  const { handleFeatureRequest } = createFeatureRequestHandler({
    editorCompanion: () => commands.editorCompanion,
    getAccountLifecycleHost,
    backendService,
    pluginInstallRequests,
    listCurrentWorkspaces,
    requireCurrentWorkspaceSession,
    featureContextOwner,
    editorContextUseCases,
    postFeatureEvent,
    postEditorContextAvailabilityEvent,
    navigationUseCases,
    changeUseCases,
    changeTracker,
    checkpointUseCases,
    featureWorkspaceFolderId,
    postCheckpointFeatureEvent,
    taskUseCases,
    taskRegistry,
    taskFocus,
    promptTemplateUseCases,
    currentWorkspaceFolders,
  })
  const gateway = createRequestGateway({
    prepareEditorSession: (sessionId, signal) => commands.editorCompanion.prepareSession(sessionId, signal),
    transcript,
    resyncView: async () => {
      const backend = backendService.requireBackend()
      for (const event of backendService.replayEvents()) await postBackendEvent(backend, event)
    },
    post,
    postTo,
    postEvent,
    postEventTo,
    surfaces,
    handleFeatureRequest,
    diagnostics,
    context,
    currentWorkspaceFolders,
    currentWorkspaceFolder,
    connect,
    reconnect,
    configureConnection,
    runtimeUseCases,
    runtimeLocator,
    coordinator,
    extensionVersion,
    configuration,
    backendService,
    listCurrentWorkspaces,
    listCurrentArchivedSessionIds,
    ensureCurrentWorkspace,
    requireCurrentWorkspaceSession,
    requireCurrentWorkspaceId,
    requireOwnedQueuedInput,
    requireOwnedGoal,
    requireOwnedPermission,
    requireOwnedQuestion,
    workspaceUseCases,
    sessionUseCases,
    modelUseCases,
    interactionUseCases,
    settingsUseCases,
    providerSettingsUseCases,
    advancedUseCases,
    exportUseCases,
    temporaryWorkspaceManager,
    attachmentTokens,
    editorContextUseCases,
    contextOwnerForSession,
    currentFeatureSessionBinding,
    workspaceFolderIdForSession,
    startJobFollow,
    stopJobFollow,
    stopAllJobFollows,
    editorContextProvider,
  })
  const { router, provider, editorSurfaces, moveChatToSidebar, openDroppedSession, sessionNavigation } =
    gateway
  nativeNavigation.current = sessionNavigation
  const commands = createCommandsAssembly({
    context,
    configuration,
    diagnostics,
    coordinator,
    router,
    provider,
    editorSurfaces,
    moveChatToSidebar,
    openDroppedSession,
    sessionNavigation,
    surfaces,
    runtimeLocator,
    runtimeInstaller,
    endpointLaunchUrls,
    reconnect,
    reconnectOnTransportChange,
    publishState,
    postEvent,
    postFeatureEvent,
    postEditorContextAvailabilityEvent,
    editorContextUseCases,
    featureContextOwner,
    editorContextProvider,
    invalidateCurrentWorkspaceSessionDetails,
    disposeAccountLifecycleHost,
    stopAllJobFollows,
    changeTracker,
    taskRegistry,
    backendService,
    supervisor,
    attachmentTokens,
    channel,
    connectDesktop: () =>
      connectDesktop({
        window: vscode.window,
        discover: (endpoint) => new WindowsDesktopDiscoveryProvider().discoverEndpoints([endpoint]),
        connect: (endpoint, token, version) =>
          configureConnection('custom', endpoint.baseUrl, undefined, {
            launchToken: token,
            runtimeVersion: version ?? '',
          }),
      }),
    authorizeExternalConnection: async () => {
      const endpoint = selectedCustomEndpoint(configuration)
      await externalConnection.authorize(endpoint)
      await reconnect()
    },
    clearExternalCredentials: async () => {
      pauseAutomaticConnection()
      const endpoint = endpointFromServerUrl(configuration.read().connection.serverUrl)
      await context.globalState.update(AUTOMATIC_DESKTOP_ORIGIN, undefined)
      await context.workspaceState.update('dsh.desktop.lastEndpoint', undefined)
      await desktopPairing.clear()
      if (endpoint !== undefined) await externalConnection.clear(endpoint)
      void vscode.window.showInformationMessage('DSH：已清除连接凭据与配对，连接地址设置仍保留。')
    },
    resetConnection: async () => {
      await resetConnection()
      void vscode.window.showInformationMessage(
        'DSH：已重置连接，清除配对、凭据和旧地址。请重新打开 VS Code 测试首次自动连接，或手动点击连接。',
      )
    },
    disposeEndpointAccess: () => externalConnection.dispose(),
  })

  const root: CompositionRoot = {
    start: commands.start,
    dispose: () => {
      transcript.dispose()
      disposeHostEventPipeline()
      return commands.dispose()
    },
  }
  return root
}

function selectedCustomEndpoint(configuration: VsCodeConfigurationSource): BackendEndpoint {
  const connection = configuration.read().connection
  const endpoint = connection.mode === 'custom' ? endpointFromServerUrl(connection.serverUrl) : undefined
  if (endpoint === undefined)
    throw new AppError({
      code: 'INVALID_CONFIGURATION',
      message: 'Select a custom DSH endpoint before configuring connection credentials.',
      retryable: false,
    })
  return endpoint
}
