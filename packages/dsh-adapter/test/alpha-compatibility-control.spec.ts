import { describe, expect, it, vi } from 'vitest'
import type { BackendCandidate } from '@dsh-vscode/domain'
import { Alpha5VersionAdapter } from '../src/versions/alpha5/adapter.js'
import { wrappedResponse, transportOptions, endpoint } from './support/contract-harness.js'
import type { DshTransport as AdapterTransport } from '../src/contracts.js'

const candidate: BackendCandidate = { endpoint, source: 'configured', confidence: 100 }

class ControlProbeAdapter extends Alpha5VersionAdapter {
  public readonly closeProbe = vi.fn(() => Promise.resolve())
  public readonly cancelProbe = vi.fn()
  private transportCount = 0

  public constructor(
    private readonly baseline: unknown,
    private readonly waitForAbort = false,
  ) {
    super(transportOptions((_input, init) => Promise.resolve(wrappedResponse(init, { items: [] }))))
  }

  public override createTransport(): AdapterTransport {
    const transport = super.createTransport(endpoint)
    if (this.transportCount++ === 0) return transport
    const cancel = this.cancelProbe
    const baseline = this.baseline
    const waitForAbort = this.waitForAbort
    Object.assign(transport, {
      openRemoteStream: async function* (
        _endpoint: string,
        _args: Record<string, unknown>,
        signal: AbortSignal,
      ): AsyncGenerator<unknown> {
        try {
          if (waitForAbort) {
            await new Promise<void>((resolve) => {
              if (signal.aborted) resolve()
              else signal.addEventListener('abort', () => resolve(), { once: true })
            })
            signal.throwIfAborted()
          }
          yield baseline
        } finally {
          cancel()
        }
      },
      close: this.closeProbe,
    })
    return transport
  }
}

describe('unversioned alpha compatibility control probe', () => {
  it('rejects modern projection-only control even when the session list is readable', async () => {
    const adapter = new ControlProbeAdapter({ type: 'baseline', value: { projections: {} } })
    expect(await adapter.probeCompatibility(candidate)).toBeUndefined()
    expect(adapter.closeProbe).toHaveBeenCalledOnce()
    expect(adapter.cancelProbe).toHaveBeenCalledOnce()
  })

  it('accepts the legacy queue baseline and cancels the read-only stream', async () => {
    const adapter = new ControlProbeAdapter({
      type: 'baseline',
      value: { queues: {}, jobs: {}, projections: {} },
    })
    const capabilities = await adapter.probeCompatibility(candidate)
    expect(capabilities?.adapterId).toBe('dsh-0.1.2-alpha.5')
    expect(adapter.closeProbe).toHaveBeenCalledOnce()
    expect(adapter.cancelProbe).toHaveBeenCalledOnce()
  })

  it('does not report cancellation as a compatibility rejection', async () => {
    const adapter = new ControlProbeAdapter(undefined, true)
    const abort = new AbortController()
    const pending = adapter.probeCompatibility(candidate, abort.signal)
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    abort.abort()
    await assertion
    expect(adapter.closeProbe).toHaveBeenCalledOnce()
  })
})
