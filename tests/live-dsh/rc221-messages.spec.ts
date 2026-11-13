import { describe, expect, it, vi } from 'vitest'
import type { BackendEvent } from '../../packages/domain/src/events.js'
import { canConnect, LIVE_TIMEOUT_MS, startManagedRuntime } from './harness.js'

// A disposable DSH home/workspace and synthetic prompt, without a real account.
const version = process.env.DSH_LIVE_RUNTIME_VERSION ?? ''
const supportedVersions = ['0.2.2-rc.1', '0.2.2-rc.2', '0.2.2-rc.3']
describe.skipIf(process.env.DSH_LIVE_SMOKE !== '1' || !supportedVersions.includes(version))(
  'live DSH 0.2.2 message history',
  () => {
    it(
      'retains the prompt and request identity in history and the live stream',
      async () => {
        const runtime = await startManagedRuntime()
        const { backend } = runtime
        const events: BackendEvent[] = []
        const unsubscribe = backend.events.subscribe((event) => events.push(event))
        try {
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
          await backend.sessions.open(session.id)
          await backend.sessions.sendPrompt({
            sessionId: session.id,
            requestId: 'fixture-request',
            text: 'fixture prompt',
            attachments: [],
          })
          await vi.waitFor(
            async () => {
              const history = await backend.sessions.history(session.id)
              expect(history.events.map((row) => row.event)).toContainEqual(
                expect.objectContaining({
                  type: 'message.user',
                  sessionId: session.id,
                  rpcId: 'fixture-request',
                  markdown: 'fixture prompt',
                }),
              )
            },
            { timeout: 10_000 },
          )
          await vi.waitFor(
            () =>
              expect(events).toEqual(
                expect.arrayContaining([
                  expect.objectContaining({
                    type: 'message.user',
                    sessionId: session.id,
                    rpcId: 'fixture-request',
                  }),
                ]),
              ),
            { timeout: 10_000 },
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
