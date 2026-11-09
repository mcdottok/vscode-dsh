import { expect, it, vi } from 'vitest'
import type { DshBackend } from '@dsh-vscode/domain'
import {
  hostMessageSchema,
  ProjectionBaselineReceiver,
  projectionBaselinePartSchema,
  type HostMessage,
} from '@dsh-vscode/webview-protocol'
import { createHostEventPipeline, type HostEventPipelineDependencies } from './host-event-pipeline.js'

vi.mock('vscode', () => ({ commands: { executeCommand: () => Promise.resolve() } }))

it('posts every large baseline part through the real Host schema before a later delta', async () => {
  const posted: HostMessage[] = []
  const backend = {} as DshBackend
  const pipeline = createHostEventPipeline({
    post: (message: HostMessage) => {
      posted.push(hostMessageSchema.parse(message))
      return Promise.resolve(true)
    },
    postTo: () => Promise.resolve(true),
    backendService: { requireBackend: () => backend },
    diagnostics: { log: vi.fn() },
    transcript: { accept: () => false, dispose: () => undefined },
    currentWorkspaceFolders: () => [],
    temporaryWorkspaceManager: {},
    runtimeUpdateProgress: {},
  } as unknown as HostEventPipelineDependencies)
  const projections = Object.fromEntries(
    Array.from({ length: 300 }, (_, index) => [
      `session-${index}`,
      {
        asOfSequence: index,
        values: { rows: Array.from({ length: 100 }, (_, row) => ({ row, valid: true })) },
      },
    ]),
  )
  try {
    const delivered = pipeline.postBackendEvent(backend, { type: 'session.projection.baseline', projections })
    const delta = pipeline.postBackendEvent(backend, {
      type: 'session.projection',
      sessionId: 'session-0',
      key: 'title',
      value: 'updated',
      sequence: 301,
    })
    expect(await delivered).toBe(true)
    expect(await delta).toBe(true)
    const receiver = new ProjectionBaselineReceiver()
    let result: unknown
    for (const message of posted.slice(0, -1)) {
      expect(message).toMatchObject({ type: 'event', name: 'session.projection.baseline.part' })
      if (message.type === 'event')
        result = receiver.accept(projectionBaselinePartSchema.parse(message.payload))
    }
    expect(result).toEqual({ projections })
    expect(posted.at(-1)).toMatchObject({ name: 'session.projection', payload: { value: 'updated' } })
  } finally {
    pipeline.dispose()
  }
})
