import { describe, expect, it, vi } from 'vitest'
import type { BackendEvent } from '../../packages/domain/src/events.js'
import { canConnect, LIVE_TIMEOUT_MS, startManagedRuntime } from './harness.js'

// A disposable DSH home and workspace; no account, model request or package changes.
const version = process.env.DSH_LIVE_RUNTIME_VERSION ?? ''
describe.skipIf(process.env.DSH_LIVE_SMOKE !== '1' || !['0.2.2-rc.1', '0.2.2-rc.2'].includes(version))(
  'live DSH 0.2.2 Session control',
  () => {
    it(
      'opens a session, observes a projection update and releases the runtime',
      async () => {
        const runtime = await startManagedRuntime()
        const events: BackendEvent[] = []
        const unsubscribe = runtime.backend.events.subscribe((event) => events.push(event))
        try {
          const { backend } = runtime
          expect(backend.connection.capabilities.adapterId).toBe(`dsh-${version}`)
          expect(backend.schedules).toBeUndefined()
          await vi.waitFor(() =>
            expect(events.some((event) => event.type === 'session.projection.baseline')).toBe(true),
          )
          const workspace = await backend.workspaces.create({
            name: 'Fixture',
            path: runtime.snapshot.workspace,
          })
          const session = await backend.sessions.create({
            workspaceId: workspace.id,
            configuration: {
              preset: '',
              toolMode: 'native',
              permissionPreset: '',
              planMode: false,
              model: { providerId: '', modelId: '' },
            },
          })
          if (backend.sessions.open === undefined) throw new Error('Session open is unavailable')
          expect((await backend.sessions.open(session.id)).id).toBe(session.id)
          expect(await backend.sessions.listQueue(session.id)).toEqual([])
          expect(await backend.sessions.rename(session.id, 'Renamed fixture')).toBe('Renamed fixture')
          await vi.waitFor(
            () =>
              expect(
                events.some(
                  (event) =>
                    event.type === 'session.projection' &&
                    event.sessionId === session.id &&
                    event.key === 'title' &&
                    event.value === 'Renamed fixture',
                ),
              ).toBe(true),
            { timeout: 5_000 },
          )
        } finally {
          unsubscribe()
          await runtime.stop()
          expect(await canConnect(runtime.snapshot.port)).toBe(false)
        }
      },
      LIVE_TIMEOUT_MS,
    )
  },
)
