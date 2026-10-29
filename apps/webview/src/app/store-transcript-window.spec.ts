// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { HostMessage, TranscriptWindow, WebviewRequest } from '@dsh-vscode/webview-protocol'
import type { ProtocolClient } from './protocol-client.js'
import { createAppStore } from './store.js'

function window(sessionId: string, revision = 1, markdown = 'Final reply'): TranscriptWindow {
  return {
    sessionId,
    revision,
    nodes: [
      { kind: 'assistant-message', id: `reply-${sessionId}`, markdown, streaming: false, sequence: 10 },
    ],
    eventFacts: [{ id: 'event-10', type: 'message.completed', sequence: 10, representedSequences: 1 }],
    lastSequence: 10,
    hasMore: true,
    beforeSequence: 5,
    historical: false,
    omittedNodeIds: [],
  }
}
function detail(sessionId: string): Record<string, unknown> {
  return {
    id: sessionId,
    workspaceId: 'workspace',
    title: 'Fixture',
    blank: false,
    status: 'idle',
    createdAt: '2026-10-14T00:00:00Z',
    updatedAt: '2026-10-14T00:00:00Z',
    history: [],
    transcript: window(sessionId),
    historyHasMore: true,
    historyBeforeSequence: 5,
  }
}
class Client {
  public readonly requests: WebviewRequest[] = []
  public open: ((sessionId: string) => Promise<unknown>) | undefined
  public navigate:
    | ((direction: 'older' | 'newer' | 'latest', sessionId: string, revision: number) => Promise<unknown>)
    | undefined
  private readonly listeners = new Set<(message: HostMessage) => void>()
  public request<T>(request: WebviewRequest): Promise<T> {
    this.requests.push(request)
    let result: unknown = []
    if (request.type === 'session.open')
      return (this.open?.(request.payload.sessionId) ??
        Promise.resolve(detail(request.payload.sessionId))) as Promise<T>
    if (request.type === 'subagent.list') result = { entries: [], parentAvailable: true }
    if (request.type === 'session.transcript.navigate' && this.navigate !== undefined)
      return this.navigate(
        request.payload.direction,
        request.payload.sessionId,
        request.payload.revision,
      ) as Promise<T>
    if (request.type === 'session.transcript.navigate')
      result = {
        ...window(request.payload.sessionId, request.payload.revision + 1, 'Older reply'),
        historical: true,
      }
    return Promise.resolve(result as T)
  }
  public subscribe(listener: (message: HostMessage) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  public emit(window: TranscriptWindow): void {
    this.send('session.transcript', window, window.revision)
  }
  public send(name: string, payload: unknown, sequence = 1): void {
    for (const listener of this.listeners) listener({ type: 'event', name, sequence, payload })
  }
  public dispose(): void {
    this.listeners.clear()
  }
}

describe('Webview installs Host windows', () => {
  it('retries a lost history response from the last actually loaded cursor, despite newer live metadata', async () => {
    const client = new Client()
    client.open = (id) => Promise.resolve({ ...detail(id), transcript: { ...window(id), delivery: 'live' } })
    const navigate = vi
      .fn()
      .mockRejectedValueOnce(new Error('History response was lost'))
      .mockResolvedValueOnce({
        ...window('s', 4),
        delivery: 'prepend',
        hasMore: false,
        beforeSequence: 0,
        nodes: [
          { kind: 'assistant-message', id: 'old', markdown: 'Recovered old message', streaming: false },
        ],
      })
    client.navigate = navigate
    const store = createAppStore(client as unknown as ProtocolClient)
    try {
      await store.openSession('s')
      const loading = store.loadOlderHistory()
      client.emit({
        ...window('s', 3, 'New live response'),
        delivery: 'live',
        hasMore: false,
        beforeSequence: 0,
      })
      await expect(loading).rejects.toThrow('History response was lost')
      expect(store.historyHasMore).toBe(true)
      expect(store.getState().historyBeforeSequence).toBe(5)
      await store.loadOlderHistory()
      const requests = client.requests.filter((request) => request.type === 'session.transcript.navigate')
      expect(requests.map((request) => request.payload.beforeSequence)).toEqual([5, 5])
      expect(store.timeline.nodes.map((node) => ('markdown' in node ? node.markdown : ''))).toEqual([
        'Recovered old message',
        'New live response',
      ])
      expect(store.historyHasMore).toBe(false)
    } finally {
      store.dispose()
    }
  })

  it('keeps an entire loaded conversation visible across bounded history batches and live updates', async () => {
    const client = new Client()
    client.open = (id) =>
      Promise.resolve({
        ...detail(id),
        transcript: { ...window(id), delivery: 'live', beforeSequence: 2501 },
      })
    let page = 0
    client.navigate = (_direction, id, revision) => {
      page++
      const start = (5 - page) * 500
      return Promise.resolve({
        ...window(id, revision + 1),
        delivery: 'prepend',
        historical: false,
        nodes: Array.from({ length: 500 }, (_, i) => ({
          kind: 'assistant-message',
          id: `old-${start + i}`,
          markdown: `Earlier reply ${start + i}`,
          streaming: false,
        })),
        beforeSequence: start,
        hasMore: page < 5,
      })
    }
    const store = createAppStore(client as unknown as ProtocolClient)
    try {
      await store.openSession('s')
      for (let i = 0; i < 5; i++) {
        await store.loadOlderHistory()
        expect(store.timeline.nodes).toHaveLength((i + 1) * 500 + 1)
        expect(store.timeline.nodes.at(-1)).toMatchObject({ markdown: 'Final reply' })
        expect(store.getState().transcript?.historical).toBe(false)
      }
      const revision = store.getState().transcript!.revision
      client.emit({
        ...window('s', revision + 1, 'Latest live response'),
        delivery: 'live',
        hasMore: false,
        beforeSequence: 0,
      })
      expect(store.timeline.nodes).toHaveLength(2501)
      expect(store.timeline.nodes[0]).toMatchObject({ markdown: 'Earlier reply 0' })
      expect(store.timeline.nodes.at(-1)).toMatchObject({ markdown: 'Latest live response' })
      expect(new Set(store.timeline.nodes.map((node) => node.id)).size).toBe(2501)
      expect(store.getState().transcript?.nodes).toHaveLength(1)
      expect(store.historyHasMore).toBe(false)
    } finally {
      store.dispose()
    }
  })

  it('prepends a delayed history batch without rolling back a newer live response', async () => {
    const client = new Client()
    client.open = (id) => Promise.resolve({ ...detail(id), transcript: { ...window(id), delivery: 'live' } })
    let finish!: (value: unknown) => void
    client.navigate = () =>
      new Promise((resolve) => {
        finish = resolve
      })
    const store = createAppStore(client as unknown as ProtocolClient)
    try {
      await store.openSession('s')
      const loading = store.loadOlderHistory()
      client.emit({ ...window('s', 3, 'Live response while reading history'), delivery: 'live' })
      expect(store.historyLoading).toBe(true)
      finish({
        ...window('s', 2, 'Old page'),
        delivery: 'prepend',
        nodes: [{ kind: 'assistant-message', id: 'old', markdown: 'Old page', streaming: false }],
        beforeSequence: 1,
      })
      await loading
      expect(store.timeline.nodes.map((node) => ('markdown' in node ? node.markdown : ''))).toEqual([
        'Old page',
        'Live response while reading history',
      ])
      expect(store.getState().transcript?.revision).toBe(3)
      expect(store.historyLoading).toBe(false)
    } finally {
      store.dispose()
    }
  })

  it('ignores a latest response that finishes after reopening the same session', async () => {
    const client = new Client()
    let finish!: (value: unknown) => void
    client.navigate = () =>
      new Promise((resolve) => {
        finish = resolve
      })
    const store = createAppStore(client as unknown as ProtocolClient)
    try {
      await store.openSession('s')
      const latest = store.navigateTranscript('latest')
      await store.openSession('s')
      finish(window('s', 100, 'Stale previous connection'))
      await latest
      expect(store.timeline.nodes[0]).toMatchObject({ markdown: 'Final reply' })
    } finally {
      store.dispose()
    }
  })
  for (const noticesOnly of [false, true])
    it(`automatically reloads lost conversation content without re-entering the session (notices: ${noticesOnly})`, async () => {
      vi.useFakeTimers()
      const client = new Client()
      const store = createAppStore(client as unknown as ProtocolClient)
      try {
        client.send('connection.snapshot', { kind: 'connected' })
        await store.openSession('s')
        let attempts = 0
        const incomplete = (revision: number): TranscriptWindow => ({
          ...window('s', revision),
          hasMore: false,
          nodes: noticesOnly
            ? [{ kind: 'notice', id: 'held', level: 'error', text: 'Writer unavailable' }]
            : [],
        })
        client.open = (sessionId) => {
          attempts++
          return Promise.resolve({
            ...detail(sessionId),
            transcript: attempts === 1 ? incomplete(10) : window(sessionId, 11, 'Recovered history'),
          })
        }
        client.emit(incomplete(9))
        await vi.advanceTimersByTimeAsync(0)
        expect(store.getState().timeline.nodes[0]).toMatchObject({ markdown: 'Final reply' })
        expect(store.getState().transcript?.revision).toBe(1)
        await vi.advanceTimersByTimeAsync(1_000)
        expect(attempts).toBe(2)
        expect(store.getState().timeline.nodes[0]).toMatchObject({ markdown: 'Recovered history' })
        expect(store.getState().transcript?.revision).toBe(11)
      } finally {
        store.dispose()
        vi.useRealTimers()
      }
    })

  it('restores the DSH clock with a window and clears it on a settled replacement', async () => {
    const client = new Client()
    const store = createAppStore(client as unknown as ProtocolClient)
    try {
      await store.openSession('s')
      client.emit({ ...window('s', 2), activeTurn: 1, activeTurnStartedAt: 1234 })
      expect(store.getState().timeline.activeTurnStartedAt).toBe(1234)
      client.emit(window('s', 3))
      expect(store.getState().timeline.activeTurnStartedAt).toBeUndefined()
    } finally {
      store.dispose()
    }
  })
  it('notifies subscribers synchronously when a Host view arrives', async () => {
    const client = new Client()
    const store = createAppStore(client as unknown as ProtocolClient)
    try {
      await store.openSession('s')
      const revisions: number[] = []
      const unsubscribe = store.subscribe(() => revisions.push(store.getState().transcript!.revision))
      client.emit(window('s', 2, 'Immediate reply'))
      expect(revisions).toEqual([2])
      unsubscribe()
      client.emit(window('s', 3, 'Next reply'))
      expect(revisions).toEqual([2])
    } finally {
      store.dispose()
    }
  })
  it('applies pending interactions immediately even when an open fails', async () => {
    const client = new Client()
    let reject: ((error: Error) => void) | undefined
    client.open = () =>
      new Promise((_resolve, fail) => {
        reject = fail
      })
    const store = createAppStore(client as unknown as ProtocolClient)
    try {
      const opening = store.openSession('s')
      const result = expect(opening).rejects.toThrow('open failed')
      for (let i = 0; i < 20 && reject === undefined; i++) await Promise.resolve()
      client.send('permission.requested', {
        request: {
          id: 'approval',
          sessionId: 's',
          title: 'Allow?',
          description: 'Fixture',
          risk: 'medium',
          options: [{ id: 'allow', label: 'Allow once', kind: 'allow-once' }],
        },
      })
      expect(store.permissions.map((request) => request.id)).toEqual(['approval'])
      reject?.(new Error('open failed'))
      await result
      expect(store.permissions.map((request) => request.id)).toEqual(['approval'])
    } finally {
      store.dispose()
    }
  })
  it('rejects raw-only opens without reviving a compatibility engine or replacing the current view', async () => {
    const client = new Client()
    const store = createAppStore(client as unknown as ProtocolClient)
    try {
      await store.openSession('current')
      client.open = (id) =>
        Promise.resolve({
          ...detail(id),
          transcript: undefined,
          history: [{ sequence: 1, event: { type: 'message.user' } }],
        })
      await expect(store.openSession('legacy')).rejects.toThrow()
      expect(store.activeSessionId).toBe('current')
      expect(store.timeline.nodes[0]).toMatchObject({ markdown: 'Final reply' })
      expect(store.getState()).not.toHaveProperty('history')
    } finally {
      store.dispose()
    }
  })

  it('does not parse, buffer or replay raw transcript frames and never requests a gap page', async () => {
    const client = new Client()
    const store = createAppStore(client as unknown as ProtocolClient)
    try {
      await store.openSession('s')
      for (const name of [
        'message.delta',
        'message.completed',
        'tool.updated',
        'session.gap',
        'compaction.updated',
        'todo.updated',
      ])
        client.send(name, {
          sessionId: 's',
          sequence: 99,
          messageId: 'raw',
          delta: 'RAW_BODY',
          markdown: 'RAW_BODY',
          fromSequence: 1,
          toSequence: 98,
        })
      expect(store.timeline.nodes[0]).toMatchObject({ markdown: 'Final reply' })
      expect(JSON.stringify(store.getState())).not.toContain('RAW_BODY')
      expect(client.requests.map((request) => request.type)).not.toContain('session.history')
      expect(store.getState()).not.toHaveProperty('history')
    } finally {
      store.dispose()
    }
  })
  it('replaces views without a durable ledger and releases previous session bodies from the roster', async () => {
    const client = new Client()
    const store = createAppStore(client as unknown as ProtocolClient)
    try {
      await store.openSession('s')
      expect(store.getState()).not.toHaveProperty('history')
      expect(store.getState().timeline.nodes[0]).toMatchObject({ markdown: 'Final reply' })
      client.emit(window('s', 2, 'Latest complete response'))
      client.emit(window('s', 1, 'Stale reply'))
      expect(store.getState().timeline.nodes[0]).toMatchObject({ markdown: 'Latest complete response' })
      await store.loadOlderHistory()
      expect(store.getState().timeline.nodes).toHaveLength(1)
      expect(store.getState().timeline.nodes[0]).toMatchObject({ markdown: 'Older reply' })
      expect(client.requests.map((request) => request.type)).not.toContain('session.history')
      expect(client.requests).toContainEqual(
        expect.objectContaining({ type: 'session.transcript.ack', payload: { sessionId: 's', revision: 2 } }),
      )
      await store.openSession('other')
      expect(JSON.stringify(store.getState().sessions)).not.toContain('markdown')
      expect(store.getState()).not.toHaveProperty('history')
      client.emit(window('s', 100, 'Wrong session'))
      expect(store.getState().timeline.sessionId).toBe('other')
    } finally {
      store.dispose()
    }
  })

  it('coalesces snapshots arriving across the opening barrier and accepts only the latest complete view', async () => {
    const client = new Client()
    let resolve: ((detail: unknown) => void) | undefined
    client.open = () =>
      new Promise((done) => {
        resolve = done
      })
    const store = createAppStore(client as unknown as ProtocolClient)
    try {
      const opening = store.openSession('s')
      for (let i = 0; i < 20 && resolve === undefined; i++) await Promise.resolve()
      for (let revision = 2; revision <= 100; revision++)
        client.emit(window('s', revision, `Response ${revision}`))
      resolve?.(detail('s'))
      await opening
      expect(store.getState().timeline.nodes[0]).toMatchObject({ markdown: 'Response 100' })
      expect(store.getState().transcript?.revision).toBe(100)
      expect(store.getState()).not.toHaveProperty('history')
    } finally {
      store.dispose()
    }
  })
})
