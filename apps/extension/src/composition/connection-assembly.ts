import { parseDesktopLaunchUrl } from '../vscode/connect-desktop.js'
import { resetConnectionSettings } from '../config/reset-connection-settings.js'
import type { DesktopPairing } from '../backend/desktop-pairing.js'
import { canRecoverDesktop, withDesktopRecovery } from '../backend/desktop-recovery.js'
import {
  allowsAutomaticDesktop,
  AUTOMATIC_DESKTOP_ORIGIN,
  type AutomaticDesktopConnection,
} from '../backend/desktop-auto-discovery.js'
import * as vscode from 'vscode'
import { configuredCompanionArguments } from '../editor/managed-companion.js'
import { readEditorPreferences } from '../editor/editor-integration-settings.js'
import { companionNeedsUpdate } from '../editor/companion-update.js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access } from 'node:fs/promises'
import {
  AppError,
  type AppErrorCode,
  type BackendEndpoint,
  type BackendState,
  type DshBackend,
  type DshRuntimeUpdateProgress,
  isLoopbackEndpoint,
  parseServerOrigin,
} from '@dsh-vscode/domain'
import {
  BackendService,
  DshConnectionCoordinator,
  RuntimeUseCases,
  type ConnectionRequest,
} from '@dsh-vscode/application'
import { VersionedBackendFactory, VersionedBackendProbe } from '@dsh-vscode/dsh-adapter'
import { createAdapterOptions } from '../backend/adapter-options.js'
import { createVersionAdapters } from '../backend/version-adapters.js'
import { CompanionRegistryDiscoveryProvider } from '../backend/discovery/companion-provider.js'
import { ConfiguredPortDiscoveryProvider } from '../backend/discovery/configured-provider.js'
import { DefaultPortDiscoveryProvider } from '../backend/discovery/default-port-provider.js'
import { CompositeInstanceDiscovery } from '../backend/discovery/instance-discovery.js'
import { KnownInstanceDiscoveryProvider } from '../backend/discovery/known-instance-provider.js'
import { LinuxProcessDiscoveryProvider } from '../backend/discovery/linux-process-provider.js'
import { MacOsProcessDiscoveryProvider } from '../backend/discovery/macos-process-provider.js'
import { WindowsProcessDiscoveryProvider } from '../backend/discovery/windows-process-provider.js'
import { WindowsDesktopDiscoveryProvider } from '../backend/discovery/windows-desktop-provider.js'
import { DshProcessSupervisor } from '../backend/process-supervisor.js'
import type { RedactedDiagnostics } from '../backend/diagnostics.js'
import { DshRuntimeLocator, readStoredRuntimePath } from '../backend/runtime-locator.js'
import { resolveNpmExecutable } from '../backend/runtime-paths.js'
import { resolveWindowsShim } from '../backend/windows-shim.js'
import type { VsCodeConfigurationSource } from '../config/configuration-source.js'
import { normalizeServerUrl } from '../config/configuration-source.js'
import { DSH_PACKAGE } from '../constants.js'
import { RuntimeInstaller } from '../vscode/install-runtime.js'
import {
  DshRuntimeUpdater,
  type ExecuteRuntimeCommand,
  type RuntimeCommandResult,
} from '../vscode/update-runtime.js'
import { RUNTIME_INSTALL_MAX_BUFFER, RUNTIME_INSTALL_TIMEOUT_MS } from '../vscode/runtime-installation.js'
import {
  endpointFromServerUrl,
  extensionRuntimePathEntries,
  platform,
  readTextFile,
  runtimeEnvironment,
  spawnManagedChild,
  windowsShimOptions,
} from './runtime.js'
import { createExportFileSystem } from './export-file-system.js'
import { sameWorkspacePath } from './workspace-state.js'
import { EndpointNetwork } from '../backend/endpoint-network.js'
import { ExternalConnectionAccess } from '../backend/external-connection-access.js'
import { createCredentialScope } from '../backend/credential-scope.js'
import { hasLocalWorkspaceAuthority } from '../view/session-workspace-scope.js'

const execFileAsync = promisify(execFile)
const RUNTIME_PATH_STATE_KEY = 'dsh.runtime.lastKnownPath'

/** F5 explicitly requests a fresh owned runtime instead of discovering a stale companion. */
function usesDevelopmentRuntime(context: Pick<vscode.ExtensionContext, 'extensionMode'>): boolean {
  return (
    process.env.DSH_VSCODE_DEV_MANAGED_RUNTIME === '1' &&
    context.extensionMode === vscode.ExtensionMode.Development
  )
}
export interface RuntimeAssemblyDependencies {
  readonly context: vscode.ExtensionContext
  readonly configuration: VsCodeConfigurationSource
  readonly diagnostics: RedactedDiagnostics
  readonly currentWorkspaceFolder: () => vscode.WorkspaceFolder | undefined
  /** Late-bound publisher; the Webview event pipeline replaces it once built. */
  readonly onRuntimeUpdateProgress: (progress: DshRuntimeUpdateProgress) => void
}

export interface RuntimeAssembly {
  readonly runtimeLocator: DshRuntimeLocator
  readonly coordinator: DshConnectionCoordinator
  readonly backendService: BackendService
  readonly supervisor: DshProcessSupervisor
  readonly runtimeInstaller: RuntimeInstaller
  readonly runtimeUseCases: RuntimeUseCases
  readonly endpointLaunchUrls: Map<string, string>
  readonly externalConnection: ExternalConnectionAccess
}

/** Locate the runtime, discover endpoints, and own the connection machinery. */
export function createRuntimeAssembly(deps: RuntimeAssemblyDependencies): RuntimeAssembly {
  const { context, configuration, diagnostics, currentWorkspaceFolder, onRuntimeUpdateProgress } = deps
  const runtimeLocator = new DshRuntimeLocator({
    os: platform(),
    configuredPath: () => configuration.read().runtime.executablePath,
    pathEntries: () => extensionRuntimePathEntries(platform(), process.env),
    lastKnownRuntimePath: () =>
      readStoredRuntimePath(context.globalState.get<unknown>(RUNTIME_PATH_STATE_KEY)),
    rememberRuntimePath: (hint) => {
      void context.globalState.update(RUNTIME_PATH_STATE_KEY, hint)
    },
    logProbeFailure: (failure) =>
      diagnostics.log('warn', 'runtime-probe-failed', {
        name: failure.name,
        status: 'unusable',
        message: failure.message,
      }),
    npmGlobalPrefix: async (signal) => {
      const os = platform()
      const npm = resolveNpmExecutable(os, extensionRuntimePathEntries(os, process.env))
      const resolved =
        os === 'windows'
          ? resolveWindowsShim(npm, os, readTextFile, windowsShimOptions(os, process.env))
          : undefined
      try {
        const result = await execFileAsync(
          resolved?.executable ?? npm,
          [...(resolved?.prefixArgs ?? []), 'prefix', '-g'],
          {
            timeout: 3_000,
            maxBuffer: 8 * 1024,
            signal,
            env: runtimeEnvironment(undefined, resolved?.executable ?? npm),
          },
        )
        return result.stdout.trim() || undefined
      } catch {
        return undefined
      }
    },
    fileExists: async (candidate) =>
      access(candidate).then(
        () => true,
        () => false,
      ),
    executeVersion: async (executable, signal) => {
      const resolved = resolveWindowsShim(
        executable,
        platform(),
        readTextFile,
        windowsShimOptions(platform(), process.env),
      ) ?? {
        executable,
        prefixArgs: [],
      }
      const result = await execFileAsync(resolved.executable, [...resolved.prefixArgs, '--version'], {
        timeout: 3_000,
        maxBuffer: 8 * 1024,
        signal,
        env: runtimeEnvironment(undefined, resolved.executable),
      })
      return result.stdout.trim()
    },
  })
  const discovery = new CompositeInstanceDiscovery([
    new ConfiguredPortDiscoveryProvider(
      () => {
        const connection = configuration.read().connection
        return connection.attachPortsConfigured === true ? connection.attachPorts : []
      },
      () => configuration.read().connection.serverUrl,
    ),
    new KnownInstanceDiscoveryProvider(context.workspaceState),
    new DefaultPortDiscoveryProvider(),
    new CompanionRegistryDiscoveryProvider(),
    new WindowsProcessDiscoveryProvider(),
    new WindowsDesktopDiscoveryProvider(),
    new LinuxProcessDiscoveryProvider(),
    new MacOsProcessDiscoveryProvider(),
  ])
  const endpointCookies = new Map<string, string>()
  const network = new EndpointNetwork()
  const externalConnection = new ExternalConnectionAccess({
    secrets: context.secrets,
    credentialScope: createCredentialScope(context.globalStorageUri.fsPath),
    network,
    isTrusted: () => vscode.workspace.isTrusted,
    requestTimeoutMs: () => configuration.read().connection.requestTimeoutMs,
    confirm: async (endpoint, insecure) => {
      const action = insecure ? 'Connect using unencrypted HTTP' : 'Authorize connection'
      const message = insecure
        ? `Connect to ${endpoint.baseUrl}? HTTP sends credentials and messages without encryption. Use HTTPS on untrusted networks.`
        : `Authorize DSH at ${endpoint.baseUrl}? This instance will receive the tasks and files you choose to send.`
      return (await vscode.window.showWarningMessage(message, { modal: true }, action)) === action
    },
    inputToken: () =>
      Promise.resolve(
        vscode.window.showInputBox({
          title: 'DSH external connection credentials',
          prompt:
            'Enter the DSH launch token. Leave empty for an instance that does not require token login.',
          password: true,
          ignoreFocusOut: true,
        }),
      ),
  })
  // Keep the process launch URL in the Extension Host so the browser can
  // perform its own cookie exchange. The URL is never included in Webview
  // state or messages.
  const endpointLaunchUrls = new Map<string, string>()
  // One shared object for every adapter: spreading it would evaluate the
  // getters here, and building the composition root must never read settings.
  const adapterOptions = createAdapterOptions({
    requestTimeoutMs: () => configuration.read().connection.requestTimeoutMs,
    fetch: network.fetch,
    webSocket: network.webSocketConstructor(),
    samePath: sameWorkspacePath,
    exportFileSystem: createExportFileSystem(vscode),
    authCookie: (endpoint) =>
      externalConnection.cookie(endpoint) ??
      (endpointLaunchUrls.has(endpoint.baseUrl) ? endpointCookies.get(endpoint.baseUrl) : undefined),
    allowLocalInspector: (endpoint) => {
      const state = coordinator.getState()
      return (
        state.kind === 'connected' &&
        state.backend.endpoint.baseUrl === endpoint.baseUrl &&
        hasLocalWorkspaceAuthority(state.backend)
      )
    },
    // The assistant preview is an opt-in transient channel; the Host records
    // when it had to re-open the follow stream and when it stopped trying, so a
    // degraded "whole reply at settlement" render is diagnosable.
    onAssistantPreview: (state) =>
      diagnostics.log(state.status === 'disabled' ? 'warn' : 'info', 'assistant-preview', {
        status: state.status,
        phase: state.phase,
      }),
  })
  const rememberReadyEndpoint = createManagedEndpointLoginHandler(
    endpointCookies,
    endpointLaunchUrls,
    network.fetch,
  )
  const adapters = createVersionAdapters(adapterOptions)
  const probe = new VersionedBackendProbe(adapters, { fetch: network.fetch })
  const factory = new VersionedBackendFactory(adapters)
  const supervisor = new DshProcessSupervisor({
    additionalArguments: (runtime, signal) =>
      configuredCompanionArguments(
        runtime,
        vscode.Uri.joinPath(context.extensionUri, 'resources').fsPath,
        context.globalStorageUri.fsPath,
        signal,
        readEditorPreferences(),
        vscode.workspace.isTrusted,
      ),
    managedPort: () => (usesDevelopmentRuntime(context) ? 0 : configuration.read().connection.managedPort),
    workingDirectory: () => currentWorkspaceFolder()?.uri.fsPath ?? process.cwd(),
    toolMode: () => configuration.read().defaultAgent.toolMode,
    spawn: spawnManagedChild,
    onReadyEndpoint: rememberReadyEndpoint,
  })
  const coordinator = new DshConnectionCoordinator({
    runtimeLocator,
    discovery,
    probe,
    backendFactory: factory,
    processSupervisor: supervisor,
    endpointPreparation: externalConnection,
    onProgress: (progress) => diagnostics.connectionProgress(progress),
  })
  const backendService = new BackendService()
  let runtimeInstall: { readonly key: string; readonly operation: Promise<RuntimeCommandResult> } | undefined
  const executeRuntimeCommand: ExecuteRuntimeCommand = (executable, args, options) => {
    const installing = args[0] === 'install'
    const key = [executable, ...args].join('\0')
    if (installing && runtimeInstall !== undefined) {
      if (runtimeInstall.key === key) return runtimeInstall.operation
      return Promise.reject(
        new AppError({
          code: 'BACKEND_BUSY',
          message: 'A DSH installation is already running. Wait for it to finish before changing versions.',
          retryable: true,
          context: { operation: 'runtime.install', reason: 'install-in-progress' },
        }),
      )
    }
    if (options.signal?.aborted === true)
      return Promise.reject(
        new AppError({
          code: 'REQUEST_CANCELLED',
          message: 'The DSH installation was cancelled.',
          retryable: true,
        }),
      )
    const run = async (): Promise<RuntimeCommandResult> => {
      const resolved =
        platform() === 'windows'
          ? resolveWindowsShim(
              executable,
              'windows',
              readTextFile,
              windowsShimOptions('windows', { ...process.env, ...(options.env ?? {}) }),
            )
          : undefined
      const resolvedExecutable = resolved?.executable ?? executable
      const result = await execFileAsync(resolvedExecutable, [...(resolved?.prefixArgs ?? []), ...args], {
        timeout: options.timeout,
        maxBuffer: options.maxBuffer,
        encoding: 'utf8',
        env: runtimeEnvironment(options.env, resolvedExecutable),
        // Closing a chat must not interrupt npm while it is replacing shared files.
        ...(!installing && options.signal !== undefined ? { signal: options.signal } : {}),
      })
      return { stdout: result.stdout, stderr: result.stderr }
    }
    const operation = run()
    if (installing) {
      runtimeInstall = { key, operation }
      const release = (): void => {
        if (runtimeInstall?.operation === operation) runtimeInstall = undefined
      }
      void operation.then(release, release)
    }
    return operation
  }
  const runtimeInstaller = new RuntimeInstaller({
    tasks: vscode.tasks,
    window: vscode.window,
    env: vscode.env,
    Uri: vscode.Uri,
    workspace: vscode.workspace,
    runInstall: async () => {
      const os = platform()
      const npm = resolveNpmExecutable(os, extensionRuntimePathEntries(os, process.env))
      await executeRuntimeCommand(npm, ['install', '--global', DSH_PACKAGE], {
        timeout: RUNTIME_INSTALL_TIMEOUT_MS,
        maxBuffer: RUNTIME_INSTALL_MAX_BUFFER,
      })
    },
    verifyInstall: async () => {
      runtimeLocator.invalidate()
      return (await runtimeLocator.locate()).runtime?.supported === true
    },
    verifyExecutable: async (executable) => (await runtimeLocator.inspectExecutable(executable)).supported,
  })
  const runtimeUpdater = new DshRuntimeUpdater({
    npmExecutable: () => {
      const os = platform()
      return resolveNpmExecutable(os, extensionRuntimePathEntries(os, process.env))
    },
    locateRuntime: async (signal) => (await runtimeLocator.locate(signal)).runtime,
    onProgress: (progress) => onRuntimeUpdateProgress(progress),
    execute: executeRuntimeCommand,
    environment: () => runtimeEnvironment(),
  })
  const runtimeUseCases = new RuntimeUseCases({
    install: () => runtimeInstaller.install(),
    selectExecutable: () => runtimeInstaller.selectExecutable(),
    copyInstallCommand: () => Promise.resolve(runtimeInstaller.copyInstallCommand()),
    openDocumentation: () => Promise.resolve(runtimeInstaller.openDocumentation()).then(() => undefined),
    checkForUpdates: (force, signal) => runtimeUpdater.checkForUpdates(force, signal),
    installVersion: (version, signal) => runtimeUpdater.installVersion(version, signal),
  })
  return {
    runtimeLocator,
    coordinator,
    backendService,
    supervisor,
    runtimeInstaller,
    runtimeUseCases,
    endpointLaunchUrls,
    externalConnection,
  }
}

export interface ConnectionLifecycleDependencies {
  readonly discoverAutomaticDesktop?: (
    signal?: AbortSignal,
    expectedKey?: string,
  ) => Promise<AutomaticDesktopConnection | undefined>
  readonly onDesktopRecoveryState?: (active: boolean) => void
  readonly onDesktopRecoveryFailure?: (code: AppErrorCode) => void
  readonly desktopPairing?: DesktopPairing
  readonly context: vscode.ExtensionContext
  readonly configuration: VsCodeConfigurationSource
  readonly coordinator: DshConnectionCoordinator
  readonly currentWorkspaceFolders: () => readonly vscode.WorkspaceFolder[]
  readonly endpointLaunchUrls: Map<string, string>
  readonly externalConnection?: ExternalConnectionAccess
  readonly discoverDesktopVersion?: (
    endpoint: BackendEndpoint,
    signal?: AbortSignal,
  ) => Promise<string | undefined>
  readonly attach: (backend: DshBackend) => Promise<void>
  readonly publishState: (state: BackendState) => void
  readonly disposeAccountLifecycleHost: () => Promise<void>
  readonly detachSessionAdapters: () => void
}

export interface ConnectionLifecycle {
  readonly resetConnection: () => Promise<void>
  readonly pauseAutomaticConnection: () => void
  readonly isAutomaticConnectionPaused: () => boolean
  readonly connect: (signal?: AbortSignal) => Promise<unknown>
  readonly reconnect: (signal?: AbortSignal) => Promise<unknown>
  /**
   * The transport-change listener's entry point. Distinct from `reconnect` so
   * `configureConnection` can suppress the per-write reconnects its own
   * settings updates trigger, and run exactly one reconnect that reads the
   * fully committed configuration.
   */
  readonly reconnectOnTransportChange: (signal?: AbortSignal) => Promise<unknown>
  readonly configureConnection: (
    mode: 'auto' | 'custom' | 'desktop' | 'local',
    endpoint: string | undefined,
    signal?: AbortSignal,
    desktop?: { readonly launchToken: string; readonly runtimeVersion: string },
  ) => Promise<unknown>
}

/** The connect/reconnect/configure entry points shared by routes and commands. */
export function createConnectionLifecycle(deps: ConnectionLifecycleDependencies): ConnectionLifecycle {
  const {
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
  } = deps
  let resetRevision = 0
  let resettingConnection = false
  let automaticConnectionPaused = false
  const connectOnce = async (signal?: AbortSignal, automaticChecked = false): Promise<unknown> => {
    if (resettingConnection) throw new DOMException('Connection reset in progress.', 'AbortError')
    const connectionRevision = resetRevision
    automaticConnectionPaused = false
    const current = configuration.read()
    const development = usesDevelopmentRuntime(context)
    const automaticOrigin =
      deps.discoverAutomaticDesktop === undefined
        ? undefined
        : context.globalState.get<string>(AUTOMATIC_DESKTOP_ORIGIN)
    const canBootstrap =
      !development &&
      !automaticChecked &&
      !configuringTransport &&
      vscode.workspace.isTrusted &&
      deps.discoverAutomaticDesktop !== undefined &&
      allowsAutomaticDesktop(current.connection, automaticOrigin)
    if (
      canBootstrap &&
      !(current.connection.serverUrl && (await deps.desktopPairing?.has(current.connection.serverUrl)))
    ) {
      if (await enrollAutomaticDesktop(signal)) return connectOnce(signal, true)
    }
    const mode = development ? 'new-isolated' : current.connection.mode
    const hasWorkspaceFolder = currentWorkspaceFolders().length > 0
    const useConfiguredEndpoint =
      mode === 'custom' ||
      ((mode === 'auto' || mode === 'attach-only') &&
        current.connection.serverUrl !== undefined &&
        current.connection.serverUrl.trim() !== '')
    let customEndpoint = useConfiguredEndpoint
      ? endpointFromServerUrl(current.connection.serverUrl)
      : undefined
    let pairedVersion: string | undefined
    const desktopOrigin =
      deps.desktopPairing === undefined
        ? undefined
        : context.workspaceState.get<string>('dsh.desktop.lastEndpoint')
    if (
      customEndpoint !== undefined &&
      (desktopOrigin === customEndpoint.baseUrl || automaticOrigin === customEndpoint.baseUrl) &&
      deps.desktopPairing !== undefined
    ) {
      let launchUrl: string | undefined
      try {
        launchUrl = await deps.desktopPairing.resolve(customEndpoint.baseUrl, signal)
      } catch (error) {
        signal?.throwIfAborted()
        throw new AppError({
          code: 'BACKEND_UNREACHABLE',
          message: 'The paired Desktop is temporarily unavailable.',
          retryable: true,
          cause: error,
        })
      }
      signal?.throwIfAborted()
      if (launchUrl !== undefined) {
        const launch = parseDesktopLaunchUrl(launchUrl)
        await externalConnection?.authorizePairedDesktop(launch.endpoint, launch.token, signal)
        pairedVersion = await deps.discoverDesktopVersion?.(launch.endpoint, signal)
        if (pairedVersion === undefined && launch.endpoint.baseUrl === current.connection.serverUrl)
          pairedVersion = current.connection.runtimeVersion
        signal?.throwIfAborted()
        customEndpoint = launch.endpoint
        if (
          launch.endpoint.baseUrl !== current.connection.serverUrl ||
          pairedVersion !== current.connection.runtimeVersion
        ) {
          await persistPairedDesktop(current.connection.serverUrl!, launch.endpoint, pairedVersion, signal)
        }
      }
    }
    const allowedEndpoints =
      !useConfiguredEndpoint && mode !== 'new-isolated' && current.connection.attachPortsConfigured === true
        ? current.connection.attachPorts.map((port) => ({
            host: '127.0.0.1' as const,
            port,
            baseUrl: `http://127.0.0.1:${port}`,
          }))
        : undefined
    const selectedRuntimeVersion =
      customEndpoint?.baseUrl !== current.connection.serverUrl
        ? pairedVersion
        : (pairedVersion ?? current.connection.runtimeVersion)
    const request: ConnectionRequest = {
      mode: useConfiguredEndpoint ? 'custom' : mode,
      ...(useConfiguredEndpoint ? { credentialRevision: externalConnection?.revision ?? 0 } : {}),
      ...(customEndpoint === undefined ? {} : { endpoint: customEndpoint }),
      ...(allowedEndpoints === undefined ? {} : { allowedEndpoints }),
      ...(selectedRuntimeVersion === undefined || selectedRuntimeVersion === ''
        ? {}
        : { runtimeVersion: selectedRuntimeVersion }),
      // A workspace that has not been trusted may attach to an existing
      // host. An empty window is safe to isolate in a temporary workspace,
      // but an untrusted project folder must never auto-start DSH.
      autoStart:
        (development || current.runtime.autoStart) && (vscode.workspace.isTrusted || !hasWorkspaceFolder),
    }
    if (connectionRevision !== resetRevision) throw new DOMException('Connection was reset.', 'AbortError')
    let result = await coordinator.connect(request, signal)
    if (connectionRevision !== resetRevision) throw new DOMException('Connection was reset.', 'AbortError')
    if (
      !development &&
      mode === 'auto' &&
      !useConfiguredEndpoint &&
      request.autoStart &&
      vscode.workspace.isTrusted &&
      context.extensionUri !== undefined &&
      readEditorPreferences().enabled &&
      readEditorPreferences().autoSetup &&
      (await companionNeedsUpdate(
        result.backend,
        vscode.Uri.joinPath(context.extensionUri, 'resources').fsPath,
        signal,
      ))
    ) {
      // Discovery finished first. A stale external companion is left running;
      // switch this window to a fresh owned process that loads the shipped build.
      try {
        result = await coordinator.connect(
          {
            mode: 'new-isolated',
            autoStart: true,
            ...(request.runtimeVersion === undefined ? {} : { runtimeVersion: request.runtimeVersion }),
          },
          signal,
        )
      } catch {
        signal?.throwIfAborted()
        // If a new runtime cannot start, keep ordinary chat on the original target.
        result = await coordinator.connect(request, signal)
      }
    }
    signal?.throwIfAborted()
    if (connectionRevision !== resetRevision) throw new DOMException('Connection was reset.', 'AbortError')
    await attach(result.backend)
    signal?.throwIfAborted()
    if (connectionRevision !== resetRevision) throw new DOMException('Connection was reset.', 'AbortError')
    if (
      desktopOrigin !== undefined &&
      desktopOrigin === current.connection.serverUrl &&
      deps.desktopPairing &&
      externalConnection &&
      !(await deps.desktopPairing.has(desktopOrigin))
    ) {
      // Optional enrollment after native owner login; older connectors remain usable.
      try {
        const value = await externalConnection.requestDesktopPairing(
          result.backend.connection.endpoint,
          signal ?? new AbortController().signal,
        )
        signal?.throwIfAborted()
        if (connectionRevision !== resetRevision)
          throw new DOMException('Connection was reset.', 'AbortError')
        await deps.desktopPairing.save(desktopOrigin, value)
      } catch {
        signal?.throwIfAborted()
      }
    }
    // A remote port must never become a remembered local discovery candidate.
    if (connectionRevision !== resetRevision) throw new DOMException('Connection was reset.', 'AbortError')
    // Persistence is optional and must not hold a healthy UI on the loading page.
    void context.workspaceState
      .update(
        'dsh.lastEndpoint',
        isLoopbackEndpoint(result.backend.connection.endpoint)
          ? {
              host: result.backend.connection.endpoint.host,
              port: result.backend.connection.endpoint.port,
              ...(result.backend.connection.pid === undefined ? {} : { pid: result.backend.connection.pid }),
            }
          : undefined,
      )
      .then(undefined, () => undefined)
    // Commands may connect before the Webview exists. app.ready must always
    // receive a fresh authoritative snapshot even when the initial publish
    // had no recipient.
    publishState(result.state)
    return { connected: true }
  }
  let connectionOperation: Promise<unknown> | undefined
  let connectionAbort: AbortController | undefined
  let connectionSelection = -1
  const connect = (signal?: AbortSignal): Promise<unknown> => {
    if (
      connectionOperation !== undefined &&
      connectionSelection === configurationRevision &&
      !connectionAbort?.signal.aborted
    )
      return connectionOperation
    connectionAbort?.abort(new DOMException('Connection selection changed.', 'AbortError'))
    const abort = new AbortController()
    connectionAbort = abort
    connectionSelection = configurationRevision
    const operationSignal = signal ? AbortSignal.any([abort.signal, signal]) : abort.signal
    const eligible =
      deps.discoverAutomaticDesktop !== undefined &&
      !configuringTransport &&
      !usesDevelopmentRuntime(context) &&
      vscode.workspace.isTrusted &&
      canRecoverDesktop(configuration.read().connection)
    const operation = (async (): Promise<unknown> => {
      if (!eligible) return connectOnce(signal)
      const recoverySignal = AbortSignal.any([AbortSignal.timeout(25_000), operationSignal])
      try {
        return await withDesktopRecovery({
          signal: recoverySignal,
          active: (active) => deps.onDesktopRecoveryState?.(active),
          connect: () => {
            if (!vscode.workspace.isTrusted) throw new DOMException('Workspace trust changed.', 'AbortError')
            return connectOnce(recoverySignal)
          },
          refresh: async () => {
            // Never enqueue behind configureConnection while it is awaiting us.
            if (!configuringTransport) await enrollAutomaticDesktop(recoverySignal, true)
          },
        })
      } catch (error) {
        operationSignal.throwIfAborted()
        if (
          (error instanceof Error && error.name === 'AbortError') ||
          (error instanceof AppError && error.code === 'REQUEST_CANCELLED')
        )
          throw error
        const failure =
          error instanceof AppError
            ? error
            : new AppError({
                code: 'BACKEND_UNREACHABLE',
                message:
                  'Desktop could not be recovered automatically. Update the connection address or choose a connection source.',
                retryable: true,
              })
        deps.onDesktopRecoveryFailure?.(failure.code)
        if (!coordinator.reportPreparationFailure?.(failure))
          publishState({ kind: 'failed', message: failure.message, retryable: failure.retryable })
        throw failure
      }
    })()
    connectionOperation = operation
    void operation
      .finally(() => {
        if (connectionOperation === operation) connectionOperation = undefined
        if (connectionAbort === abort) connectionAbort = undefined
      })
      .catch(() => undefined)
    return operation
  }
  let reconnectOperation: Promise<unknown> | undefined
  let reconnectAbort: AbortController | undefined
  const reconnect = async (signal?: AbortSignal, replace = false): Promise<unknown> => {
    if (reconnectOperation !== undefined && !replace) return reconnectOperation
    connectionAbort?.abort(new DOMException('Reconnecting DSH.', 'AbortError'))
    reconnectAbort?.abort(new DOMException('Connection settings changed.', 'AbortError'))
    const abort = new AbortController()
    reconnectAbort = abort
    const operationSignal = signal === undefined ? abort.signal : AbortSignal.any([signal, abort.signal])
    const operation = (async (): Promise<unknown> => {
      operationSignal.throwIfAborted()
      await disposeAccountLifecycleHost()
      operationSignal.throwIfAborted()
      detachSessionAdapters()
      endpointLaunchUrls.clear()
      await coordinator.disconnect()
      operationSignal.throwIfAborted()
      await externalConnection?.release()
      operationSignal.throwIfAborted()
      return connect(operationSignal)
    })()
    reconnectOperation = operation
    try {
      return await operation
    } finally {
      if (reconnectOperation === operation) reconnectOperation = undefined
      if (reconnectAbort === abort) reconnectAbort = undefined
    }
  }
  // A transport-settings change the configuration listener observed. While
  // `configureConnection` is mid-write this is a no-op: every write the
  // configure path commits fires this listener, and acting on each one would
  // reconnect on partially updated configuration (a mode switch could attach
  // under the old mode) while the coalescer then swallowed the correcting
  // explicit reconnect.
  let configuringTransport = false
  let configurationQueue: Promise<void> = Promise.resolve()
  let configurationRevision = 0
  let automaticEnrollment: Promise<boolean> | undefined
  const writeTransportSettings = async (
    settings: vscode.WorkspaceConfiguration,
    writes: readonly (readonly [string, unknown])[],
    assertCurrent: () => void = () => undefined,
  ): Promise<void> => {
    for (const [key, value] of writes) {
      assertCurrent()
      await settings.update(key, value, vscode.ConfigurationTarget.Global)
      assertCurrent()
    }
  }
  const enrollAutomaticDesktop = (signal?: AbortSignal, recovering = false): Promise<boolean> => {
    if (automaticEnrollment) return automaticEnrollment
    const revision = configurationRevision
    const operation = configurationQueue.then(async () => {
      const selected = configuration.read()
      const previous = { connection: { ...selected.connection }, runtime: { ...selected.runtime } }
      const previousAutomatic = context.globalState.get<string>(AUTOMATIC_DESKTOP_ORIGIN)
      const previousMarker = context.workspaceState.get<string>('dsh.desktop.lastEndpoint')
      const recoveryAllowed = recovering && canRecoverDesktop(previous.connection)
      if (
        (!allowsAutomaticDesktop(previous.connection, previousAutomatic) && !recoveryAllowed) ||
        !deps.desktopPairing ||
        !externalConnection
      )
        return false
      const assertCurrent = (): void => {
        signal?.throwIfAborted()
        if (revision !== configurationRevision || !vscode.workspace.isTrusted)
          throw new DOMException('Connection selection changed.', 'AbortError')
      }
      assertCurrent()
      const previousKey =
        previous.connection.serverUrl === undefined
          ? undefined
          : await deps.desktopPairing.keyFor?.(previous.connection.serverUrl)
      assertCurrent()
      const found = await deps.discoverAutomaticDesktop?.(signal, previousKey)
      assertCurrent()
      if (!found) return false
      configuringTransport = true
      try {
        const launch = parseDesktopLaunchUrl(found.url)
        if (launch.endpoint.baseUrl !== found.endpoint.baseUrl) return false
        await externalConnection.authorizePairedDesktop(found.endpoint, launch.token, signal)
        assertCurrent()
        await deps.desktopPairing.save(found.endpoint.baseUrl, { version: 1, key: found.key })
        assertCurrent()
        await context.workspaceState.update('dsh.desktop.lastEndpoint', found.endpoint.baseUrl)
        await context.globalState.update(AUTOMATIC_DESKTOP_ORIGIN, found.endpoint.baseUrl)
        assertCurrent()
        await writeTransportSettings(
          vscode.workspace.getConfiguration('dsh'),
          [
            ['connection.serverUrl', found.endpoint.baseUrl],
            ['connection.runtimeVersion', found.runtimeVersion],
            ['runtime.autoStart', false],
            ['connection.mode', 'custom'],
          ],
          assertCurrent,
        )
        assertCurrent()
        return true
      } catch (error) {
        if (revision === configurationRevision) {
          await writeTransportSettings(vscode.workspace.getConfiguration('dsh'), [
            ['connection.serverUrl', previous.connection.serverUrl ?? ''],
            ['connection.runtimeVersion', previous.connection.runtimeVersion ?? ''],
            ['runtime.autoStart', previous.runtime.autoStart],
            ['connection.mode', previous.connection.mode],
          ]).catch(() => undefined)
          await context.globalState.update(AUTOMATIC_DESKTOP_ORIGIN, previousAutomatic)
          await context.workspaceState.update('dsh.desktop.lastEndpoint', previousMarker)
          if (previousKey !== undefined && previous.connection.serverUrl !== undefined)
            await deps.desktopPairing.save(previous.connection.serverUrl, { version: 1, key: previousKey })
          else await deps.desktopPairing.clear()
        }
        throw error
      } finally {
        configuringTransport = false
      }
    })
    configurationQueue = operation.then(
      () => undefined,
      () => undefined,
    )
    automaticEnrollment = operation
    void operation.then(
      () => {
        if (automaticEnrollment === operation) automaticEnrollment = undefined
      },
      () => {
        if (automaticEnrollment === operation) automaticEnrollment = undefined
      },
    )
    return operation
  }
  const persistPairedDesktopNow = async (
    origin: string,
    endpoint: BackendEndpoint,
    version: string | undefined,
    signal?: AbortSignal,
  ): Promise<void> => {
    const revision = configurationRevision
    const previous = { ...configuration.read().connection }
    const previousMarker = context.workspaceState.get<string>('dsh.desktop.lastEndpoint')
    const previousAutomatic =
      deps.discoverAutomaticDesktop === undefined
        ? undefined
        : context.globalState.get<string>(AUTOMATIC_DESKTOP_ORIGIN)
    const key = await deps.desktopPairing?.keyFor?.(origin)
    const assertCurrent = (): void => {
      signal?.throwIfAborted()
      if (revision !== configurationRevision || !vscode.workspace.isTrusted)
        throw new DOMException('Connection selection changed.', 'AbortError')
    }
    assertCurrent()
    if (deps.desktopPairing?.keyFor !== undefined && key === undefined)
      throw new DOMException('Desktop pairing was cleared.', 'AbortError')
    const wasConfiguring = configuringTransport
    configuringTransport = true
    try {
      await writeTransportSettings(
        vscode.workspace.getConfiguration('dsh'),
        [
          ['connection.serverUrl', endpoint.baseUrl],
          ['connection.runtimeVersion', version ?? ''],
        ],
        assertCurrent,
      )
      if (key !== undefined) await deps.desktopPairing?.save(endpoint.baseUrl, { version: 1, key })
      assertCurrent()
      await context.workspaceState.update('dsh.desktop.lastEndpoint', endpoint.baseUrl)
      assertCurrent()
      if (deps.discoverAutomaticDesktop !== undefined)
        await context.globalState.update(AUTOMATIC_DESKTOP_ORIGIN, endpoint.baseUrl)
      assertCurrent()
    } catch (error) {
      if (revision === configurationRevision) {
        await writeTransportSettings(vscode.workspace.getConfiguration('dsh'), [
          ['connection.serverUrl', previous.serverUrl ?? ''],
          ['connection.runtimeVersion', previous.runtimeVersion ?? ''],
        ]).catch(() => undefined)
        if (key !== undefined) await deps.desktopPairing?.save(origin, { version: 1, key })
        await context.workspaceState.update('dsh.desktop.lastEndpoint', previousMarker)
        if (deps.discoverAutomaticDesktop !== undefined)
          await context.globalState.update(AUTOMATIC_DESKTOP_ORIGIN, previousAutomatic)
      }
      throw error
    } finally {
      configuringTransport = wasConfiguring
    }
  }
  const persistPairedDesktop = (
    origin: string,
    endpoint: BackendEndpoint,
    version: string | undefined,
    signal?: AbortSignal,
  ): Promise<void> => {
    const revision = configurationRevision
    const run = (): Promise<void> => {
      signal?.throwIfAborted()
      if (revision !== configurationRevision)
        throw new DOMException('Connection selection changed.', 'AbortError')
      return persistPairedDesktopNow(origin, endpoint, version, signal)
    }
    // An explicit configure operation already owns this queue and awaits connect.
    if (configuringTransport) return run()
    const operation = configurationQueue.then(run)
    configurationQueue = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }
  const reconnectOnTransportChange = (signal?: AbortSignal): Promise<unknown> => {
    if (configuringTransport || automaticConnectionPaused) return Promise.resolve(undefined)
    configurationRevision++
    return reconnect(signal, true)
  }
  const configureConnection = async (
    mode: 'auto' | 'custom' | 'desktop' | 'local',
    endpoint: string | undefined,
    signal?: AbortSignal,
    desktop?: { readonly launchToken: string; readonly runtimeVersion: string },
  ): Promise<unknown> => {
    signal?.throwIfAborted()
    const revision = ++configurationRevision
    reconnectAbort?.abort(new DOMException('Connection settings changed.', 'AbortError'))
    // The explicitly submitted Desktop URL is never written to configuration or
    // returned to the Webview. Only its origin is persisted; credentials stay
    // in Host SecretStorage via ExternalConnectionAccess.
    let reuseDesktopCredentials = false
    if (mode === 'desktop') {
      const saved = configuration.read().connection
      const remembered = context.workspaceState.get<unknown>('dsh.desktop.lastEndpoint')
      const savedEndpoint =
        saved.mode === 'custom' ? saved.serverUrl : typeof remembered === 'string' ? remembered : undefined
      reuseDesktopCredentials = !endpoint?.trim() && savedEndpoint !== undefined
      const launch = parseDesktopLaunchUrl(reuseDesktopCredentials ? (savedEndpoint ?? '') : (endpoint ?? ''))
      endpoint = launch.endpoint.baseUrl
      const verifiedVersion = await deps.discoverDesktopVersion?.(launch.endpoint, signal).catch(() => {
        signal?.throwIfAborted()
        return undefined
      })
      signal?.throwIfAborted()
      if (revision !== configurationRevision)
        throw new DOMException('Connection settings changed.', 'AbortError')
      const savedVersion = saved.serverUrl === launch.endpoint.baseUrl ? saved.runtimeVersion : undefined
      const runtimeVersion = verifiedVersion ?? savedVersion ?? ''
      if (!reuseDesktopCredentials) desktop = { launchToken: launch.token, runtimeVersion }
      else if (runtimeVersion !== '') {
        // Reusing credentials must still retain or refresh this origin's exact wire identity.
        desktop = { launchToken: '', runtimeVersion }
      }
      mode = 'custom'
    }
    if (mode === 'local' && currentWorkspaceFolders().length > 0 && !vscode.workspace.isTrusted) {
      throw new AppError({
        code: 'PERMISSION_DENIED',
        message: 'Trust this workspace before starting local DSH.',
        retryable: false,
      })
    }
    let writes: readonly (readonly [string, unknown])[]
    if (mode === 'local') {
      // Explicit package selection starts an owned process from the located
      // executable, rather than rediscovering and attaching to Desktop.
      writes = [
        ['connection.mode', 'new-isolated'],
        ['connection.serverUrl', ''],
        ['connection.runtimeVersion', ''],
        ['runtime.autoStart', true],
      ]
    } else if (mode === 'custom') {
      const normalized = normalizeServerUrl(endpoint ?? '')
      if (normalized === undefined)
        throw new AppError({
          code: 'INVALID_CONFIGURATION',
          message: 'Enter an HTTP(S) endpoint such as http://127.0.0.1:3080.',
          retryable: false,
        })
      writes = [
        // Write the endpoint before switching modes so the configuration is
        // never observed in a transient custom-without-endpoint state.
        ['connection.serverUrl', normalized],
        ...(desktop === undefined
          ? []
          : [
              ['connection.runtimeVersion', desktop.runtimeVersion] as const,
              ['runtime.autoStart', false] as const,
            ]),
        ['connection.mode', mode],
      ]
    } else {
      writes = [
        // Switch out of custom mode before clearing its endpoint for the same
        // reason. Existing attach-only/new-isolated settings remain untouched
        // until the user explicitly chooses a mode here.
        ['connection.mode', mode],
        ['connection.serverUrl', ''],
      ]
    }
    // Serialize settings writes, while a newer submission cancels an obsolete
    // network attempt instead of waiting for its timeout.
    const operation = configurationQueue.then(async () => {
      signal?.throwIfAborted()
      if (revision !== configurationRevision)
        throw new DOMException('Connection settings changed.', 'AbortError')
      configuringTransport = true
      try {
        if (deps.discoverAutomaticDesktop !== undefined)
          await context.globalState.update(AUTOMATIC_DESKTOP_ORIGIN, undefined)
        if (mode === 'custom' && externalConnection !== undefined && !reuseDesktopCredentials) {
          await deps.desktopPairing?.clear()
          const selected = endpointFromServerUrl(endpoint)
          if (selected === undefined)
            throw new AppError({
              code: 'INVALID_ENDPOINT',
              message: 'Enter a valid DSH endpoint.',
              retryable: false,
            })
          await externalConnection.authorize(selected, signal, desktop?.launchToken)
        }
        signal?.throwIfAborted()
        if (mode === 'custom' && desktop !== undefined)
          await context.workspaceState.update('dsh.desktop.lastEndpoint', endpoint)
        await writeTransportSettings(vscode.workspace.getConfiguration('dsh'), writes)
        if (revision !== configurationRevision)
          throw new DOMException('Connection settings changed.', 'AbortError')
        signal?.throwIfAborted()
        return await reconnect(signal, true)
      } finally {
        configuringTransport = false
      }
    })
    configurationQueue = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }
  let resetOperation: Promise<void> | undefined
  const resetConnection = (): Promise<void> => {
    if (resetOperation) return resetOperation
    if (!vscode.workspace.isTrusted)
      return Promise.reject(
        new AppError({
          code: 'PERMISSION_DENIED',
          message: 'Trust this workspace before resetting the connection.',
          retryable: false,
        }),
      )
    ++configurationRevision
    ++resetRevision
    resettingConnection = true
    automaticConnectionPaused = true
    connectionAbort?.abort(new DOMException('Connection was reset.', 'AbortError'))
    reconnectAbort?.abort(new DOMException('Connection was reset.', 'AbortError'))
    const operation = configurationQueue.then(async () => {
      configuringTransport = true
      try {
        await disposeAccountLifecycleHost()
        detachSessionAdapters()
        endpointLaunchUrls.clear()
        await coordinator.disconnect()
        await externalConnection?.clearAll()
        await deps.desktopPairing?.clear()
        await context.globalState.update(AUTOMATIC_DESKTOP_ORIGIN, undefined)
        await context.workspaceState.update('dsh.desktop.lastEndpoint', undefined)
        await context.workspaceState.update('dsh.lastEndpoint', undefined)
        await resetConnectionSettings(vscode.workspace)
        publishState({ kind: 'idle' })
      } finally {
        configuringTransport = false
        resettingConnection = false
      }
    })
    configurationQueue = operation.then(
      () => undefined,
      () => undefined,
    )
    resetOperation = operation
    void operation.then(
      () => {
        if (resetOperation === operation) resetOperation = undefined
      },
      () => {
        if (resetOperation === operation) resetOperation = undefined
      },
    )
    return operation
  }
  return {
    connect,
    reconnect,
    reconnectOnTransportChange,
    configureConnection,
    resetConnection,
    pauseAutomaticConnection: () => {
      automaticConnectionPaused = true
      configurationRevision++
      connectionAbort?.abort(new DOMException('Desktop credentials were cleared.', 'AbortError'))
      reconnectAbort?.abort(new DOMException('Desktop credentials were cleared.', 'AbortError'))
    },
    isAutomaticConnectionPaused: () => automaticConnectionPaused,
  }
}

export function createManagedEndpointLoginHandler(
  endpointCookies: Map<string, string>,
  endpointLaunchUrls: Map<string, string>,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): (endpoint: BackendEndpoint, launchUrl: string | undefined, signal: AbortSignal) => Promise<void> {
  return async (endpoint, launchUrl, signal) => {
    // A managed port can be reused by a fresh DSH process. Never let a cookie
    // from the previous process authorize the new endpoint.
    endpointCookies.delete(endpoint.baseUrl)
    endpointLaunchUrls.delete(endpoint.baseUrl)
    signal.throwIfAborted()
    if (launchUrl === undefined) return
    const target = new URL(launchUrl)
    if (
      !isLoopbackEndpoint(endpoint) ||
      parseServerOrigin(target.origin)?.baseUrl !== endpoint.baseUrl ||
      target.username !== '' ||
      target.password !== ''
    ) {
      throw new AppError({
        code: 'INVALID_ENDPOINT',
        message: 'The managed launch URL does not match its local endpoint.',
        retryable: false,
      })
    }
    const loginSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)])
    let response: Response
    try {
      response = await fetcher(launchUrl, { method: 'GET', redirect: 'manual', signal: loginSignal })
    } catch (error) {
      signal.throwIfAborted()
      throw new AppError({
        code: 'BACKEND_UNREACHABLE',
        message: 'The managed DSH web login could not be completed.',
        retryable: true,
        cause: error,
      })
    }
    signal.throwIfAborted()
    const headers = response.headers as Headers & { getSetCookie?: () => string[] }
    const setCookies = headers.getSetCookie?.() ?? [headers.get('set-cookie') ?? '']
    const cookie = setCookies
      .map((value) => value.split(';', 1)[0]?.trim() ?? '')
      .find((value) => /^[^=;\s]+=[^;\r\n]+$/u.test(value))
    await response.body?.cancel().catch(() => undefined)
    if (response.status < 300 || response.status >= 400 || cookie === undefined) {
      throw new AppError({
        code: 'BACKEND_UNREACHABLE',
        message: 'The managed DSH web login returned no session cookie.',
        retryable: true,
      })
    }
    signal.throwIfAborted()
    endpointCookies.set(endpoint.baseUrl, cookie)
    endpointLaunchUrls.set(endpoint.baseUrl, launchUrl)
  }
}
