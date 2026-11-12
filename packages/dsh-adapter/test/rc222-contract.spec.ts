import { describe, expect, it } from 'vitest'
import type { PluginBundleRepository } from '@dsh-vscode/domain'
import { Rc6SubagentRepository } from '../src/repositories/subagent-repository.js'
import { SubagentAddressRegistry } from '../src/repositories/shared/subagent-addresses.js'
import { normalizeEnvelope } from '../src/stream-envelopes.js'
import { expandHistoryRecords, normalizeAlphaEvent } from '../src/versions/alpha/session-wire.js'
import type { AlphaLoopbackApiClient } from '../src/versions/alpha/transport.js'
import {
  validAlpha171SessionEvent,
  validAlpha171SessionSnapshot,
} from '../src/versions/alpha171/session-wire.js'
import { alpha213SessionProfile } from '../src/versions/alpha213/session-wire.js'
import { Rc222VersionAdapter } from '../src/versions/rc222/adapter.js'
import { rc222SessionProfile } from '../src/versions/rc222/session-wire.js'
import { transportOptions } from './support/contract-harness.js'

// dsh-v0.2.2-rc.2 / ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c.
const namedChild = {
  type: 'subagent/catalog',
  seq: 0,
  time: 1,
  data: {
    version: 3,
    name: 'reviewer',
    childId: 'child-1',
    childCreatedAt: 1,
    mode: 'continuable',
    label: 'Review',
  },
}
const teamMode = { type: 'team/mode', seq: 1, time: 2, data: { enabled: true } }

function snapshot(...events: readonly unknown[]): DiffableSnapshot {
  const cursor = events.length - 1
  const records = events.map((event): { readonly type: 'event'; readonly event: unknown } => ({
    type: 'event',
    event,
  }))
  return {
    type: 'snapshot',
    header: { version: 4, id: 's1', createdAt: 1, isSeeded: false },
    cursor,
    records,
    hasMore: false,
    projections: { asOfSeq: cursor, values: {} },
  }
}

interface DiffableSnapshot extends Record<string, unknown> {
  readonly records: readonly { readonly type: 'event'; readonly event: unknown }[]
}

describe('DSH 0.2.2-rc.2', () => {
  it('opens complete V4 logs with named children and preserves Team mode sequence', () => {
    const log = snapshot(namedChild, teamMode)
    expect(validAlpha171SessionSnapshot(log, rc222SessionProfile)).toBe(true)
    expect(validAlpha171SessionSnapshot(log, alpha213SessionProfile)).toBe(false)
    const events = expandHistoryRecords(log.records, 's1', 'v4', false, rc222SessionProfile)
    expect(events[1]).toMatchObject({ type: 'system/message', seq: 1 })
    for (const event of [
      events[0],
      normalizeAlphaEvent(namedChild, 's1', 'v4', false, rc222SessionProfile),
    ]) {
      expect(normalizeEnvelope({ type: 'session/event', sessionId: 's1', event })).toMatchObject({
        type: 'subagent.catalog.updated',
        entry: { id: 'child-1', mode: 'continuable', label: 'Review' },
      })
    }
    const external = {
      ...namedChild,
      data: { ...namedChild.data, mode: 'external' },
    }
    const event = normalizeAlphaEvent(external, 's1', 'v4', false, rc222SessionProfile)
    expect(normalizeEnvelope({ type: 'session/event', sessionId: 's1', event })).toMatchObject({
      type: 'subagent.catalog.updated',
      entry: { id: 'child-1', mode: 'external' },
    })
  })

  it('rejects invalid or duplicate sibling names and malformed Team mode', () => {
    for (const name of ['lead', 'bad name', 'UPPERCASE', 'a'.repeat(33)]) {
      expect(
        validAlpha171SessionEvent({ ...namedChild, data: { ...namedChild.data, name } }, rc222SessionProfile),
      ).toBe(false)
    }
    const duplicate = { ...namedChild, seq: 1, data: { ...namedChild.data, childId: 'child-2' } }
    expect(validAlpha171SessionSnapshot(snapshot(namedChild, duplicate), rc222SessionProfile)).toBe(false)
    expect(validAlpha171SessionEvent({ ...teamMode, data: { enabled: 'true' } }, rc222SessionProfile)).toBe(
      false,
    )
    expect(
      validAlpha171SessionEvent({ ...teamMode, data: { enabled: true, extra: true } }, rc222SessionProfile),
    ).toBe(false)
  })

  it('addresses continuations on the target Session and interrupts by user', async () => {
    const calls: { readonly method: string; readonly params: unknown }[] = []
    const transport = {
      request: <TResponse>(method: string, params: unknown) => {
        calls.push({ method, params })
        if (method === 'subagent.list')
          return Promise.resolve({
            result: {
              ok: true,
              value: {
                entries: [
                  {
                    kind: 'child',
                    id: 'child-1',
                    activity: 'inactive',
                    hasChildren: false,
                    mode: 'continuable',
                    label: 'Review',
                  },
                ],
                parentAvailable: true,
              },
            },
          } as TResponse)
        return Promise.resolve({
          result: { ok: true, value: { messageId: 'm1', accepted: true } },
        } as TResponse)
      },
      remoteRequest: <TResponse>() => Promise.reject<TResponse>(new Error('unused')),
      openEventStream: async function* () {
        /* no events */
      },
      close: () => Promise.resolve(),
    } as unknown as AlphaLoopbackApiClient

    class FixtureAdapter extends Rc222VersionAdapter {
      public subagents(api: AlphaLoopbackApiClient): Rc6SubagentRepository {
        return new Rc6SubagentRepository(api, {
          treeScopedSubagentWire: true,
          addresses: new SubagentAddressRegistry(),
        })
      }
    }
    const repository = new FixtureAdapter(transportOptions(globalThis.fetch)).subagents(transport)
    await repository.list('parent')
    await repository.send('child-1', 'next')
    await repository.interrupt('child-1')

    const prompt = calls.find((call) => call.method === 'subagent.prompt')
    expect(prompt?.params).toMatchObject({ childSessionId: 'child-1', delivery: 'queue' })
    expect(prompt?.params).not.toHaveProperty('parentSessionId')
    expect(prompt?.params).not.toHaveProperty('mode')
    expect(calls.find((call) => call.method === 'subagent.interrupt')?.params).toEqual({
      childSessionId: 'child-1',
    })
  })

  it('reports rejected plugin replacements without leaking package diagnostics', async () => {
    class FixtureAdapter extends Rc222VersionAdapter {
      public bundles(transport: AlphaLoopbackApiClient): PluginBundleRepository {
        return this.createPluginBundleRepository(transport)
      }
    }
    const spec = '@fixture/plugin@1.0.0'
    const transport = {
      remoteRequest: () =>
        Promise.resolve({
          ok: true,
          value: {
            stage: 'install',
            target: spec,
            enabled: true,
            changed: false,
            application: 'failed',
            error: { code: 'unexpected-package', diagnostic: 'private diagnostic' },
          },
        }),
    } as unknown as AlphaLoopbackApiClient
    const result = await new FixtureAdapter(transportOptions(globalThis.fetch))
      .bundles(transport)
      .installBundle(spec, { requestId: 'request-1' })
    expect(result).toMatchObject({ application: 'failed', changed: false, errorCode: 'operation-error' })
    expect(JSON.stringify(result)).not.toContain('private diagnostic')
  })
})
