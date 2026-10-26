// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  HostMessage,
  TranscriptPatch,
  TranscriptWindow,
  WebviewRequest,
} from '@dsh-vscode/webview-protocol'
import type { ProtocolClient } from './protocol-client.js'
import { createAppStore } from './store.js'

function fixture(thinking = false): {
  store: ReturnType<typeof createAppStore>
  requests: WebviewRequest[]
  send: (patch: TranscriptPatch) => void
} {
  const transcript: TranscriptWindow = {
    sessionId: 's',
    revision: 1,
    lastSequence: 10,
    activeTurn: 1,
    hasMore: false,
    historical: false,
    omittedNodeIds: [],
    eventFacts: [],
    nodes: [
      {
        kind: 'assistant-message',
        id: 'reply',
        markdown: thinking ? '' : 'First',
        streaming: !thinking,
        ...(thinking ? { reasoning: { markdown: 'Think', streaming: true } } : {}),
      },
    ],
  }
  const requests: WebviewRequest[] = []
  const listeners = new Set<(message: HostMessage) => void>()
  const client = {
    request: <T>(request: WebviewRequest): Promise<T> => {
      requests.push(request)
      if (request.type === 'session.open')
        return Promise.resolve({
          id: 's',
          workspaceId: 'workspace',
          title: 'Fixture',
          blank: false,
          status: 'running',
          createdAt: '2026-10-24T00:00:00Z',
          updatedAt: '2026-10-24T00:00:00Z',
          history: [],
          transcript,
        } as T)
      if (request.type === 'subagent.list')
        return Promise.resolve({ entries: [], parentAvailable: true } as T)
      return Promise.resolve([] as T)
    },
    subscribe: (listener: (message: HostMessage) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose: () => listeners.clear(),
  }
  return {
    store: createAppStore(client as unknown as ProtocolClient),
    requests,
    send: (patch) => {
      for (const listener of listeners)
        listener({
          type: 'event',
          name: 'session.transcript.patch',
          sequence: patch.revision,
          payload: patch,
        })
    },
  }
}

function paintClock(): { paint: () => void; frames: Map<number, FrameRequestCallback> } {
  let id = 0
  const frames = new Map<number, FrameRequestCallback>()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame))
  return {
    frames,
    paint: () => {
      for (const [frame, callback] of [...frames]) {
        frames.delete(frame)
        callback(0)
      }
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('stream rendering backpressure', () => {
  it('flushes a replacement and the first visible token after whitespace immediately', async () => {
    vi.useFakeTimers()
    const clock = paintClock()
    const { store, send } = fixture()
    try {
      await store.openSession('s')
      const rendered: number[] = []
      store.subscribe(() => rendered.push(store.getState().transcript!.revision))
      send({
        sessionId: 's',
        revision: 2,
        baseRevision: 1,
        changedNodes: [{ kind: 'assistant-message', id: 'reply', markdown: ' ', streaming: true }],
      })
      send({
        sessionId: 's',
        revision: 3,
        baseRevision: 2,
        changedNodes: [],
        textUpdates: [
          {
            node: { kind: 'assistant-message', id: 'reply', markdown: 'Visible', streaming: true },
            markdownLength: 1,
          },
        ],
      })
      expect(rendered).toEqual([2, 3])
      expect(store.timeline.nodes[0]).toMatchObject({ markdown: ' Visible' })
      expect(clock.frames.size).toBe(0)
    } finally {
      store.dispose()
    }
  })

  it('installs and acknowledges every suffix, but paints only the newest state in a burst', async () => {
    vi.useFakeTimers()
    const clock = paintClock()
    const { store, send, requests } = fixture()
    try {
      await store.openSession('s')
      const rendered: number[] = []
      store.subscribe(() => rendered.push(store.getState().transcript!.revision))
      let markdown = 'First'
      for (let revision = 2; revision <= 101; revision++) {
        send({
          sessionId: 's',
          revision,
          baseRevision: revision - 1,
          changedNodes: [],
          textUpdates: [
            {
              node: { kind: 'assistant-message', id: 'reply', markdown: ' x', streaming: true },
              markdownLength: markdown.length,
            },
          ],
        })
        markdown += ' x'
        expect(store.timeline.nodes[0]).toMatchObject({ markdown })
      }
      expect(requests.filter((request) => request.type === 'session.transcript.ack')).toHaveLength(101)
      expect(rendered).toEqual([])
      expect(clock.frames.size).toBe(1)
      clock.paint()
      expect(rendered).toEqual([101])
      expect(clock.frames.size).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      store.dispose()
    }
  })

  it('flushes the first answer and completion immediately across a queued reasoning update', async () => {
    vi.useFakeTimers()
    const clock = paintClock()
    const { store, send } = fixture(true)
    try {
      await store.openSession('s')
      const rendered: number[] = []
      store.subscribe(() => rendered.push(store.getState().transcript!.revision))
      send({
        sessionId: 's',
        revision: 2,
        baseRevision: 1,
        changedNodes: [],
        textUpdates: [
          {
            node: {
              kind: 'assistant-message',
              id: 'reply',
              markdown: '',
              streaming: false,
              reasoning: { markdown: ' further', streaming: true },
            },
            markdownLength: 0,
            reasoningLength: 5,
          },
        ],
      })
      expect(rendered).toEqual([])
      send({
        sessionId: 's',
        revision: 3,
        baseRevision: 2,
        changedNodes: [],
        textUpdates: [
          {
            node: {
              kind: 'assistant-message',
              id: 'reply',
              markdown: 'Answer',
              streaming: true,
              reasoning: { markdown: '', streaming: false },
            },
            markdownLength: 0,
            reasoningLength: 13,
          },
        ],
      })
      expect(rendered).toEqual([3])
      expect(store.timeline.nodes[0]).toMatchObject({
        markdown: 'Answer',
        reasoning: { markdown: 'Think further' },
      })
      send({
        sessionId: 's',
        revision: 4,
        baseRevision: 3,
        lastSequence: 11,
        changedNodes: [
          {
            kind: 'assistant-message',
            id: 'reply',
            markdown: 'Answer complete',
            streaming: false,
          },
        ],
      })
      expect(rendered).toEqual([3, 4])
      expect(clock.frames.size).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      store.dispose()
    }
  })

  it('flushes controls immediately and cancels a pending paint when the store is disposed', async () => {
    vi.useFakeTimers()
    const clock = paintClock()
    const { store, send } = fixture()
    try {
      await store.openSession('s')
      const rendered = vi.fn()
      store.subscribe(rendered)
      send({
        sessionId: 's',
        revision: 2,
        baseRevision: 1,
        changedNodes: [
          {
            kind: 'assistant-message',
            id: 'reply',
            markdown: 'First next',
            streaming: true,
          },
        ],
      })
      expect(rendered).not.toHaveBeenCalled()
      store.setDrawer('settings')
      expect(rendered).toHaveBeenCalledTimes(1)
      expect(clock.frames.size).toBe(0)
      send({
        sessionId: 's',
        revision: 3,
        baseRevision: 2,
        changedNodes: [
          {
            kind: 'assistant-message',
            id: 'reply',
            markdown: 'First next tail',
            streaming: true,
          },
        ],
      })
      expect(clock.frames.size).toBe(1)
      store.dispose()
      expect(clock.frames.size).toBe(0)
      await vi.advanceTimersByTimeAsync(1000)
      expect(rendered).toHaveBeenCalledTimes(1)
    } finally {
      store.dispose()
    }
  })

  it('notifies the latest state when animation frames are throttled', async () => {
    vi.useFakeTimers()
    const clock = paintClock()
    const { store, send } = fixture()
    try {
      await store.openSession('s')
      const rendered = vi.fn()
      store.subscribe(rendered)
      send({
        sessionId: 's',
        revision: 2,
        baseRevision: 1,
        changedNodes: [
          {
            kind: 'assistant-message',
            id: 'reply',
            markdown: 'First tail',
            streaming: true,
          },
        ],
      })
      await vi.advanceTimersByTimeAsync(100)
      expect(rendered).toHaveBeenCalledTimes(1)
      expect(store.timeline.nodes[0]).toMatchObject({ markdown: 'First tail' })
      expect(clock.frames.size).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      store.dispose()
    }
  })
})
