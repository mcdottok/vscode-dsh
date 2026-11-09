import { describe, expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'
import type { BackendEndpoint } from '@dsh-vscode/domain'
import { FakeWebSocket } from './support/fake-web-socket.js'

import type { DshTransport } from '../src/contracts.js'
import { VersionedBackendProbe } from '../src/probe.js'
import { Alpha5VersionAdapter } from '../src/versions/alpha5/adapter.js'
import { callRpc } from '../src/versions/rc6/rpc.js'
import { bodyText, candidate, endpoint, rpcResponse as response } from './support/contract-harness.js'

function requestBody(init: RequestInit | undefined): {
  readonly type?: string
  readonly method?: string
  readonly payload?: {
    readonly args?: { readonly request?: { readonly content?: unknown } }
  }
} {
  return JSON.parse(bodyText(init)) as {
    readonly type?: string
    readonly method?: string
    readonly payload?: {
      readonly args?: { readonly request?: { readonly content?: unknown } }
    }
  }
}

function adapter(fetch: typeof globalThis.fetch): Alpha5VersionAdapter {
  return new Alpha5VersionAdapter({
    requestTimeoutMs: 1_000,
    retryPolicy: { maximumAttempts: 1, baseDelayMs: 1, maximumDelayMs: 1 },
    fetch,
  })
}

async function confirmLegacyControl(): Promise<FakeWebSocket> {
  await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
  const socket = FakeWebSocket.instances[0]
  if (socket === undefined) throw new Error('Compatibility socket was not created')
  socket.open()
  await vi.waitFor(() => expect(socket.sent).toHaveLength(1))
  const frame = JSON.parse(socket.sent[0] ?? '{}') as { streamId: string; endpoint: string }
  expect(frame.endpoint).toBe('session/control')
  // dsh-v0.1.2-alpha.5 / db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5:
  // packages/api/session-controller/src/types.ts SessionControlBaseline.
  socket.message({
    type: 'item',
    streamId: frame.streamId,
    value: { type: 'baseline', value: { queues: {}, jobs: {}, projections: {} } },
  })
  return socket
}

function compatibilityAdapter(fetch: typeof globalThis.fetch): Alpha5VersionAdapter {
  return new Alpha5VersionAdapter({
    requestTimeoutMs: 1000,
    retryPolicy: { maximumAttempts: 1, baseDelayMs: 1, maximumDelayMs: 1 },
    fetch,
    webSocket: FakeWebSocket,
  })
}

describe('DSH 0.1.2-alpha.5 Connection/Gateway contract', () => {
  it('uses alpha.5 as the newest verified implementation for an unknown future runtime', async () => {
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(response(init, { ok: true, value: { items: [] } })),
    )
    FakeWebSocket.instances.length = 0
    const probing = new VersionedBackendProbe([compatibilityAdapter(fetch)]).probe(candidate('0.1.2-alpha.6'))
    const socket = await confirmLegacyControl()
    const connected = await probing
    expect(socket.closeCalls).toBe(1)
    expect(socket.sent.map((entry) => (JSON.parse(entry) as { type: string }).type)).toEqual([
      'open',
      'cancel',
    ])

    expect(connected).toMatchObject({
      ownership: 'external',
      capabilities: {
        protocolVersion: 'alpha5',
        dshVersion: '0.1.2-alpha.6',
        adapterId: 'dsh-0.1.2-alpha.5',
        compatibilityMode: 'best-effort',
        subagentImagePrompts: false,
        featureProfile: { source: 'compatibility-fallback' },
      },
    })
    expect(connected?.capabilities.compatibilityWarning).toContain('0.1.2-alpha.6')
  })

  it('connects an endpoint with no discoverable runtime version via the compatibility fallback', async () => {
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(response(init, { ok: true, value: { items: [] } })),
    )
    FakeWebSocket.instances.length = 0
    const probing = new VersionedBackendProbe([compatibilityAdapter(fetch)]).probe({
      endpoint,
      source: 'configured',
      confidence: 120,
    })
    const socket = await confirmLegacyControl()
    const connected = await probing
    expect(socket.closeCalls).toBe(1)

    expect(connected).toMatchObject({
      ownership: 'external',
      capabilities: {
        protocolVersion: 'alpha5',
        dshVersion: 'unknown',
        adapterId: 'dsh-0.1.2-alpha.5',
        compatibilityMode: 'best-effort',
      },
    })
    expect(connected?.capabilities.compatibilityWarning).toContain('did not expose its package version')
  })

  it('retains the alpha Remote error mapper at the alpha.5 version boundary', async () => {
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        response(init, {
          ok: false,
          error: { code: 'session/agent-busy', message: 'agent is busy', details: {} },
        }),
      ),
    )
    const transport = versionedTransport(adapter(fetch))

    await expect(callRpc(transport, 'session.list', {})).rejects.toMatchObject({
      code: 'BACKEND_BUSY',
      context: { rpcCode: 'agent-busy' },
    })
    await transport.close()
  })

  it('projects the void agentPresets/copy success using the requested destination id', async () => {
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(response(init, { ok: true, value: undefined })),
    )
    const transport = versionedTransport(adapter(fetch))

    await expect(
      transport.request('agentPreset.copy', {
        from: 'standard',
        agentPreset: 'my-copy',
        name: 'My copy',
      }),
    ).resolves.toMatchObject({ result: { ok: true, value: { agentPreset: 'my-copy' } } })

    const request = JSON.parse(bodyText(fetch.mock.calls[0]?.[1])) as {
      readonly method?: string
      readonly payload?: { readonly args?: Record<string, unknown> }
    }
    expect(request).toMatchObject({
      method: 'agentPresets/copy',
      payload: { args: { from: 'standard', id: 'my-copy', name: 'My copy' } },
    })
    await transport.close()
  })

  it('joins the alpha preset roster with the independent native-opener capability', async () => {
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(bodyText(init)) as { readonly method?: string }
      if (request.method === 'agentPresets/list')
        return Promise.resolve(response(init, { ok: true, value: { presets: [], authorable: false } }))
      if (request.method === 'settings/canOpenAgentPresetDirectory')
        return Promise.resolve(response(init, { ok: true, value: true }))
      throw new Error(`unexpected alpha.5 endpoint: ${request.method ?? '<missing>'}`)
    })
    const transport = versionedTransport(adapter(fetch))

    await expect(transport.request('agentPreset.list', {})).resolves.toMatchObject({
      result: { ok: true, value: { presets: [], authorable: false, hasDocument: true } },
    })
    expect(
      fetch.mock.calls.map((call) => (JSON.parse(bodyText(call[1])) as { readonly method?: string }).method),
    ).toEqual(['agentPresets/list', 'settings/canOpenAgentPresetDirectory'])
    await transport.close()
  })

  it('keeps the alpha preset roster usable without claiming a native opener when the probe fails', async () => {
    const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(bodyText(init)) as { readonly method?: string }
      if (request.method === 'agentPresets/list')
        return Promise.resolve(response(init, { ok: true, value: { presets: [], authorable: false } }))
      if (request.method === 'settings/canOpenAgentPresetDirectory')
        return Promise.reject(new Error('settings controller is unavailable'))
      throw new Error(`unexpected alpha.5 endpoint: ${request.method ?? '<missing>'}`)
    })
    const transport = versionedTransport(adapter(fetch))

    // A probe that never answered states nothing: the roster must not carry a
    // fabricated `hasDocument` that reads as "the host cannot open a directory".
    const outcome = await transport.request<{
      readonly result: { readonly ok: boolean; readonly value: Record<string, unknown> }
    }>('agentPreset.list', {})
    expect(outcome).toMatchObject({ result: { ok: true, value: { presets: [], authorable: false } } })
    expect(Object.hasOwn(outcome.result.value, 'hasDocument')).toBe(false)
    await transport.close()
  })

  it('does not coerce a malformed preset hasDocument capability into false', async () => {
    const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(bodyText(init)) as { readonly method?: string }
      if (request.method === 'agentPresets/list')
        return Promise.resolve(
          response(init, { ok: true, value: { presets: [], authorable: false, hasDocument: 'yes' } }),
        )
      if (request.method === 'settings/canOpenAgentPresetDirectory')
        return Promise.resolve(response(init, { ok: true, value: true }))
      throw new Error(`unexpected alpha.5 endpoint: ${request.method ?? '<missing>'}`)
    })
    const transport = versionedTransport(adapter(fetch))

    await expect(transport.request('agentPreset.list', {})).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' })
    await transport.close()
  })

  it('forwards the optional goal round cap through both alpha goal mutations', async () => {
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(bodyText(init)) as { readonly method?: string }
      const value =
        body.method === 'goals/create'
          ? { ref: { id: 'goal-1', revision: 1 } }
          : { ref: { id: 'goal-1', revision: 2 } }
      return Promise.resolve(response(init, { ok: true, value }))
    })
    const transport = versionedTransport(adapter(fetch))

    await transport.request('goal.create', { sessionId: 's1', objective: 'Bounded work', maxGoalRounds: 7 })
    await transport.request('goal.edit', {
      sessionId: 's1',
      ref: { id: 'goal-1', revision: 1 },
      maxGoalRounds: 9,
    })

    const requests = fetch.mock.calls.map(
      (call) => JSON.parse(bodyText(call[1])) as { payload?: { args?: unknown } },
    )
    expect(requests.map((request) => request.payload?.args)).toEqual([
      { agentId: 's1', request: { objective: 'Bounded work', maxGoalRounds: 7 } },
      { agentId: 's1', ref: { id: 'goal-1', revision: 1 }, request: { maxGoalRounds: 9 } },
    ])
    await transport.close()
  })

  it('passes the current mixed prompt content through the unchanged session.prompt wire', async () => {
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(response(init, { ok: true, value: { accepted: true } })),
    )
    const transport = versionedTransport(adapter(fetch))
    const content = [
      { type: 'text', text: '请查看这张图' },
      { type: 'image', mediaType: 'image/png', data: 'aGk=', name: 'screen.png' },
    ]

    await expect(
      transport.request('session.prompt', {
        sessionId: 's1',
        mode: 'steer',
        content,
        clientTimeZone: 'Asia/Shanghai',
      }),
    ).resolves.toMatchObject({ result: { ok: true, value: { accepted: true } } })

    const request = requestBody(fetch.mock.calls[0]?.[1])
    expect(request).toMatchObject({ type: 'client-request', method: 'session/prompt' })
    expect(request.payload?.args?.request?.content).toEqual(content)
    await transport.close()
  })

  it('rejects a malformed session.list value and releases the probe transport', async () => {
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(response(init, { ok: true, value: { items: 'not-an-array' } })),
    )

    await expect(adapter(fetch).probe(candidate('0.1.2-alpha.5'))).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('propagates caller cancellation through the alpha.5 probe', async () => {
    const controller = new AbortController()
    let observedSignal: AbortSignal | undefined
    const fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          observedSignal = init?.signal ?? undefined
          observedSignal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
            once: true,
          })
        }),
    )

    const pending = adapter(fetch).probe(candidate('0.1.2-alpha.5'), controller.signal)
    await vi.waitFor(() => expect(observedSignal).toBeDefined())
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(pending).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' })
    expect(observedSignal?.aborted).toBe(true)
  })
})

type ControlProbeMode = 'valid' | 'invalid' | 'end-before-baseline' | 'permission' | 'timeout' | 'abort'

async function controlHost(
  mode: ControlProbeMode,
  onOpen?: () => void,
): Promise<{
  readonly endpoint: BackendEndpoint
  readonly opened: Promise<void>
  readonly frames: ReadonlyArray<{ readonly type: string; readonly endpoint?: string }>
  readonly connections: () => number
  readonly close: () => Promise<void>
}> {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  const frames: Array<{ type: string; endpoint?: string }> = []
  let resolveOpen: () => void = () => undefined
  const opened = new Promise<void>((resolve) => {
    resolveOpen = resolve
  })
  server.on('connection', (socket) => {
    socket.on('message', (raw) => {
      const bytes = Array.isArray(raw)
        ? Buffer.concat(raw)
        : raw instanceof ArrayBuffer
          ? Buffer.from(raw)
          : raw
      const frame = JSON.parse(bytes.toString('utf8')) as {
        type: string
        endpoint?: string
        streamId: string
      }
      frames.push(frame)
      if (frame.type !== 'open') return
      resolveOpen()
      onOpen?.()
      if (mode === 'timeout' || mode === 'abort') return
      const reply =
        mode === 'permission'
          ? {
              type: 'error',
              streamId: frame.streamId,
              error: { code: 'credential/rejected', message: 'fixture denied', details: {} },
            }
          : mode === 'end-before-baseline'
            ? { type: 'end', streamId: frame.streamId }
            : {
                type: 'item',
                streamId: frame.streamId,
                value:
                  mode === 'invalid'
                    ? { type: 'baseline', value: { projections: {} } }
                    : { type: 'baseline', value: { queues: {}, jobs: {}, projections: {} } },
              }
      socket.send(JSON.stringify(reply))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('Missing fixture listener')
  return {
    endpoint: { host: '127.0.0.1', port: address.port, baseUrl: `http://127.0.0.1:${String(address.port)}` },
    opened,
    frames,
    connections: () => server.clients.size,
    close: () => {
      for (const socket of server.clients) socket.terminate()
      return new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    },
  }
}

describe('alpha5 compatibility control over a real socket', () => {
  it.each(['valid', 'invalid', 'end-before-baseline', 'timeout'] as const)(
    'checks %s control baselines and releases its loopback socket',
    async (mode): Promise<void> => {
      const host = await controlHost(mode)
      try {
        const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
          Promise.resolve(response(init, { ok: true, value: { items: [] } })),
        )
        const subject = new Alpha5VersionAdapter({
          requestTimeoutMs: mode === 'timeout' ? 100 : 5000,
          retryPolicy: { maximumAttempts: 1, baseDelayMs: 1, maximumDelayMs: 1 },
          fetch,
        })
        const result = await subject.probeCompatibility({
          endpoint: host.endpoint,
          source: 'configured',
          confidence: 1,
        })
        if (mode === 'valid') expect(result).toMatchObject({ adapterId: 'dsh-0.1.2-alpha.5' })
        else expect(result).toBeUndefined()
        expect(host.frames[0]).toMatchObject({ type: 'open', endpoint: 'session/control' })
        await vi.waitFor(() => expect(host.connections()).toBe(0))
        if (mode !== 'end-before-baseline')
          expect(host.frames).toContainEqual(expect.objectContaining({ type: 'cancel' }))
      } finally {
        await host.close()
      }
    },
  )

  it.each(['permission', 'abort'] as const)(
    'propagates %s and releases its loopback socket',
    async (mode): Promise<void> => {
      const controller = new AbortController()
      const host = await controlHost(mode, mode === 'abort' ? () => controller.abort() : undefined)
      try {
        const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
          Promise.resolve(response(init, { ok: true, value: { items: [] } })),
        )
        const subject = new Alpha5VersionAdapter({
          requestTimeoutMs: 5000,
          retryPolicy: { maximumAttempts: 1, baseDelayMs: 1, maximumDelayMs: 1 },
          fetch,
        })
        const pending = subject.probeCompatibility(
          { endpoint: host.endpoint, source: 'configured', confidence: 1 },
          controller.signal,
        )
        const rejected = expect(pending).rejects.toMatchObject(
          mode === 'permission' ? { code: 'PERMISSION_DENIED' } : { name: 'AbortError' },
        )
        await host.opened
        await rejected
        await vi.waitFor(() => expect(host.connections()).toBe(0))
        if (mode === 'abort') expect(host.frames).toContainEqual(expect.objectContaining({ type: 'cancel' }))
      } finally {
        await host.close()
      }
    },
  )
})

function versionedTransport(adapter: Alpha5VersionAdapter): DshTransport {
  return adapter.createTransport(endpoint)
}
