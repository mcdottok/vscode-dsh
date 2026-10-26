// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import type { HostMessage } from '@dsh-vscode/webview-protocol'
import type { ProtocolClient } from './protocol-client.js'
import {
  createHostBackedAppStore as createAppStore,
  type FixtureRequest as WebviewRequest,
} from '../test/host-window-store.js'

class DiagnosticsClient {
  public readonly requests: WebviewRequest[] = []
  private readonly listeners = new Set<(message: HostMessage) => void>()

  public constructor(private readonly answer: (request: WebviewRequest) => unknown) {}

  public request<T>(request: WebviewRequest): Promise<T> {
    this.requests.push(request)
    return Promise.resolve(this.answer(request) as T)
  }

  public subscribe(listener: (message: HostMessage) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  public dispose(): void {
    this.listeners.clear()
  }
}

const snapshot = {
  extensionVersion: '0.1.11',
  dshVersion: '0.1.9',
  state: 'failed',
  endpointKind: 'managed',
  canReconnect: true,
  recentEvents: ['{"level":"error","event":"connection-state"}'],
} as const

describe('AppStore diagnostics', () => {
  it('opens Desktop authorization through the Host without a URL or token in the request', async () => {
    const client = new DiagnosticsClient(() => ({ requested: true }))
    const store = createAppStore(client as unknown as ProtocolClient)
    await store.runtimeAction('connect-desktop')
    expect(client.requests).toHaveLength(1)
    const { requestId, ...message } = client.requests[0]!
    expect(typeof requestId).toBe('string')
    expect(message).toEqual({
      type: 'runtime.action',
      payload: { action: 'connect-desktop' },
    })
    store.dispose()
  })
  it('requests and strictly projects the host diagnostics snapshot', async () => {
    const client = new DiagnosticsClient((request) => {
      if (request.type !== 'diagnostics.snapshot') throw new Error(`unexpected ${request.type}`)
      return snapshot
    })
    const store = createAppStore(client as unknown as ProtocolClient)

    await expect(store.readDiagnostics()).resolves.toEqual(snapshot)
    expect(client.requests[0]?.type).toBe('diagnostics.snapshot')
    store.dispose()
  })

  it('fails closed on a malformed snapshot and keeps output opening host-only', async () => {
    const client = new DiagnosticsClient((request) => {
      if (request.type === 'diagnostics.snapshot')
        return { ...snapshot, recentEvents: ['too long'.repeat(2_000)] }
      if (request.type === 'diagnostics.show') return { shown: true }
      throw new Error(`unexpected ${request.type}`)
    })
    const store = createAppStore(client as unknown as ProtocolClient)

    await expect(store.readDiagnostics()).resolves.toBeUndefined()
    await store.showDiagnostics()
    expect(client.requests.map((request) => request.type)).toEqual([
      'diagnostics.snapshot',
      'diagnostics.show',
    ])
    store.dispose()
  })
})
