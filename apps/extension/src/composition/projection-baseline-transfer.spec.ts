import { expect, it, vi } from 'vitest'
import type { DshBackend } from '@dsh-vscode/domain'
import {
  hostMessageSchema,
  ProjectionBaselineReceiver,
  projectionBaselinePartSchema,
  type HostMessage,
  type ProjectionBaseline,
  type ProjectionBaselinePart,
} from '@dsh-vscode/webview-protocol'
import type { WebviewSurface } from '../view/webview-surface.js'
import { WebviewSurfaceRegistry } from '../view/webview-surface-registry.js'
import { createHostEventPipeline, type HostEventPipelineDependencies } from './host-event-pipeline.js'

vi.mock('vscode', () => ({ commands: { executeCommand: () => Promise.resolve() } }))

it('restarts a missed baseline only for the affected surface before delivering the next delta', async () => {
  const surfaces = new WebviewSurfaceRegistry()
  const sidebar: HostMessage[] = []
  const editor: HostMessage[] = []
  let dropped = false
  const register = (
    surfaceId: string,
    kind: WebviewSurface['kind'],
    postMessage: WebviewSurface['postMessage'],
  ): void => {
    surfaces.register({
      surfaceId,
      kind,
      sessionId: undefined,
      isReady: true,
      visible: true,
      postMessage,
      waitUntilReady: () => Promise.resolve(true),
      reveal: () => Promise.resolve(),
      dispose: () => undefined,
    })
  }
  register('sidebar', 'sidebar', (raw) => {
    const message = hostMessageSchema.parse(raw)
    if (
      !dropped &&
      message.type === 'event' &&
      message.name === 'session.projection.baseline.part' &&
      projectionBaselinePartSchema.parse(message.payload).index === 1
    ) {
      dropped = true
      return Promise.resolve(false)
    }
    sidebar.push(message)
    return Promise.resolve(true)
  })
  register('editor', 'editor', (raw) => {
    editor.push(hostMessageSchema.parse(raw))
    return Promise.resolve(true)
  })
  const backend = {} as DshBackend
  const pipeline = createHostEventPipeline({
    surfaces,
    post: (message: HostMessage) => surfaces.post(message),
    postTo: (surfaceId: string, message: HostMessage) => surfaces.postTo(surfaceId, message),
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
    expect(dropped).toBe(true)
    const editorParts = baselineParts(editor)
    const sidebarParts = baselineParts(sidebar)
    expect(editorParts.length).toBeGreaterThan(1)
    expect(new Set(editorParts.map((part) => part.batchId)).size).toBe(1)
    expect(sidebarParts).toHaveLength(editorParts.length + 1)
    expect(sidebarParts[0]).toEqual(editorParts[0])
    expect(sidebarParts[1]).toMatchObject({ index: 0, total: editorParts.length })
    expect(sidebarParts[1]?.batchId).not.toBe(sidebarParts[0]?.batchId)
    expect(completedBaselines(sidebarParts)).toEqual([{ projections }])
    expect(completedBaselines(editorParts)).toEqual([{ projections }])
    for (const messages of [sidebar, editor])
      expect(messages.at(-1)).toMatchObject({ name: 'session.projection', payload: { value: 'updated' } })
  } finally {
    pipeline.dispose()
    surfaces.dispose()
  }
})

function baselineParts(messages: readonly HostMessage[]): readonly ProjectionBaselinePart[] {
  return messages.flatMap((message) =>
    message.type === 'event' && message.name === 'session.projection.baseline.part'
      ? [projectionBaselinePartSchema.parse(message.payload)]
      : [],
  )
}

function completedBaselines(parts: readonly ProjectionBaselinePart[]): readonly ProjectionBaseline[] {
  const receiver = new ProjectionBaselineReceiver()
  const completed: ProjectionBaseline[] = []
  for (const part of parts) {
    const baseline = receiver.accept(part)
    if (baseline !== undefined) completed.push(baseline)
  }
  return completed
}
