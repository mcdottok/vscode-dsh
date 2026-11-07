import { describe, expect, it, vi } from 'vitest'

import { WebviewSurfaceRegistry } from './webview-surface-registry.js'
import type { WebviewSurface, WebviewSurfaceKind } from './webview-surface.js'

interface FakeSurface extends WebviewSurface {
  disposed: boolean
  readonly posted: unknown[]
}

function surface(
  surfaceId: string,
  kind: WebviewSurfaceKind,
  options: {
    readonly visible?: boolean
    readonly ready?: boolean
    readonly accepts?: boolean
    readonly throws?: boolean
  } = {},
): FakeSurface {
  const posted: unknown[] = []
  const fake: FakeSurface = {
    surfaceId,
    kind,
    sessionId: kind === 'editor' ? surfaceId.replace('editor:', '') : undefined,
    visible: options.visible ?? true,
    isReady: options.ready ?? true,
    disposed: false,
    posted,
    postMessage(message: unknown): Promise<boolean> {
      if (options.throws === true) throw new Error('the Webview is disposed')
      posted.push(message)
      return Promise.resolve(options.accepts ?? true)
    },
    waitUntilReady: () => Promise.resolve(true),
    reveal: () => Promise.resolve(),
    dispose(): void {
      fake.disposed = true
    },
  }
  return fake
}

describe('WebviewSurfaceRegistry', () => {
  it('broadcasts to every surface and reports delivery when any accepted', async () => {
    const registry = new WebviewSurfaceRegistry()
    const sidebar = surface('sidebar', 'sidebar', { accepts: false })
    const editor = surface('editor:s1', 'editor')
    registry.register(sidebar)
    registry.register(editor)

    expect(await registry.post({ message: 'event' })).toBe(true)
    expect(sidebar.posted).toHaveLength(1)
    expect(editor.posted).toHaveLength(1)
  })

  it('reports no delivery when no surface accepted the message', async () => {
    const registry = new WebviewSurfaceRegistry()
    registry.register(surface('sidebar', 'sidebar', { accepts: false }))

    expect(await registry.post({ message: 'event' })).toBe(false)
  })

  it('does not fail a broadcast because one surface threw during disposal', async () => {
    const registry = new WebviewSurfaceRegistry()
    registry.register(surface('sidebar', 'sidebar', { throws: true }))
    const editor = surface('editor:s1', 'editor')
    registry.register(editor)

    expect(await registry.post({ message: 'event' })).toBe(true)
    expect(editor.posted).toHaveLength(1)
  })

  it('targets one surface and refuses an unknown or throwing target', async () => {
    const registry = new WebviewSurfaceRegistry()
    const sidebar = surface('sidebar', 'sidebar')
    const editor = surface('editor:s1', 'editor', { throws: true })
    registry.register(sidebar)
    registry.register(editor)

    expect(await registry.postTo('sidebar', { message: 'assigned' })).toBe(true)
    expect(sidebar.posted).toEqual([{ message: 'assigned' }])
    expect(editor.posted).toEqual([])
    expect(await registry.postTo('editor:s1', { message: 'assigned' })).toBe(false)
    expect(await registry.postTo('editor:missing', { message: 'assigned' })).toBe(false)
  })

  it('distinguishes readiness, missing surfaces, and posting failures for a targeted reply', async () => {
    const registry = new WebviewSurfaceRegistry()
    const onFailure = vi.fn()
    const message = { message: 'reply' }
    registry.register(surface('sidebar', 'sidebar', { ready: false, accepts: false }))
    registry.register(surface('editor:rejects', 'editor', { accepts: false }))
    registry.register(surface('editor:throws', 'editor', { throws: true }))
    registry.register(surface('editor:accepts', 'editor'))

    expect(await registry.postTo('sidebar', message, onFailure)).toBe(false)
    expect(await registry.postTo('editor:missing', message, onFailure)).toBe(false)
    expect(await registry.postTo('editor:rejects', message, onFailure)).toBe(false)
    expect(await registry.postTo('editor:throws', message, onFailure)).toBe(false)
    expect(await registry.postTo('editor:accepts', message, onFailure)).toBe(true)
    expect(onFailure.mock.calls).toEqual([
      ['surface-not-ready', 'sidebar'],
      ['surface-missing'],
      ['vscode-post-rejected', 'editor'],
      ['vscode-post-error', 'editor'],
    ])
  })

  it('prefers the most recently registered visible surface for user actions', () => {
    const registry = new WebviewSurfaceRegistry()
    const sidebar = surface('sidebar', 'sidebar')
    const hiddenEditor = surface('editor:old', 'editor', { visible: false })
    registry.register(sidebar)
    registry.register(hiddenEditor)

    expect(registry.active).toBe(sidebar)

    const visibleEditor = surface('editor:new', 'editor')
    registry.register(visibleEditor)
    expect(registry.active).toBe(visibleEditor)

    registry.unregister('editor:new')
    expect(registry.active).toBe(sidebar)
    expect(registry.editorCount).toBe(1)
    expect(registry.isEmpty()).toBe(false)
  })

  it('counts editor surfaces and disposes every registered surface once', () => {
    const registry = new WebviewSurfaceRegistry()
    const sidebar = surface('sidebar', 'sidebar')
    const editor = surface('editor:s1', 'editor')
    registry.register(sidebar)
    registry.register(editor)

    expect(registry.editorCount).toBe(1)
    expect(registry.list()).toEqual([sidebar, editor])

    registry.dispose()

    expect(sidebar.disposed).toBe(true)
    expect(editor.disposed).toBe(true)
    expect(registry.isEmpty()).toBe(true)
    expect(registry.active).toBeUndefined()
    expect(registry.get('sidebar')).toBeUndefined()
  })
})
