// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import type { HostMessage, TranscriptWindow, WebviewRequest } from '@dsh-vscode/webview-protocol'
import type { ProtocolClient } from './protocol-client.js'
import { createAppStore } from './store.js'

it(
  'retains 10,000 loaded history messages while publishing the live tail by frame',
  { tags: ['stress'], timeout: 20_000 },
  async () => {
    vi.useFakeTimers()
    const listeners = new Set<(message: HostMessage) => void>()
    const reply = { kind: 'assistant-message' as const, id: 'live', markdown: 'answer ', streaming: false }
    const window = (revision: number): TranscriptWindow => ({
      sessionId: 'session',
      revision,
      delivery: 'live',
      nodes: [reply],
      lastSequence: 10_001,
      eventFacts: [],
      omittedNodeIds: [],
      hasMore: true,
      beforeSequence: 10_000,
      historical: false,
    })
    let page = 0
    const client = {
      request: <T>(request: WebviewRequest): Promise<T> => {
        let value: unknown = []
        if (request.type === 'session.open')
          value = {
            id: 'session',
            workspaceId: 'workspace',
            title: 'Continuous history',
            blank: false,
            status: 'idle',
            createdAt: '2026-10-29T00:00:00Z',
            updatedAt: '2026-10-29T00:00:00Z',
            transcript: window(1),
          }
        if (request.type === 'subagent.list') value = { entries: [], parentAvailable: true }
        if (request.type === 'session.transcript.navigate') {
          page++
          const start = 10_000 - page * 1000
          value = {
            ...window(request.payload.revision + 1),
            delivery: 'prepend',
            hasMore: page < 10,
            beforeSequence: start,
            nodes: Array.from({ length: 1000 }, (_, index) => ({
              ...reply,
              id: `old-${start + index}`,
              markdown: `History ${start + index}`,
            })),
          }
        }
        return Promise.resolve(value as T)
      },
      subscribe: (listener: (message: HostMessage) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      dispose: () => listeners.clear(),
    }
    const store = createAppStore(client as unknown as ProtocolClient)
    try {
      await store.openSession('session')
      for (let index = 0; index < 10; index++) await store.loadOlderHistory()
      expect(store.timeline.nodes).toHaveLength(10_001)
      expect(store.timeline.nodes[0]).toMatchObject({ markdown: 'History 0' })
      let notifications = 0
      store.subscribe(() => {
        notifications++
      })
      const revision = store.getState().transcript!.revision
      for (let index = 0; index < 100; index++) {
        const payload = {
          ...window(revision + index + 1),
          nodes: [{ ...reply, streaming: true, markdown: 'answer ' + 'x'.repeat(index + 1) }],
          hasMore: false,
          beforeSequence: 0,
        }
        for (const listener of listeners)
          listener({ type: 'event', name: 'session.transcript', sequence: index + 1, payload })
      }
      await vi.advanceTimersByTimeAsync(32)
      expect(store.timeline.nodes).toHaveLength(10_001)
      expect(store.timeline.nodes.at(-1)).toMatchObject({ markdown: 'answer ' + 'x'.repeat(100) })
      expect(store.getState().transcript!.nodes).toHaveLength(1)
      expect(notifications).toBeLessThanOrEqual(4)
    } finally {
      store.dispose()
      vi.useRealTimers()
    }
  },
)
