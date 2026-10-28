import { afterEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import type { BackendEvent, SessionHistoryEvent, SessionHistoryPage } from '@dsh-vscode/domain'
import {
  TRANSCRIPT_MAX_CHARS,
  TRANSCRIPT_MAX_NODES,
  transcriptWindowSchema,
  type TranscriptWindow,
  type TranscriptPatch,
} from '@dsh-vscode/webview-protocol'
import { isTranscriptOnlyEvent, TranscriptWindowService } from './transcript-window.js'
import { sanitizePublicValue } from './public-value.js'

const sessionId = 'session-fixture'
const row = (sequence: number, event: BackendEvent): SessionHistoryEvent => ({
  sequence,
  time: '2026-10-14T00:00:00.000Z',
  event,
})
const message = (sequence: number, text = `Answer ${sequence}`): SessionHistoryEvent =>
  row(sequence, {
    type: 'message.completed',
    sessionId,
    messageId: `m-${sequence}`,
    markdown: text,
    sequence,
  })
function fixture(
  read = vi
    .fn<
      (
        sessionId: string,
        before: number | undefined,
        signal: AbortSignal,
        child: boolean,
      ) => Promise<SessionHistoryPage>
    >()
    .mockResolvedValue({ events: [], hasMore: false }),
): {
  service: TranscriptWindowService
  posted: TranscriptWindow[]
  read: typeof read
  open: (events?: readonly SessionHistoryEvent[]) => TranscriptWindow
} {
  const posted: TranscriptWindow[] = []
  const service = new TranscriptWindowService({
    read,
    publicValue: (value) => sanitizePublicValue(value),
    post: (value) => {
      posted.push(value)
      return Promise.resolve(true)
    },
  })
  const open = (events: readonly SessionHistoryEvent[] = []): TranscriptWindow =>
    service.installPage(sessionId, { events, hasMore: true, beforeSequence: 1 }, service.begin(sessionId))
  return { service, posted, read, open }
}
afterEach(() => vi.useRealTimers())

describe('Host transcript windows', () => {
  it('carries the authoritative turn clock in the parsed initial window', () => {
    const { open } = fixture()
    const window = transcriptWindowSchema.parse(
      open([row(1, { type: 'turn.started', sessionId, turn: 1, time: 1234 })]),
    )
    expect(window.activeTurnStartedAt).toBe(1234)
  })
  for (const finalBody of [true, false])
    it(`keeps long replies and reasoning intact through completion (final body: ${finalBody}) and history reopen`, async () => {
      vi.useFakeTimers()
      const client = fixture()
      // Cover both the former settled 4K cutoff and streaming 24K cutoff.
      const markdown =
        'Long answer paragraph with a newline.\n'.repeat(finalBody ? 300 : 3000) + 'final-answer-tail'
      const reasoning = 'Reasoning paragraph.\n'.repeat(finalBody ? 400 : 2000) + 'final-reasoning-tail'
      const completed: BackendEvent = {
        type: 'message.completed',
        sessionId,
        messageId: 'answer',
        turn: 1,
        step: 1,
        sequence: 2,
        ...(finalBody ? { markdown, reasoning } : {}),
      }
      const ended = { type: 'turn.ended', sessionId, turn: 1, reason: 'completed', sequence: 3 } as const
      client.open()
      client.service.accept({ type: 'turn.started', sessionId, turn: 1, sequence: 1 })
      client.service.accept({
        type: 'reasoning.delta',
        sessionId,
        messageId: 'answer',
        delta: reasoning,
        turn: 1,
        step: 1,
      })
      client.service.accept({
        type: 'message.delta',
        sessionId,
        messageId: 'answer',
        delta: markdown,
        turn: 1,
        step: 1,
      })
      await vi.advanceTimersByTimeAsync(0)
      client.service.acknowledge(sessionId, client.posted.at(-1)!.revision)
      await vi.advanceTimersByTimeAsync(0)
      const streaming = client.posted.at(-1)!
      expect(streaming.nodes.at(-1)).toMatchObject({
        kind: 'assistant-message',
        markdown,
        streaming: true,
        reasoning: { markdown: reasoning },
      })
      expect(streaming.omittedNodeIds).toEqual([])
      client.service.accept(completed)
      client.service.accept(ended)
      client.service.acknowledge(sessionId, client.posted.at(-1)!.revision)
      await vi.advanceTimersByTimeAsync(0)
      const settled = client.posted.at(-1)!
      expect(settled.nodes.at(-1)).toMatchObject({
        kind: 'assistant-message',
        markdown,
        streaming: false,
        turnCompleted: true,
        reasoning: { markdown: reasoning, streaming: false },
      })
      expect(settled.omittedNodeIds).toEqual([])
      const restored = client.open([row(2, { ...completed, markdown, reasoning }), row(3, ended)])
      expect(restored.nodes.at(-1)).toMatchObject({
        markdown,
        streaming: false,
        reasoning: { markdown: reasoning, streaming: false },
      })
      expect(restored.omittedNodeIds).toEqual([])
      client.service.dispose()
    })

  it('preserves long user messages and settled answers without applying tool preview limits', () => {
    const client = fixture()
    const prompt = 'User paragraph.\n'.repeat(1000) + 'prompt-tail'
    const answer = 'Answer paragraph.\n'.repeat(6000) + 'answer-tail'
    const window = client.open([
      row(1, { type: 'message.user', sessionId, messageId: 'prompt', markdown: prompt }),
      message(2, answer),
    ])
    expect(window.nodes).toMatchObject([{ markdown: prompt }, { markdown: answer }])
    expect(window.omittedNodeIds).toEqual([])
    client.service.dispose()
  })

  it('bounds sent context previews and restores the complete captured attachment through full content', async () => {
    const text = 'const value = 1\n'.repeat(400) + 'captured-tail'
    const sourceLink = `src/${'%E4%BD%A0'.repeat(600)}.ts#L1C1-L401C1`
    const events = [
      row(1, {
        type: 'message.user',
        sessionId,
        messageId: 'with-context',
        markdown: 'Review this selection',
        attachments: [{ name: 'index.ts:1-401', previewText: text, sourceLink }],
      }),
    ]
    const client = fixture(vi.fn().mockResolvedValue({ events, hasMore: false }))
    const window = client.open(events)
    const node = window.nodes[0]!
    expect(node).toMatchObject({
      attachments: [{ previewText: text.slice(0, 4096), previewTruncated: true, sourceLink }],
    })
    expect(transcriptWindowSchema.safeParse(window).success).toBe(true)
    expect(window.omittedNodeIds).toContain(node.id)
    const full = await client.service.content(
      sessionId,
      node.id,
      window.revision,
      new AbortController().signal,
    )
    expect(full).toContain(text)
    expect(full).toContain('index.ts:1-401')
    client.service.dispose()
  })

  it('bounds escaped oversized prose with an explicit ellipsis and rereads its authorized full text', async () => {
    const markdown = 'Quote " and backslash \\\n'.repeat(30_000) + 'oversized-answer-tail'
    const events = [message(1, markdown)]
    const client = fixture(vi.fn().mockResolvedValue({ events, hasMore: false }))
    const window = client.open(events)
    const node = window.nodes[0]!
    expect(node.kind).toBe('assistant-message')
    if (node.kind !== 'assistant-message') throw new Error('Lost conversation node')
    expect(node.markdown.startsWith('Quote " and backslash')).toBe(true)
    expect(node.markdown.endsWith('…')).toBe(true)
    expect(node.markdown.length).toBeGreaterThan(4096)
    expect(JSON.stringify(node).length).toBeLessThanOrEqual(256 * 1024)
    expect(JSON.stringify(window).length).toBeLessThanOrEqual(TRANSCRIPT_MAX_CHARS)
    expect(window.omittedNodeIds).toEqual([node.id])
    expect(
      await client.service.content(sessionId, node.id, window.revision, new AbortController().signal),
    ).toBe(markdown)
    client.service.dispose()
  })

  it('retains omission evidence when a bounded live reply settles without a replacement body', async () => {
    const client = fixture()
    const initial = client.open()
    client.service.accept({
      type: 'message.delta',
      sessionId,
      messageId: 'large',
      delta: 'Large live paragraph.\n'.repeat(20_000),
      turn: 1,
      step: 1,
    })
    client.service.accept({
      type: 'message.completed',
      sessionId,
      messageId: 'large',
      sequence: 1,
      turn: 1,
      step: 1,
    })
    const settled = await client.service.navigate(
      sessionId,
      'latest',
      initial.revision,
      new AbortController().signal,
    )
    expect(settled.nodes.at(-1)).toMatchObject({ kind: 'assistant-message', streaming: false })
    expect(settled.omittedNodeIds).toEqual(['large'])
    expect(JSON.stringify(settled).length).toBeLessThanOrEqual(TRANSCRIPT_MAX_CHARS)
    client.service.dispose()
  })

  it('keeps compacted history stable when follow replays native rows below the read cut', async () => {
    const invalidated = vi.fn()
    const posted: TranscriptWindow[] = []
    const service = new TranscriptWindowService({
      read: () => Promise.resolve({ events: [], hasMore: false }),
      publicValue: (value) => value,
      post: (value) => {
        posted.push(value)
        return Promise.resolve(true)
      },
      invalidate: invalidated,
    })
    const first = service.installPage(
      sessionId,
      {
        events: [message(10, 'Compacted answer')],
        hasMore: false,
        projection: { asOfSequence: 12, values: {} },
      },
      service.begin(sessionId),
    )
    const replay = [
      { type: 'turn.started', sessionId, turn: 1, sequence: 2, replayed: true },
      {
        type: 'message.delta',
        sessionId,
        messageId: 'm-10',
        delta: 'Original chunk',
        sequence: 4,
        replayed: true,
      },
      { type: 'turn.ended', sessionId, turn: 1, reason: 'completed', sequence: 12, replayed: true },
    ] as const
    for (const event of replay) {
      service.accept(event)
      expect(isTranscriptOnlyEvent(event)).toBe(true)
    }
    await Promise.resolve()
    expect(invalidated).not.toHaveBeenCalled()
    expect(posted).toHaveLength(0)
    service.accept({
      type: 'message.delta',
      sessionId,
      messageId: 'live',
      delta: 'Next answer',
      sequence: 13,
    })
    await Promise.resolve()
    expect(posted.at(-1)?.nodes[0]).toEqual(first.nodes[0])
    expect(posted.at(-1)?.nodes.at(-1)).toMatchObject({ markdown: 'Next answer' })
    expect(
      isTranscriptOnlyEvent({ type: 'turn.ended', sessionId, turn: 2, reason: 'completed', sequence: 14 }),
    ).toBe(false)
    service.dispose()
  })

  it('sends sanitized text suffixes and publishes terminal metadata without resending history facts per token', async () => {
    vi.useFakeTimers()
    const sent: (TranscriptWindow | TranscriptPatch)[] = []
    const publicValue = vi.fn(
      (value: unknown) =>
        JSON.parse(JSON.stringify(value).replaceAll('fixture-secret', '[redacted]')) as unknown,
    )
    const service = new TranscriptWindowService({
      read: () => Promise.resolve({ events: [], hasMore: false }),
      publicValue,
      post: (value) => {
        sent.push(value)
        return Promise.resolve(true)
      },
      postPatch: (value) => {
        sent.push(value)
        return Promise.resolve(true)
      },
    })
    service.installPage(sessionId, { events: [message(0)], hasMore: false }, service.begin(sessionId))
    service.accept({ type: 'turn.started', sessionId, turn: 1, sequence: 1, time: 1234 })
    await vi.advanceTimersByTimeAsync(0)
    const startWindow = sent.at(-1)!
    expect(
      'baseRevision' in startWindow
        ? startWindow.metadata?.activeTurnStartedAt
        : startWindow.activeTurnStartedAt,
    ).toBe(1234)
    service.accept({
      type: 'message.delta',
      sessionId,
      messageId: 'live',
      delta: 'prefix '.repeat(400),
      turn: 1,
      step: 1,
    })
    await Promise.resolve()
    publicValue.mockClear()
    service.accept({
      type: 'message.delta',
      sessionId,
      messageId: 'live',
      delta: 'fixture-secret suffix',
      turn: 1,
      step: 1,
    })
    await vi.advanceTimersByTimeAsync(16)
    const patch = sent.at(-1) as TranscriptPatch
    expect(patch.textUpdates?.[0]).toMatchObject({
      markdownLength: 2800,
      node: { markdown: '[redacted] suffix' },
    })
    expect(patch).not.toHaveProperty('metadata')
    expect(publicValue.mock.calls[0]?.[0]).not.toHaveProperty('eventFacts')
    expect(JSON.stringify(patch)).not.toContain('fixture-secret')
    service.accept({ type: 'turn.ended', sessionId, turn: 1, reason: 'completed', sequence: 2 })
    await Promise.resolve()
    const terminal = sent.at(-1) as TranscriptPatch
    expect(terminal.metadata).toHaveProperty('lastSequence', 2)
    expect(terminal.metadata).not.toHaveProperty('activeTurn')
    expect(terminal.metadata).not.toHaveProperty('activeTurnStartedAt')
    service.dispose()
  })
  it('keeps first text immediate and enforces all 64 credits across streaming paints', async () => {
    vi.useFakeTimers()
    const sent: (TranscriptWindow | TranscriptPatch)[] = []
    const service = new TranscriptWindowService({
      read: () => Promise.resolve({ events: [], hasMore: false }),
      publicValue: (value) => value,
      post: (value) => {
        sent.push(value)
        return Promise.resolve(true)
      },
      postPatch: (value) => {
        sent.push(value)
        return Promise.resolve(true)
      },
    })
    service.installPage(sessionId, { events: [message(1)], hasMore: false }, service.begin(sessionId))
    for (let index = 0; index < 68; index++) {
      service.accept({
        type: 'message.delta',
        sessionId,
        messageId: 'live',
        delta: String(index) + ',',
        turn: 1,
        step: 1,
      })
      if (index === 0) expect(sent).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(16)
      expect(sent).toHaveLength(Math.min(index + 1, 64))
    }
    expect(sent).toHaveLength(64)
    expect('changedNodes' in sent[1]!).toBe(true)
    service.acknowledge('wrong-session', sent[63]!.revision)
    await vi.advanceTimersByTimeAsync(100)
    expect(sent).toHaveLength(64)
    service.acknowledge(sessionId, sent[63]!.revision)
    expect(sent).toHaveLength(65)
    const latest = sent[64]!
    expect('changedNodes' in latest && latest.changedNodes.at(-1)).toMatchObject({
      markdown: Array.from({ length: 68 }, (_, i) => `${i},`).join(''),
    })
    service.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('coalesces token bursts before IPC even with immediate ACKs, and flushes phase boundaries', async () => {
    vi.useFakeTimers()
    const sent: (TranscriptWindow | TranscriptPatch)[] = []
    const post = (value: TranscriptWindow | TranscriptPatch): Promise<boolean> => {
      sent.push(value)
      service.acknowledge(sessionId, value.revision)
      return Promise.resolve(true)
    }
    const service = new TranscriptWindowService({
      read: () => Promise.resolve({ events: [], hasMore: false }),
      publicValue: (value) => value,
      post,
      postPatch: post,
    })
    service.installPage(sessionId, { events: [message(0)], hasMore: false }, service.begin(sessionId))
    const delta = (text: string): void => {
      service.accept({ type: 'message.delta', sessionId, messageId: 'live', turn: 1, step: 1, delta: text })
    }
    delta('first'.repeat(100))
    expect(sent).toHaveLength(1)
    await Promise.resolve()
    for (let i = 0; i < 200; i++) {
      delta('x')
      await Promise.resolve()
    }
    expect(sent).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(16)
    expect(sent).toHaveLength(2)
    const burst = sent[1] as TranscriptPatch
    expect(burst.textUpdates?.[0]?.node.markdown).toBe('x'.repeat(200))
    delta('final')
    service.accept({ type: 'turn.ended', sessionId, turn: 1, reason: 'completed', sequence: 1 })
    expect(sent).toHaveLength(3)
    expect((sent[2] as TranscriptPatch).metadata).not.toHaveProperty('activeTurn')
    expect(JSON.stringify(sent[2])).toContain('final')
    service.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('flushes the first body immediately after reasoning and cancels a pending text paint on disposal', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.open([message(0)])
    f.service.accept({
      type: 'reasoning.delta',
      sessionId,
      messageId: 'live',
      turn: 1,
      step: 1,
      delta: 'think',
    })
    expect(f.posted).toHaveLength(1)
    await Promise.resolve()
    f.service.acknowledge(sessionId, f.posted[0]!.revision)
    f.service.accept({
      type: 'reasoning.delta',
      sessionId,
      messageId: 'live',
      turn: 1,
      step: 1,
      delta: ' more',
    })
    expect(f.posted).toHaveLength(1)
    f.service.accept({ type: 'message.delta', sessionId, messageId: 'live', turn: 1, step: 1, delta: 'body' })
    expect(f.posted).toHaveLength(2)
    expect(f.posted[1]!.nodes.at(-1)).toMatchObject({
      markdown: 'body',
      reasoning: { markdown: 'think more' },
    })
    await Promise.resolve()
    f.service.acknowledge(sessionId, f.posted[1]!.revision)
    f.service.accept({
      type: 'message.delta',
      sessionId,
      messageId: 'live',
      turn: 1,
      step: 1,
      delta: ' queued',
    })
    expect(vi.getTimerCount()).toBe(1)
    f.service.dispose()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(32)
    expect(f.posted).toHaveLength(2)
  })

  it('rate limits numeric delivery timings and contains observer failures', async () => {
    vi.useFakeTimers()
    const observeTiming = vi.fn<(phase: string, durationMs: number, revision: number) => void>(() => {
      throw new Error('fixture observer failed')
    })
    const sent: TranscriptWindow[] = []
    const service = new TranscriptWindowService({
      read: () => Promise.resolve({ events: [], hasMore: false }),
      publicValue: (value) => value,
      post: (value) => {
        sent.push(value)
        return Promise.resolve(true)
      },
      observeTiming,
    })
    service.installPage(sessionId, { events: [], hasMore: false }, service.begin(sessionId))
    for (let i = 0; i < 4; i++) {
      service.accept({
        type: 'message.delta',
        sessionId,
        messageId: 'live',
        delta: 'private fixture text',
        time: Date.now() - 25,
      })
      await vi.advanceTimersByTimeAsync(16)
      service.acknowledge(sessionId, sent.at(-1)!.revision)
    }
    expect(sent.length).toBeGreaterThan(1)
    const phases = observeTiming.mock.calls.map((call) => call[0])
    expect(phases.filter((phase) => phase === 'stream-ingress')).toHaveLength(1)
    expect(phases.filter((phase) => phase === 'stream-post')).toHaveLength(1)
    expect(phases.filter((phase) => phase === 'stream-ack')).toHaveLength(1)
    expect(JSON.stringify(observeTiming.mock.calls)).not.toContain('private fixture text')
    service.dispose()
  })

  it('bounds outstanding streaming bytes as well as frame count', async () => {
    vi.useFakeTimers()
    const sent: (TranscriptWindow | TranscriptPatch)[] = []
    const service = new TranscriptWindowService({
      read: () => Promise.resolve({ events: [], hasMore: false }),
      publicValue: (value) => value,
      post: (value) => {
        sent.push(value)
        return Promise.resolve(true)
      },
      postPatch: (value) => {
        sent.push(value)
        return Promise.resolve(true)
      },
    })
    service.installPage(
      sessionId,
      { events: Array.from({ length: 80 }, (_, i) => message(i, 'x'.repeat(4000))), hasMore: false },
      service.begin(sessionId),
    )
    for (let index = 0; index < 12; index++) {
      service.accept({
        type: 'message.delta',
        sessionId,
        messageId: 'live',
        delta: 'word '.repeat(5000) + String(index),
        turn: 1,
        step: 1,
      })
      await vi.advanceTimersByTimeAsync(16)
    }
    expect(sent.length).toBeGreaterThan(1)
    expect(sent.length).toBeLessThan(8)
    expect(sent.reduce((total, value) => total + JSON.stringify(value).length, 0)).toBeLessThanOrEqual(
      TRANSCRIPT_MAX_CHARS,
    )
    service.acknowledge(sessionId, sent.at(-1)!.revision)
    await vi.advanceTimersByTimeAsync(16)
    const latest = sent.at(-1)!
    // A growing answer can evict an older row and require a full window.
    const node = 'changedNodes' in latest ? latest.changedNodes.at(-1) : latest.nodes.at(-1)
    expect(node?.kind === 'assistant-message' && node.markdown.endsWith('11')).toBe(true)
    service.dispose()
  })

  it('keeps a streamed patch proportional to the changed node, not to the window', async () => {
    vi.useFakeTimers()
    const sent: (TranscriptWindow | TranscriptPatch)[] = []
    const service = new TranscriptWindowService({
      read: () => Promise.resolve({ events: [], hasMore: false }),
      publicValue: (value) => value,
      post: (value) => {
        sent.push(value)
        return Promise.resolve(true)
      },
      postPatch: (value) => {
        sent.push(value)
        return Promise.resolve(true)
      },
    })
    service.installPage(
      sessionId,
      { events: Array.from({ length: 800 }, (_, i) => message(i, `Answer ${String(i)} `)), hasMore: false },
      service.begin(sessionId),
    )
    sent.length = 0
    for (let index = 0; index < 5; index++) {
      service.accept({
        type: 'message.delta',
        sessionId,
        messageId: 'assistant:9:1',
        delta: 'token ',
        turn: 9,
        step: 1,
        transientSequence: index + 1,
        transientAttemptId: 'a1',
        transientIndex: index,
      })
      await vi.advanceTimersByTimeAsync(16)
    }
    const patches = sent.filter((value): value is TranscriptPatch => 'changedNodes' in value)
    expect(patches.length).toBeGreaterThan(0)
    for (const patch of patches) {
      // The node-id list and event facts stay in the renderer: re-sending them
      // per token made a revision cost O(window) bytes and visibly stuttered.
      expect(patch.changedNodes).toHaveLength(1)
      expect(JSON.stringify(patch).length).toBeLessThan(2_048)
    }
    service.dispose()
  })

  it('keeps legacy current Todos independent of historical pages and stops deriving them once DSH provides the projection', async () => {
    const current = [{ id: 'current', content: 'Current task', status: 'in-progress' as const }]
    const old = [{ id: 'old', content: 'Old task', status: 'completed' as const }]
    const f = fixture()
    f.read.mockResolvedValue({
      events: [row(1, { type: 'todo.updated', sessionId, todos: old, sequence: 1 })],
      hasMore: false,
    })
    const view = f.service.installPage(
      sessionId,
      {
        events: [row(10, { type: 'todo.updated', sessionId, todos: current, sequence: 10 })],
        hasMore: true,
        beforeSequence: 10,
      },
      f.service.begin(sessionId),
    )
    expect(view.currentTodos).toEqual(current)
    const historical = await f.service.navigate(
      sessionId,
      'older',
      view.revision,
      new AbortController().signal,
    )
    expect(historical.nodes).toContainEqual(expect.objectContaining({ kind: 'todo', todos: current }))
    expect(historical.currentTodos).toEqual(current)
    f.service.accept({ type: 'session.projection', sessionId, key: 'todoList', value: null, sequence: 20 })
    expect(f.service.accept({ type: 'todo.updated', sessionId, todos: current, sequence: 21 })).toBe(true)
    const latest = await f.service.navigate(
      sessionId,
      'latest',
      historical.revision,
      new AbortController().signal,
    )
    expect(latest).not.toHaveProperty('currentTodos')
    f.service.dispose()
  })

  it('retains gap notices without a second backfill engine and retires them only on authoritative coverage', () => {
    const f = fixture()
    f.open([message(1)])
    f.service.accept({ type: 'session.gap', sessionId, fromSequence: 3, toSequence: 5 })
    expect(f.read).not.toHaveBeenCalled()
    const reopen = (covered = false): TranscriptWindow =>
      f.service.installPage(
        sessionId,
        {
          events: [message(10)],
          hasMore: false,
          ...(covered ? { coveredSequenceRanges: [{ from: 1, to: 10 }] } : {}),
        },
        f.service.begin(sessionId),
      )
    expect(reopen().nodes).toContainEqual(expect.objectContaining({ id: `gap:${sessionId}:3:5` }))
    expect(reopen(true).nodes.some((node) => node.id.startsWith('gap:'))).toBe(false)
    expect(reopen().nodes.some((node) => node.id.startsWith('gap:'))).toBe(false)
    f.service.dispose()
  })
  it('keeps a bounded parent closure for a long PTC turn without using its context row as the older-page cursor', () => {
    const client = fixture()
    const parent: BackendEvent = {
      type: 'tool.updated',
      sessionId,
      sequence: 1,
      tool: {
        id: 'parent',
        name: 'code',
        category: 'execute',
        title: 'Execute code',
        status: 'running',
        inputSummary: 'Structured call',
        metadata: {},
      },
    }
    const children = Array.from({ length: 1000 }, (_, index) =>
      row(index + 2, {
        type: 'tool.updated',
        sessionId,
        sequence: index + 2,
        tool: {
          id: `child-${index}`,
          parentCallId: 'parent',
          name: 'read',
          category: 'read',
          title: 'Read',
          status: 'completed',
          outputSummary: 'Result',
          metadata: {},
        },
      }),
    )
    const window = client.open([row(1, parent), ...children])
    expect(window.nodes.length).toBeLessThanOrEqual(256)
    expect(window.nodes.some((node) => node.kind === 'tool' && node.id === 'parent')).toBe(true)
    expect(window.beforeSequence).toBeGreaterThan(1)
    client.service.dispose()
  })
  it('uses authoritative workingDirectory to qualify relative file models inside the authorized roots', () => {
    const root = path.resolve('synthetic-transcript-root')
    const service = new TranscriptWindowService({
      read: () => Promise.resolve({ events: [], hasMore: false }),
      post: () => Promise.resolve(true),
      publicValue: (value, cwd) => sanitizePublicValue(value, undefined, [root], cwd),
    })
    const event: BackendEvent = {
      type: 'deliverables.presented',
      sessionId,
      sequence: 1,
      turn: 1,
      callId: 'present',
      files: [{ path: 'result.txt' }],
    }
    const window = service.installPage(
      sessionId,
      {
        events: [row(1, event)],
        hasMore: false,
        projection: { asOfSequence: 1, values: { workingDirectory: path.join(root, 'child') } },
      },
      service.begin(sessionId),
    )
    expect(window.nodes[0]).toMatchObject({ kind: 'deliverables', files: [{ path: 'child/result.txt' }] })
    expect(JSON.stringify(window)).not.toContain(root)
    service.dispose()
  })
  it('keeps distinct Host notices across session switches and restores their anchors', async () => {
    const client = fixture()
    client.open([message(1)])
    client.service.accept({ type: 'notice', sessionId, level: 'info', text: 'First notice' })
    client.service.accept({ type: 'notice', sessionId, level: 'warning', text: 'Second notice' })
    const other = client.service.begin('other')
    client.service.installPage('other', { events: [], hasMore: false }, other)
    const restored = client.open([message(1), message(2)])
    const notices = restored.nodes.filter((node) => node.kind === 'notice')
    expect(notices).toHaveLength(2)
    expect(new Set(notices.map((node) => node.id)).size).toBe(2)
    expect(restored.nodes.map((node) => node.id)).toEqual(['m-1', ...notices.map((node) => node.id), 'm-2'])
    expect(
      await client.service.content(
        sessionId,
        notices[0]!.id,
        restored.revision,
        new AbortController().signal,
      ),
    ).toBe('First notice')
    client.service.dispose()
  })
  it('retires prefixes already settled by the opening cut and preserves a newer retry attempt', () => {
    const client = fixture()
    const generation = client.service.begin(sessionId)
    client.service.accept({
      type: 'message.delta',
      sessionId,
      messageId: 'transient',
      delta: 'old prefix',
      turn: 1,
      step: 1,
      transientAttemptId: 'old',
      transientIndex: 0,
      transientStartedAfterSequence: 9,
    })
    const final = row(11, {
      type: 'message.completed',
      sessionId,
      messageId: 'durable',
      markdown: 'Complete response',
      turn: 1,
      step: 1,
      sequence: 11,
    })
    const window = client.service.installPage(sessionId, { events: [final], hasMore: false }, generation)
    expect(window.nodes).toHaveLength(1)
    expect(window.nodes[0]).toMatchObject({ id: 'durable', markdown: 'Complete response', streaming: false })
    const retry = client.service.begin(sessionId)
    client.service.accept({
      type: 'message.delta',
      sessionId,
      messageId: 'retry',
      delta: 'new attempt',
      turn: 1,
      step: 1,
      transientAttemptId: 'new',
      transientIndex: 0,
      transientStartedAfterSequence: 11,
    })
    const next = client.service.installPage(sessionId, { events: [final], hasMore: false }, retry)
    expect(next.nodes).toContainEqual(expect.objectContaining({ markdown: 'Complete response' }))
    expect(next.nodes).toContainEqual(expect.objectContaining({ markdown: 'new attempt', streaming: true }))
    client.service.dispose()
  })
  it('keeps terminal render intent after removing host-only cwd and degrades an out-of-scope read card alone', () => {
    const client = fixture()
    const terminal: BackendEvent = {
      type: 'tool.updated',
      sessionId,
      sequence: 1,
      tool: {
        id: 'shell',
        name: 'bash',
        category: 'execute',
        title: 'Run',
        status: 'running',
        metadata: {},
        presentation: { phase: 'call', card: 'terminal', title: 'Run', cwd: 'C:\\fixture\\private' },
      },
    }
    const outside: BackendEvent = {
      type: 'tool.updated',
      sessionId,
      sequence: 2,
      tool: {
        id: 'outside',
        name: 'read',
        category: 'read',
        title: 'Read',
        status: 'completed',
        metadata: {},
        presentation: {
          phase: 'result',
          card: 'read',
          path: 'C:\\other\\private.txt',
          offset: 0,
          lines: [{ number: 1, text: 'Visible result' }],
          totalLines: 1,
        },
      },
    }
    const window = client.open([row(1, terminal), row(2, outside)])
    expect(window.nodes[0]).toMatchObject({ kind: 'tool', tool: { presentation: { card: 'terminal' } } })
    expect(JSON.stringify(window)).not.toContain('private')
    expect(window.nodes[1]).toMatchObject({ kind: 'tool', tool: { status: 'completed' } })
    expect(window.omittedNodeIds).toEqual([])
    client.service.dispose()
  })

  it('invalidates a published view once after Adapter recovery instead of maintaining a second gap-healing journal', () => {
    const invalidations: string[] = []
    const service = new TranscriptWindowService({
      read: () => Promise.resolve({ events: [], hasMore: false }),
      publicValue: (value) => value,
      post: () => Promise.resolve(true),
      invalidate: (id) => {
        invalidations.push(id)
      },
    })
    service.installPage(
      sessionId,
      { events: [message(1), message(10)], hasMore: true, beforeSequence: 1 },
      service.begin(sessionId),
    )
    service.accept(message(1).event)
    expect(invalidations).toEqual([])
    service.accept(message(5, 'Recovered').event)
    service.accept(message(6, 'Recovered again').event)
    expect(invalidations).toEqual([sessionId])
    const refreshed = service.installPage(
      sessionId,
      {
        events: [message(1), message(5, 'Recovered'), message(6, 'Recovered again'), message(10)],
        hasMore: false,
      },
      service.begin(sessionId),
    )
    expect(refreshed.nodes).toHaveLength(4)
    expect(refreshed.nodes[1]).toMatchObject({ markdown: 'Recovered' })
    service.dispose()
  })
  for (const count of [TRANSCRIPT_MAX_NODES + 1, 10_000])
    it(
      `bounds ${count} loaded nodes without exposing reducer bookkeeping`,
      { tags: count > TRANSCRIPT_MAX_NODES + 1 ? ['stress'] : [], timeout: 15_000 },
      () => {
        const client = fixture()
        const events = Array.from({ length: count }, (_, index) => message(index + 1))
        const window = client.open(events)
        expect(window.nodes.length).toBeLessThanOrEqual(TRANSCRIPT_MAX_NODES)
        expect(JSON.stringify(window).length).toBeLessThanOrEqual(TRANSCRIPT_MAX_CHARS)
        expect(window.nodes.at(-1)).toMatchObject({ markdown: `Answer ${count}` })
        expect(window).not.toHaveProperty('closedTurns')
        expect(window).not.toHaveProperty('history')
        expect(window.hasMore).toBe(true)
        expect(window.beforeSequence).toBeGreaterThan(1)
        client.service.dispose()
      },
    )

  for (const repeats of [1_200, 100_000])
    it(
      `previews oversized tool results (${repeats} repeats) and rereads authorized content`,
      { tags: repeats > 1_200 ? ['stress'] : [] },
      async () => {
        const text = 'Result content '.repeat(repeats)
        const event: BackendEvent = {
          type: 'tool.updated',
          sessionId,
          sequence: 9,
          tool: {
            id: 'call',
            name: 'read',
            category: 'read',
            title: 'Read',
            status: 'completed',
            outputSummary: text,
            metadata: { apiKey: 'fixture-secret' },
          },
        }
        const client = fixture(vi.fn().mockResolvedValue({ events: [row(9, event)], hasMore: false }))
        const window = client.open([row(9, event)])
        expect(window.omittedNodeIds).toEqual(['call'])
        expect(JSON.stringify(window)).not.toContain('fixture-secret')
        expect(JSON.stringify(window).length).toBeLessThan(20_000)
        const full = await client.service.content(
          sessionId,
          'call',
          window.revision,
          new AbortController().signal,
        )
        expect(full).toContain(text)
        expect(full).not.toContain('fixture-secret')
        expect(client.read).toHaveBeenCalledWith(sessionId, 10, expect.any(AbortSignal), false)
        client.service.dispose()
      },
    )

  it('keeps distinct same-sequence mappings and ignores exact baseline replays', async () => {
    vi.useFakeTimers()
    const client = fixture()
    const first = message(2, 'First')
    client.open([first])
    client.service.accept(first.event)
    client.service.accept({
      type: 'message.completed',
      sessionId,
      sequence: 2,
      messageId: 'other',
      markdown: 'Second',
    })
    await vi.advanceTimersByTimeAsync(32)
    expect(client.posted[0]?.nodes).toHaveLength(2)
    expect(client.posted[0]?.nodes.map((node) => node.id)).toEqual(['m-2', 'other'])
    client.service.dispose()
  })

  it('prepends older history without replacing recent messages and keeps the expanded view live', async () => {
    const older = [
      ...Array.from({ length: 100 }, (_, index) => message(index + 1)),
      message(200, 'Outdated overlap'),
    ]
    const client = fixture(vi.fn().mockResolvedValue({ events: older, hasMore: false, beforeSequence: 0 }))
    const initial = client.open([message(200)])
    const historical = await client.service.navigate(
      sessionId,
      'older',
      initial.revision,
      new AbortController().signal,
    )
    expect(historical.historical).toBe(false)
    expect(historical.nodes).toContainEqual(expect.objectContaining({ id: 'm-200' }))
    expect(historical.nodes).toHaveLength(101)
    expect(historical.nodes.at(-1)).toMatchObject({ id: 'm-200', markdown: 'Answer 200' })
    client.service.accept(message(201, 'Live final reply').event)
    const latest = await client.service.navigate(
      sessionId,
      'latest',
      historical.revision,
      new AbortController().signal,
    )
    expect(latest.historical).toBe(false)
    expect(latest.nodes.at(-1)).toMatchObject({ markdown: 'Live final reply', streaming: false })
    expect(latest.nodes[0]?.id).toBe('m-1')
    client.service.dispose()
  })

  it('sends one unacknowledged window and pauses while hidden, then publishes the latest snapshot', async () => {
    vi.useFakeTimers()
    const client = fixture()
    client.open()
    client.service.accept(message(1).event)
    await vi.advanceTimersByTimeAsync(32)
    expect(client.posted).toHaveLength(1)
    for (let seq = 2; seq <= 1000; seq++) client.service.accept(message(seq).event)
    await vi.advanceTimersByTimeAsync(1000)
    expect(client.posted).toHaveLength(1)
    client.service.acknowledge(sessionId, client.posted[0]!.revision)
    await vi.advanceTimersByTimeAsync(32)
    expect(client.posted).toHaveLength(2)
    expect(client.posted[1]?.nodes.at(-1)).toMatchObject({ markdown: 'Answer 1000' })
    client.service.setVisible(false)
    client.service.accept(message(1001).event)
    await vi.advanceTimersByTimeAsync(1000)
    expect(client.posted).toHaveLength(2)
    client.service.setVisible(true)
    await vi.advanceTimersByTimeAsync(32)
    expect(client.posted[2]?.nodes.at(-1)).toMatchObject({ markdown: 'Answer 1001' })
    client.service.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('invalidates stale and overflowing opens, cancels reads, and keeps lifecycle events available to watchers', async () => {
    const client = fixture()
    const stale = client.service.begin('other')
    const current = client.service.begin(sessionId)
    expect(() => client.service.installPage('other', { events: [], hasMore: false }, stale)).toThrow()
    for (let seq = 1; seq <= 300; seq++) client.service.accept(message(seq).event)
    expect(client.service.needsRefresh(current)).toBe(true)
    expect(() => client.service.installPage(sessionId, { events: [], hasMore: false }, current)).toThrow()
    client.service.restart(current)
    const window = client.service.installPage(sessionId, { events: [], hasMore: false }, current)
    expect(client.service.accept({ type: 'turn.started', sessionId, turn: 1, sequence: 1 })).toBe(false)
    expect(
      client.service.accept({ type: 'turn.ended', sessionId, turn: 1, reason: 'completed', sequence: 2 }),
    ).toBe(false)
    const abort = new AbortController()
    abort.abort()
    await expect(client.service.navigate(sessionId, 'older', window.revision, abort.signal)).rejects.toThrow()
    expect(
      transcriptWindowSchema.safeParse({
        ...window,
        nodes: [{ kind: 'notice', id: 'n', text: 'Bad', level: 'info', secret: 'bad' }],
      }).success,
    ).toBe(false)
    client.service.dispose()
  })
})
