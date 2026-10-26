import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as vscode from 'vscode'

vi.mock('vscode', () => ({
  workspace: {
    isTrusted: true,
    getConfiguration: () => ({
      inspect: (key: string) => ({
        globalValue:
          key === 'runtime.autoStart'
            ? harness.configuration.runtime.autoStart
            : key === 'connection.mode'
              ? harness.configuration.connection.mode
              : key === 'connection.serverUrl'
                ? harness.configuration.connection.serverUrl
                : key === 'connection.runtimeVersion'
                  ? harness.configuration.connection.runtimeVersion
                  : undefined,
      }),
      update: async (key: string, value: unknown): Promise<void> => {
        if (key === 'connection.serverUrl')
          harness.configuration.connection.serverUrl = typeof value === 'string' ? value : ''
        if (key === 'connection.mode')
          harness.configuration.connection.mode = (value ?? 'attach-only') as
            'auto' | 'custom' | 'attach-only'
        if (key === 'connection.runtimeVersion')
          harness.configuration.connection.runtimeVersion = typeof value === 'string' ? value : ''
        if (key === 'runtime.autoStart') harness.configuration.runtime.autoStart = value === true
        // VS Code fires the transport-change listener once per committed
        // write; the extension subscribes to it through
        // `reconnectOnTransportChange`.
        for (const listener of harness.transportListeners) await listener()
        await harness.afterWrite?.(key)
      },
    }),
  },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  ExtensionMode: { Production: 1, Development: 2, Test: 3 },
  Uri: { joinPath: () => ({ fsPath: '/fixture/resources' }) },
}))

const harness = vi.hoisted(() => {
  const state = {
    configuration: {
      connection: { mode: 'auto' as 'auto' | 'custom' | 'attach-only', serverUrl: '', runtimeVersion: '' },
      runtime: { autoStart: false },
    },
    connects: [] as Array<{
      readonly mode: string
      readonly endpoint?: unknown
      readonly autoStart: boolean
    }>,
    transportListeners: [] as Array<(signal?: AbortSignal) => Promise<unknown>>,
    afterWrite: undefined as ((key: string) => Promise<void>) | undefined,
    update: vi.fn().mockResolvedValue(false),
    desktopVersion: vi.fn<() => Promise<string | undefined>>().mockResolvedValue(undefined),
  }
  return state
})
vi.mock('../editor/companion-update.js', () => ({ companionNeedsUpdate: harness.update }))
vi.mock('../editor/editor-integration-settings.js', () => ({
  readEditorPreferences: () => ({ enabled: true, autoSetup: true, allowEdits: true }),
}))

import { createConnectionLifecycle } from './connection-assembly.js'

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function lifecycle(
  connect: (
    request: {
      readonly mode: string
      readonly endpoint?: unknown
      readonly autoStart: boolean
    },
    signal?: AbortSignal,
  ) => Promise<unknown> = vi.fn().mockResolvedValue({
    backend: { connection: { endpoint: { port: 3080 } } },
    state: { kind: 'connected' },
  }),
  extensionMode = vscode.ExtensionMode.Production,
  withResources = false,
): ReturnType<typeof createConnectionLifecycle> {
  const result = createConnectionLifecycle({
    context: {
      extensionMode,
      ...(withResources ? { extensionUri: { fsPath: '/fixture' } } : {}),
      workspaceState: { update: () => Promise.resolve(undefined), get: () => undefined },
    },
    configuration: { read: () => harness.configuration },
    discoverDesktopVersion: harness.desktopVersion,
    coordinator: {
      connect: (
        request: {
          readonly mode: string
          readonly endpoint?: unknown
          readonly autoStart: boolean
        },
        signal?: AbortSignal,
      ) => {
        harness.connects.push(request)
        return connect(request, signal)
      },
      disconnect: () => Promise.resolve(),
    },
    currentWorkspaceFolders: () => [],
    endpointLaunchUrls: new Map(),
    loginWithToken: () => Promise.resolve(),
    hasCookie: () => false,
    attach: () => Promise.resolve(),
    publishState: () => undefined,
    disposeAccountLifecycleHost: () => Promise.resolve(),
    detachSessionAdapters: () => undefined,
  } as never)
  harness.transportListeners.push(result.reconnectOnTransportChange)
  return result
}

describe('connection.configure reconnect', () => {
  afterEach(() => vi.unstubAllEnvs())
  beforeEach(() => {
    harness.connects.length = 0
    harness.transportListeners.length = 0
    harness.configuration.connection.mode = 'auto'
    harness.configuration.connection.serverUrl = ''
    harness.configuration.connection.runtimeVersion = ''
    harness.desktopVersion.mockReset().mockResolvedValue(undefined)
    harness.afterWrite = undefined
    harness.configuration.runtime.autoStart = false
    harness.update.mockReset().mockResolvedValue(false)
  })

  it('persists a verified Desktop version before connecting instead of selecting an old fallback', async () => {
    harness.desktopVersion.mockResolvedValue('0.2.1-rc.2')
    await lifecycle().configureConnection('desktop', 'http://127.0.0.1:43120/?token=fixture-only')
    expect(harness.configuration.connection.runtimeVersion).toBe('0.2.1-rc.2')
    expect(harness.configuration.connection.serverUrl).toBe('http://127.0.0.1:43120')
    expect(harness.connects.at(-1)).toMatchObject({ mode: 'custom', runtimeVersion: '0.2.1-rc.2' })
  })

  it('preserves an exact same-origin version if optional OS discovery is unavailable', async () => {
    harness.configuration.connection.mode = 'custom'
    harness.configuration.connection.serverUrl = 'http://127.0.0.1:43120'
    harness.configuration.connection.runtimeVersion = '0.2.1-rc.2'
    harness.desktopVersion.mockRejectedValue(new Error('Optional discovery unavailable'))
    await lifecycle().configureConnection('desktop', 'http://127.0.0.1:43120/?token=fixture-only')
    expect(harness.configuration.connection.runtimeVersion).toBe('0.2.1-rc.2')
    await lifecycle().configureConnection('desktop', 'http://127.0.0.1:43121/?token=fixture-only')
    expect(harness.configuration.connection.runtimeVersion).toBe('')
  })

  it('cannot overwrite a newer choice when Desktop identity discovery completes late', async () => {
    const pending = deferred<string | undefined>()
    harness.desktopVersion.mockReturnValue(pending.promise)
    const subject = lifecycle()
    const previous = subject.configureConnection('desktop', 'http://127.0.0.1:43120/?token=fixture-only')
    const cancelled = expect(previous).rejects.toMatchObject({ name: 'AbortError' })
    await subject.configureConnection('custom', 'http://127.0.0.1:43121')
    pending.resolve('0.2.1-rc.2')
    await cancelled
    expect(harness.configuration.connection.serverUrl).toBe('http://127.0.0.1:43121')
  })

  it('automatically switches a stale discovered companion to a fresh owned runtime, falling back to chat on failure', async () => {
    harness.configuration.runtime.autoStart = true
    harness.update.mockResolvedValue(true)
    const result = { backend: { connection: { endpoint: { port: 3080 } } }, state: { kind: 'connected' } }
    const connect = vi.fn().mockResolvedValue(result)
    await lifecycle(connect, vscode.ExtensionMode.Production, true).connect()
    expect(harness.connects.map((request) => request.mode)).toEqual(['auto', 'new-isolated'])
    expect(harness.configuration.connection.mode).toBe('auto')
    harness.connects.length = 0
    connect
      .mockReset()
      .mockResolvedValueOnce(result)
      .mockRejectedValueOnce(new Error('runtime unavailable'))
      .mockResolvedValueOnce(result)
    await lifecycle(connect, vscode.ExtensionMode.Production, true).connect()
    expect(harness.connects.map((request) => request.mode)).toEqual(['auto', 'new-isolated', 'auto'])
  })

  it('uses a fresh owned runtime for F5 without changing or attaching to the configured external server', async () => {
    vi.stubEnv('DSH_VSCODE_DEV_MANAGED_RUNTIME', '1')
    harness.configuration.connection.mode = 'custom'
    harness.configuration.connection.serverUrl = 'http://127.0.0.1:3080'
    const development = lifecycle(undefined, vscode.ExtensionMode.Development)
    await development.connect()
    expect(harness.connects.at(-1)).toMatchObject({ mode: 'new-isolated', autoStart: true })
    expect(harness.connects.at(-1)?.endpoint).toBeUndefined()
    expect(harness.configuration.connection).toEqual({
      mode: 'custom',
      serverUrl: 'http://127.0.0.1:3080',
      runtimeVersion: '',
    })
    const production = lifecycle()
    await production.connect()
    expect(harness.connects.at(-1)).toMatchObject({ mode: 'custom', endpoint: { port: 3080 } })
  })

  it('does not adopt a reconnect that already read the old settings', async () => {
    const started = deferred<void>()
    const admitted = deferred<unknown>()
    const connect = vi
      .fn()
      .mockImplementationOnce(() => {
        started.resolve()
        return admitted.promise
      })
      .mockResolvedValue({
        backend: { connection: { endpoint: { port: 3080 } } },
        state: { kind: 'connected' },
      })
    const subject = lifecycle(connect)
    const previous = subject.reconnect()
    const cancelledPrevious = expect(previous).rejects.toMatchObject({ name: 'AbortError' })
    await started.promise
    const configured = subject.configureConnection('custom', 'http://127.0.0.1:3080')
    await vi.waitFor(() => expect(harness.configuration.connection.mode).toBe('custom'))
    await configured
    admitted.resolve({ backend: { connection: { endpoint: { port: 3080 } } }, state: { kind: 'connected' } })
    await cancelledPrevious
    expect(harness.connects.map((request) => request.mode)).toEqual(['auto', 'custom'])
  })

  it('serializes overlapping settings submissions without publishing a mixed pair', async () => {
    const firstWrite = deferred<void>()
    const release = deferred<void>()
    harness.afterWrite = async (key) => {
      if (key !== 'connection.serverUrl') return
      harness.afterWrite = undefined
      firstWrite.resolve()
      await release.promise
    }
    const subject = lifecycle()
    const custom = subject.configureConnection('custom', 'http://127.0.0.1:3080')
    const superseded = expect(custom).rejects.toMatchObject({ name: 'AbortError' })
    await firstWrite.promise
    const auto = subject.configureConnection('auto', undefined)
    release.resolve()
    await Promise.all([superseded, auto])
    expect(harness.connects.map((request) => request.mode)).toEqual(['auto'])
    expect(harness.configuration.connection).toEqual({ mode: 'auto', serverUrl: '', runtimeVersion: '' })
  })

  it('reconnects once, on the fully committed configuration', async () => {
    // configureConnection writes its settings in several awaited steps, and
    // VS Code delivers a configuration-change event for every committed
    // write. Each of those events used to start (or adopt) a reconnect that
    // read the partially updated configuration: switching to a custom
    // endpoint could reconnect under the old auto mode, and the coalescer
    // then swallowed the explicit reconnect, leaving the connection on the
    // pre-update settings with nothing to correct it.
    harness.connects.length = 0
    harness.transportListeners.length = 0
    harness.configuration.connection.mode = 'auto'
    harness.configuration.connection.serverUrl = ''
    const lifecycle = createConnectionLifecycle({
      context: { workspaceState: { update: () => Promise.resolve(undefined), get: () => undefined } },
      configuration: { read: () => harness.configuration },
      coordinator: {
        connect: (request: {
          readonly mode: string
          readonly endpoint?: unknown
          readonly autoStart: boolean
        }) => {
          harness.connects.push(request)
          return Promise.resolve({
            backend: { connection: { endpoint: { port: 3080 } } },
            state: { kind: 'connected' },
          })
        },
        disconnect: () => Promise.resolve(),
      },
      currentWorkspaceFolders: () => [],
      endpointLaunchUrls: new Map<string, string>(),
      loginWithToken: () => Promise.resolve(),
      hasCookie: () => false,
      attach: () => Promise.resolve(undefined),
      publishState: () => undefined,
      disposeAccountLifecycleHost: () => Promise.resolve(undefined),
      detachSessionAdapters: () => undefined,
    } as never)
    harness.transportListeners.push((signal) => lifecycle.reconnectOnTransportChange(signal))

    await lifecycle.configureConnection('custom', 'http://127.0.0.1:3080')

    expect(harness.connects).toEqual([
      {
        mode: 'custom',
        endpoint: { host: '127.0.0.1', port: 3080, baseUrl: 'http://127.0.0.1:3080' },
        autoStart: false,
        credentialRevision: 0,
      },
    ])
  })

  it('releases the settings queue and listener suppression after a failed write', async () => {
    harness.afterWrite = () => {
      harness.afterWrite = undefined
      return Promise.reject(new Error('Settings write failed'))
    }
    const subject = lifecycle()
    await expect(subject.configureConnection('custom', 'http://127.0.0.1:3080')).rejects.toThrow(
      'Settings write failed',
    )
    await subject.configureConnection('auto', undefined)
    await subject.reconnectOnTransportChange()
    expect(harness.connects.map((request) => request.mode)).toEqual(['auto', 'auto'])
  })

  it('does not write settings for an already-cancelled submission', async () => {
    const signal = AbortSignal.abort(new Error('Cancelled'))
    const subject = lifecycle()
    await expect(subject.configureConnection('custom', 'http://127.0.0.1:3080', signal)).rejects.toThrow(
      'Cancelled',
    )
    expect(harness.configuration.connection).toEqual({ mode: 'auto', serverUrl: '', runtimeVersion: '' })
    expect(harness.connects).toEqual([])
  })

  it('releases a failed connection so changed settings and auto can connect again', async () => {
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new Error('Configured endpoint unavailable'))
      .mockResolvedValue({
        backend: { connection: { endpoint: { port: 4311 } } },
        state: { kind: 'connected' },
      })
    const subject = lifecycle(connect)
    await expect(subject.configureConnection('custom', 'http://127.0.0.1:4310')).rejects.toThrow(
      'Configured endpoint unavailable',
    )
    await subject.configureConnection('custom', 'http://127.0.0.1:4311')
    expect(harness.connects[1]).toMatchObject({ mode: 'custom', endpoint: { port: 4311 } })
    await subject.configureConnection('auto', undefined)
    expect(harness.connects[2]?.mode).toBe('auto')
  })

  it('cancels a pending settings connection so the next submission does not wait for its timeout', async () => {
    let started = 0
    const subject = lifecycle((_request, signal) => {
      started++
      if (started === 1)
        return new Promise((_resolve, reject) =>
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Connection settings changed.', 'AbortError')),
            { once: true },
          ),
        )
      return Promise.resolve({
        backend: { connection: { endpoint: { port: 4311 } } },
        state: { kind: 'connected' },
      })
    })
    const first = subject.configureConnection('custom', 'http://127.0.0.1:4310')
    const cancelled = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(started).toBe(1))
    await subject.configureConnection('custom', 'http://127.0.0.1:4311')
    await cancelled
    expect(started).toBe(2)
    expect(harness.connects[1]).toMatchObject({ endpoint: { port: 4311 } })
  })

  it('applies an external settings change without waiting for an obsolete connection', async () => {
    const pending = deferred<unknown>()
    const connect = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue({
        backend: { connection: { endpoint: { port: 4311 } } },
        state: { kind: 'connected' },
      })
    const subject = lifecycle(connect)
    const previous = subject.reconnect()
    const cancelled = expect(previous).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce())
    harness.configuration.connection.serverUrl = 'http://127.0.0.1:4311'
    await subject.reconnectOnTransportChange()
    expect(harness.connects[1]).toMatchObject({ mode: 'custom', endpoint: { port: 4311 } })
    pending.resolve({ backend: { connection: { endpoint: { port: 4310 } } }, state: { kind: 'connected' } })
    await cancelled
  })

  it('uses the paired restart address and its exact version before preparing credentials', async () => {
    const original = 'http://127.0.0.1:43120'
    const changed = 'http://127.0.0.1:43121'
    const authorize = vi.fn().mockResolvedValue(undefined)
    const connect = vi.fn().mockResolvedValue({
      backend: { connection: { endpoint: { host: '127.0.0.1', port: 43121, baseUrl: changed } } },
      state: { kind: 'connected' },
    })
    const resolve = vi.fn().mockResolvedValue(changed + '/?token=fixture-rotated')
    const subject = createConnectionLifecycle({
      context: { workspaceState: { get: () => original, update: () => Promise.resolve() } },
      configuration: {
        read: () => ({
          connection: { mode: 'custom', serverUrl: original, runtimeVersion: '0.2.1-rc.1' },
          runtime: { autoStart: false },
        }),
      },
      desktopPairing: { resolve, has: () => Promise.resolve(true) },
      externalConnection: { authorizePairedDesktop: authorize, revision: 3 },
      discoverDesktopVersion: () => Promise.resolve('0.2.1-rc.2'),
      coordinator: { connect },
      currentWorkspaceFolders: () => [],
      endpointLaunchUrls: new Map(),
      attach: () => Promise.resolve(),
      publishState: () => undefined,
      disposeAccountLifecycleHost: () => Promise.resolve(),
      detachSessionAdapters: () => undefined,
    } as never)
    await subject.connect()
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: changed }),
      'fixture-rotated',
      undefined,
    )
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: { host: '127.0.0.1', port: 43121, baseUrl: changed },
        runtimeVersion: '0.2.1-rc.2',
        autoStart: false,
      }),
      undefined,
    )
    resolve.mockRejectedValueOnce(new Error('Paired Desktop unavailable'))
    await expect(subject.connect()).rejects.toThrow('unavailable')
    expect(authorize).toHaveBeenCalledTimes(1)
    expect(connect).toHaveBeenCalledTimes(1)
  })

  function automaticFixture(
    discover = vi.fn().mockResolvedValue({
      url: 'http://127.0.0.1:43120/?token=fixture-auto',
      key: 'K'.repeat(43),
      endpoint: { host: '127.0.0.1', port: 43120, baseUrl: 'http://127.0.0.1:43120' },
      runtimeVersion: '0.2.1-rc.2',
    }),
  ): {
    subject: ReturnType<typeof createConnectionLifecycle>
    discover: ReturnType<typeof vi.fn>
    global: Map<string, unknown>
    workspace: Map<string, unknown>
    authorizePaired: ReturnType<typeof vi.fn>
    authorize: ReturnType<typeof vi.fn>
    clearAll: ReturnType<typeof vi.fn>
    clearPair: ReturnType<typeof vi.fn>
  } {
    const global = new Map<string, unknown>()
    const workspace = new Map<string, unknown>()
    const storage = (
      values: Map<string, unknown>,
    ): {
      get: (name: string) => unknown
      update: (name: string, value: unknown) => Promise<void>
    } => ({
      get: (name: string) => values.get(name),
      update: (name: string, value: unknown) => {
        values.set(name, value)
        return Promise.resolve()
      },
    })
    let pairedOrigin: string | undefined
    const clearAll = vi.fn().mockResolvedValue(undefined)
    const clearPair = vi.fn(() => {
      pairedOrigin = undefined
      return Promise.resolve()
    })
    const authorizePaired = vi.fn().mockResolvedValue(undefined)
    const authorize = vi.fn().mockResolvedValue(undefined)
    const subject = createConnectionLifecycle({
      context: { workspaceState: storage(workspace), globalState: storage(global) },
      configuration: { read: () => harness.configuration },
      discoverAutomaticDesktop: discover,
      desktopPairing: {
        has: (origin: string) => Promise.resolve(origin === pairedOrigin),
        save: (origin: string) => {
          pairedOrigin = origin
          return Promise.resolve()
        },
        resolve: () => Promise.resolve('http://127.0.0.1:43120/?token=fixture-auto'),
        clear: clearPair,
      },
      externalConnection: {
        authorizePairedDesktop: authorizePaired,
        clearAll,
        authorize,
        release: () => Promise.resolve(),
        revision: 0,
      },
      coordinator: {
        connect: (request: unknown) => {
          harness.connects.push(request as never)
          return Promise.resolve({
            backend: {
              connection: { endpoint: { host: '127.0.0.1', port: 43120, baseUrl: 'http://127.0.0.1:43120' } },
            },
            state: { kind: 'connected' },
          })
        },
        disconnect: () => Promise.resolve(),
      },
      currentWorkspaceFolders: () => [],
      endpointLaunchUrls: new Map(),
      attach: () => Promise.resolve(),
      publishState: () => undefined,
      disposeAccountLifecycleHost: () => Promise.resolve(),
      detachSessionAdapters: () => undefined,
    } as never)
    harness.transportListeners.push(subject.reconnectOnTransportChange)
    return { subject, discover, global, workspace, authorizePaired, authorize, clearAll, clearPair }
  }

  it('resets saved settings and credentials offline without reconnecting, then permits a fresh first connection', async () => {
    const f = automaticFixture()
    harness.configuration.connection = {
      mode: 'custom',
      serverUrl: 'http://127.0.0.1:43120',
      runtimeVersion: '0.2.1-rc.2',
    }
    harness.configuration.runtime.autoStart = true
    f.global.set('dsh.desktop.automaticOrigin.v1', 'http://127.0.0.1:43120')
    f.workspace.set('dsh.desktop.lastEndpoint', 'http://127.0.0.1:43120')
    f.workspace.set('dsh.lastEndpoint', { host: '127.0.0.1', port: 43120 })
    await Promise.all([f.subject.resetConnection(), f.subject.resetConnection()])
    expect(f.clearAll).toHaveBeenCalledTimes(1)
    expect(f.clearPair).toHaveBeenCalledTimes(1)
    expect(harness.configuration).toMatchObject({
      connection: { mode: 'attach-only', serverUrl: '', runtimeVersion: '' },
      runtime: { autoStart: false },
    })
    expect(f.global.get('dsh.desktop.automaticOrigin.v1')).toBeUndefined()
    expect(f.workspace.get('dsh.desktop.lastEndpoint')).toBeUndefined()
    expect(f.workspace.get('dsh.lastEndpoint')).toBeUndefined()
    expect(f.subject.isAutomaticConnectionPaused()).toBe(true)
    await f.subject.reconnectOnTransportChange()
    expect(harness.connects).toHaveLength(0)
    expect(f.discover).not.toHaveBeenCalled()
    await f.subject.connect()
    expect(f.discover).toHaveBeenCalledTimes(1)
    expect(f.subject.isAutomaticConnectionPaused()).toBe(false)
  })

  it('prevents delayed automatic enrollment from restoring a pairing after reset', async () => {
    const pending = deferred<unknown>()
    const discover = vi.fn().mockImplementation(() => pending.promise)
    const f = automaticFixture(discover)
    const connecting = f.subject.connect()
    const rejected = expect(connecting).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(discover).toHaveBeenCalled())
    const resetting = f.subject.resetConnection()
    pending.resolve({
      url: 'http://127.0.0.1:43120/?token=fixture',
      key: 'K'.repeat(43),
      endpoint: { host: '127.0.0.1', port: 43120, baseUrl: 'http://127.0.0.1:43120' },
      runtimeVersion: '0.2.1-rc.2',
    })
    await rejected
    await resetting
    expect(f.authorizePaired).not.toHaveBeenCalled()
    expect(harness.connects).toHaveLength(0)
    expect(f.subject.isAutomaticConnectionPaused()).toBe(true)
  })

  it('automatically enrolls a verified enabled Desktop without requiring address entry', async () => {
    const f = automaticFixture()
    await Promise.all([f.subject.connect(), f.subject.connect()])
    expect(f.discover).toHaveBeenCalledTimes(1)
    expect(f.authorize).not.toHaveBeenCalled()
    expect(harness.configuration.connection).toMatchObject({
      mode: 'custom',
      serverUrl: 'http://127.0.0.1:43120',
      runtimeVersion: '0.2.1-rc.2',
    })
    expect(f.global.get('dsh.desktop.automaticOrigin.v1')).toBe('http://127.0.0.1:43120')
    expect(f.workspace.get('dsh.desktop.lastEndpoint')).toBe('http://127.0.0.1:43120')
    expect(harness.connects.every((request) => request.mode === 'custom')).toBe(true)
  })

  it('leaves a manually entered connection intact without automatic discovery', async () => {
    harness.configuration.connection.mode = 'custom'
    harness.configuration.connection.serverUrl = 'http://127.0.0.1:43121'
    const f = automaticFixture()
    await f.subject.connect()
    expect(f.discover).not.toHaveBeenCalled()
    expect(f.authorizePaired).not.toHaveBeenCalled()
    expect(harness.connects[0]).toMatchObject({ endpoint: { baseUrl: 'http://127.0.0.1:43121' } })
  })

  it('discards late automatic discovery when the person submits a manual address', async () => {
    const pending = deferred<unknown>()
    const discover = vi.fn().mockReturnValue(pending.promise)
    const f = automaticFixture(discover)
    const original = f.subject.connect()
    const cancelled = expect(original).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(discover).toHaveBeenCalled())
    const manual = f.subject.configureConnection('custom', 'http://127.0.0.1:43121')
    pending.resolve({
      url: 'http://127.0.0.1:43120/?token=fixture-auto',
      key: 'K'.repeat(43),
      endpoint: { host: '127.0.0.1', port: 43120, baseUrl: 'http://127.0.0.1:43120' },
      runtimeVersion: '0.2.1-rc.2',
    })
    await cancelled
    await manual
    expect(f.authorizePaired).not.toHaveBeenCalled()
    expect(harness.configuration.connection.serverUrl).toBe('http://127.0.0.1:43121')
    expect(f.global.get('dsh.desktop.automaticOrigin.v1')).toBeUndefined()
  })

  it('restores an empty automatic selection if secure grant persistence fails', async () => {
    const f = automaticFixture()
    f.authorizePaired.mockRejectedValueOnce(new Error('Secure storage unavailable'))
    await expect(f.subject.connect()).rejects.toThrow('Secure storage unavailable')
    expect(harness.configuration.connection.mode).toBe('auto')
    expect(harness.configuration.connection.serverUrl).toBe('')
    expect(f.global.get('dsh.desktop.automaticOrigin.v1')).toBeUndefined()
    expect(harness.connects).toHaveLength(0)
  })
})
