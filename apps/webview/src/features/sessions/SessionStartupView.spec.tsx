// @vitest-environment jsdom
import { useSyncExternalStore, type ReactElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { HostMessage } from '@dsh-vscode/webview-protocol'
import type { ProtocolClient } from '../../app/protocol-client.js'
import type { AppStore } from '../../app/store.js'
import { createHostBackedAppStore, type FixtureRequest } from '../../test/host-window-store.js'
import { SessionStartupView } from './SessionStartupView.js'

const persisted: { value: unknown } = { value: undefined }
vi.stubGlobal('acquireVsCodeApi', () => ({
  postMessage: () => undefined,
  getState: () => persisted.value,
  setState: (value: unknown) => {
    persisted.value = value
  },
}))

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: Error) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const summary = {
  id: 'remembered',
  workspaceId: 'workspace',
  title: 'Previous conversation',
  blank: false,
  status: 'idle',
  createdAt: '2026-10-22T00:00:00.000Z',
  updatedAt: '2026-10-22T00:00:00.000Z',
} as const
const detail = { ...summary, history: [], permissionPresets: [] }

class Client {
  readonly requests: FixtureRequest[] = []
  readonly listeners = new Set<(message: HostMessage) => void>()
  constructor(readonly respond: (request: FixtureRequest) => unknown) {}
  request<T>(request: FixtureRequest): Promise<T> {
    this.requests.push(request)
    if (request.type === 'app.ready')
      for (const listener of this.listeners)
        listener({ type: 'event', name: 'connection.snapshot', sequence: 1, payload: { kind: 'connected' } })
    return Promise.resolve().then(() => this.respond(request) as T)
  }
  subscribe(listener: (message: HostMessage) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  dispose(): void {
    this.listeners.clear()
  }
  emit(name: string, payload: unknown): void {
    for (const listener of this.listeners) listener({ type: 'event', name, sequence: 10, payload })
  }
}
function response(request: FixtureRequest): unknown {
  if (request.type === 'session.list') return { items: [summary] }
  if (request.type === 'workspace.list') return { items: [] }
  if (request.type === 'session.open') return { ...detail, id: request.payload.sessionId }
  if (request.type === 'workspace.browser') return {}
  if (request.type === 'subagent.list') return { entries: [], parentAvailable: true }
  return []
}
const stores: AppStore[] = []
function storeFor(client: Client, remember = true): AppStore {
  persisted.value = remember ? { version: 1, activeSessionId: summary.id } : undefined
  const store = createHostBackedAppStore(client as unknown as ProtocolClient)
  stores.push(store)
  return store
}
function Screen({ store }: { readonly store: AppStore }): ReactElement {
  const state = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getState(),
  )
  return state.activeSessionId ? (
    <h2>Conversation: {state.activeSessionId}</h2>
  ) : (
    <SessionStartupView
      store={store}
      startup={state.sessionStartup}
      directoryStatus={state.sessionDirectoryStatus}
    />
  )
}
afterEach(() => {
  cleanup()
  stores.splice(0).forEach((store) => store.dispose())
  persisted.value = undefined
  vi.useRealTimers()
})

it('shows preparation then the named remembered conversation without flashing project selection', async () => {
  const catalog = deferred<unknown>()
  const opening = deferred<unknown>()
  const client = new Client((request) =>
    request.type === 'session.list'
      ? catalog.promise
      : request.type === 'session.open'
        ? opening.promise
        : response(request),
  )
  const store = storeFor(client)
  const prematureReady: boolean[] = []
  store.subscribe(() => {
    const state = store.getState()
    if (state.sessionStartup?.kind === 'ready' && !state.activeSessionId) prematureReady.push(true)
  })
  render(<Screen store={store} />)
  const initialization = store.initialize()
  expect(screen.getByRole('heading', { name: 'Loading workspaces and sessions…' })).toBeDefined()
  expect(screen.queryByRole('heading', { name: 'Choose a project to start chatting' })).toBeNull()
  await act(async () => {
    catalog.resolve({ items: [summary] })
    await catalog.promise
  })
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: 'Restoring your last conversation' })).toBeDefined(),
  )
  expect(screen.getByText(summary.title)).toBeDefined()
  expect(
    screen.getByText('Your conversation will open automatically. You do not need to select a project again.'),
  ).toBeDefined()
  await act(async () => {
    opening.resolve(detail)
    await initialization
  })
  expect(screen.getByRole('heading', { name: 'Conversation: remembered' })).toBeDefined()
  expect(prematureReady).toEqual([])
  expect(client.requests.filter((request) => request.type === 'session.open')).toHaveLength(1)
})

it('shows project guidance only after the directory and pending project handoff finish with no session', async () => {
  const handoff = deferred<unknown>()
  const client = new Client((request) =>
    request.type === 'session.list'
      ? { items: [] }
      : request.type === 'workspace.browser'
        ? handoff.promise
        : response(request),
  )
  const store = storeFor(client, false)
  render(<Screen store={store} />)
  const initialization = store.initialize()
  await waitFor(() =>
    expect(client.requests.some((request) => request.type === 'workspace.browser')).toBe(true),
  )
  expect(store.getState().sessionDirectoryStatus).toBe('ready')
  expect(screen.queryByRole('button', { name: 'Open folder' })).toBeNull()
  await act(async () => {
    handoff.resolve({})
    await initialization
  })
  expect(screen.getByRole('button', { name: 'Open folder' })).toBeDefined()
  expect(
    client.requests.some((request) => request.type === 'session.open' || request.type === 'session.create'),
  ).toBe(false)
})

it.each(['directory', 'restore'] as const)(
  'offers recovery for a failed %s instead of claiming there is no project',
  async (failure) => {
    let failing = true
    const client = new Client((request) => {
      if (failing && request.type === (failure === 'directory' ? 'session.list' : 'session.open'))
        throw new Error('Read unavailable')
      return response(request)
    })
    const store = storeFor(client)
    render(<Screen store={store} />)
    await act(async () => {
      await store.initialize().catch(() => undefined)
    })
    expect(screen.getByRole('heading', { name: 'Could not prepare the conversation' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Open folder' })).toBeNull()
    failing = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Conversation: remembered' })).toBeDefined(),
    )
  },
)

it('does not let a delayed startup handoff replace a conversation explicitly selected while waiting', async () => {
  const handoff = deferred<unknown>()
  const client = new Client((request) =>
    request.type === 'workspace.browser' ? handoff.promise : response(request),
  )
  const store = storeFor(client)
  render(<Screen store={store} />)
  const initialization = store.initialize()
  await waitFor(() =>
    expect(client.requests.some((request) => request.type === 'workspace.browser')).toBe(true),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Browse other conversations' }))
  expect(store.getState().drawer).toBe('sessions')
  await act(async () => {
    await store.openSession('chosen')
  })
  await act(async () => {
    handoff.resolve({ sessionId: summary.id })
    await initialization
  })
  expect(screen.getByRole('heading', { name: 'Conversation: chosen' })).toBeDefined()
  expect(client.requests.filter((request) => request.type === 'session.open')).toHaveLength(1)
})

it('bounds each preparation stage and releases its timer when the view closes', async () => {
  vi.useFakeTimers()
  const store = storeFor(new Client(response))
  const { rerender, container, unmount } = render(
    <SessionStartupView store={store} startup={{ kind: 'loading' }} directoryStatus="loading" />,
  )
  await act(() => vi.advanceTimersByTime(20_000))
  rerender(
    <SessionStartupView
      store={store}
      startup={{ kind: 'restoring', title: summary.title }}
      directoryStatus="ready"
    />,
  )
  await act(() => vi.advanceTimersByTime(20_000))
  expect(container.querySelector('section')?.getAttribute('aria-busy')).toBe('true')
  expect(container.querySelector('[data-loading]')?.getAttribute('data-loading')).toBe('true')
  await act(() => vi.advanceTimersByTime(10_000))
  expect(screen.getByRole('heading', { name: 'Preparing the conversation is taking longer' })).toBeDefined()
  expect(container.querySelector('section')?.getAttribute('aria-busy')).toBe('false')
  expect(container.querySelector('[data-loading]')?.getAttribute('data-loading')).toBe('false')
  expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined()
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})

const project = {
  id: 'workspace',
  name: 'Project',
  path: '/fixture/project',
  sessionIds: [summary.id],
  sessionCount: 1,
  createdAt: summary.createdAt,
  updatedAt: summary.updatedAt,
}
const invalidations = [
  {
    name: 'session.removed',
    payload: { sessionId: summary.id },
    reason: 'removed',
    heading: 'This conversation was deleted',
  },
  {
    name: 'archived.sessions.changed',
    payload: { sessionIds: [summary.id] },
    reason: 'archived',
    heading: 'This conversation was archived',
  },
  {
    name: 'workspace.removed',
    payload: { workspaceId: project.id },
    reason: 'workspace-removed',
    heading: 'This workspace was removed',
  },
] as const

it.each(invalidations)('settles a live $reason immediately and keeps recovery usable', async (event) => {
  let invalidated = false
  const client = new Client((request) => {
    if (request.type === 'workspace.list')
      return { items: invalidated && event.reason === 'workspace-removed' ? [] : [project] }
    if (request.type === 'session.list' && invalidated) return { items: [] }
    return response(request)
  })
  const store = storeFor(client)
  render(<Screen store={store} />)
  await act(() => store.initialize())
  expect(store.getState().activeSessionId).toBe(summary.id)
  invalidated = true
  await act(async () => {
    client.emit(event.name, event.payload)
    await store.refreshSessions()
  })
  expect(store.getState().backend.kind).toBe('connected')
  expect(store.getState().sessionStartup).toEqual({ kind: 'unavailable', reason: event.reason })
  expect(store.getState().activeSessionId).toBeUndefined()
  expect(store.getState().transcript).toBeUndefined()
  expect(persisted.value).not.toHaveProperty('activeSessionId')
  expect(screen.getByRole('heading', { name: event.heading })).toBeDefined()
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  expect(client.requests.filter((request) => request.type === 'session.open')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Browse other conversations' }))
  expect(store.getState().drawer).toBe('sessions')
  if (event.reason !== 'workspace-removed') {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))
      await Promise.resolve()
    })
    expect(store.getState().pendingSession?.workspaceId).toBe(project.id)
    expect(store.getState().sessionStartup?.kind).toBe('ready')
    expect(client.requests.some((request) => request.type === 'session.create')).toBe(false)
  }
})

it('retires a deleted session while its startup open is pending and ignores the late answer', async () => {
  const opening = deferred<unknown>()
  let deleted = false
  const client = new Client((request) => {
    if (request.type === 'session.open') return opening.promise
    if (request.type === 'session.list' && deleted) return { items: [] }
    return response(request)
  })
  const store = storeFor(client)
  render(<Screen store={store} />)
  const initialization = store.initialize()
  await waitFor(() => expect(client.requests.some((request) => request.type === 'session.open')).toBe(true))
  deleted = true
  await act(async () => {
    client.emit('session.removed', { sessionId: summary.id })
    opening.resolve(detail)
    await initialization
    await store.refreshSessions()
  })
  expect(store.getState().activeSessionId).toBeUndefined()
  expect(screen.getByRole('heading', { name: 'This conversation was deleted' })).toBeDefined()
  expect(client.requests.some((request) => request.type === 'session.queue.list')).toBe(false)
})

it.each(['delete', 'archive', 'workspace'] as const)(
  'handles an acknowledged local %s even without an event echo',
  async (action) => {
    let changed = false
    const client = new Client((request) => {
      if (
        request.type === 'session.remove' ||
        request.type === 'session.archive' ||
        request.type === 'workspace.remove'
      ) {
        changed = true
        return {}
      }
      if (request.type === 'session.list' && changed) return { items: [] }
      if (request.type === 'workspace.list')
        return { items: changed && action === 'workspace' ? [] : [project] }
      return response(request)
    })
    const store = storeFor(client)
    await store.initialize()
    if (action === 'delete') await store.deleteSession(summary.id)
    else if (action === 'archive') await store.removeSession(summary.id)
    else await store.removeWorkspace(project.id)
    expect(store.getState().sessionStartup).toEqual({
      kind: 'unavailable',
      reason: action === 'delete' ? 'removed' : action === 'archive' ? 'archived' : 'workspace-removed',
    })
    expect(store.getState().activeSessionId).toBeUndefined()
    expect(client.requests.filter((request) => request.type === 'session.open')).toHaveLength(1)
  },
)

it('preserves a newer open when the previous conversation is deleted', async () => {
  const opening = deferred<unknown>()
  const other = { ...summary, id: 'other', title: 'Another conversation' }
  let deleted = false
  const client = new Client((request) => {
    if (request.type === 'session.list') return { items: deleted ? [other] : [summary, other] }
    if (request.type === 'workspace.list') return { items: [project] }
    if (request.type === 'session.open' && request.payload.sessionId === other.id) return opening.promise
    return response(request)
  })
  const store = storeFor(client)
  await store.initialize()
  const navigating = store.openSession(other.id)
  deleted = true
  client.emit('session.removed', { sessionId: summary.id })
  opening.resolve({ ...detail, ...other })
  await navigating
  await store.refreshSessions()
  expect(store.getState().activeSessionId).toBe(other.id)
  expect(store.getState().sessionStartup?.kind).toBe('ready')
})

it('clears an invalid local draft when its workspace is removed', async () => {
  const client = new Client((request) =>
    request.type === 'workspace.list' ? { items: [project] } : response(request),
  )
  const store = storeFor(client)
  await store.initialize()
  await store.stageSession(project.id)
  client.emit('workspace.removed', { workspaceId: project.id })
  expect(store.getState().pendingSession).toBeUndefined()
  expect(store.getState().sessionStartup).toEqual({ kind: 'unavailable', reason: 'workspace-removed' })
})

it('accepts external restore facts without changing a different active conversation', async () => {
  const client = new Client(response)
  const store = storeFor(client)
  await store.initialize()
  client.emit('archived.sessions.changed', { sessionIds: ['other'] })
  expect(store.getState().archivedSessionIds).toEqual(['other'])
  client.emit('archived.sessions.changed', { sessionIds: [] })
  expect(store.getState().archivedSessionIds).toEqual([])
  expect(store.getState().activeSessionId).toBe(summary.id)
})

it('uses an authoritative archive snapshot after a missed live event', async () => {
  let archived = false
  const client = new Client((request) =>
    request.type === 'workspace.list'
      ? { items: [project], archivedSessionIds: archived ? [summary.id] : [] }
      : response(request),
  )
  const store = storeFor(client)
  await store.initialize()
  archived = true
  await store.refreshSessions()
  expect(store.getState().activeSessionId).toBeUndefined()
  expect(store.getState().sessionStartup).toEqual({ kind: 'unavailable', reason: 'archived' })
})

it('does not reopen a deleted editor binding when the same tab is assigned again', async () => {
  const client = new Client((request) =>
    request.type === 'workspace.list' ? { items: [project] } : response(request),
  )
  const store = storeFor(client)
  await store.initialize()
  client.emit('ui.surface.assigned', { kind: 'editor', sessionId: summary.id })
  client.emit('session.removed', { sessionId: summary.id })
  client.emit('ui.surface.assigned', { kind: 'editor', sessionId: summary.id })
  await store.refreshSessions()
  expect(store.getState().activeSessionId).toBeUndefined()
  expect(store.getState().sessionStartup).toEqual({ kind: 'unavailable', reason: 'removed' })
  expect(client.requests.filter((request) => request.type === 'session.open')).toHaveLength(1)
  await store.stageSession(project.id)
  client.emit('ui.surface.assigned', { kind: 'editor', sessionId: summary.id })
  expect(store.getState().pendingSession?.workspaceId).toBe(project.id)
  expect(client.requests.filter((request) => request.type === 'session.open')).toHaveLength(1)
})
