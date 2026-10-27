import { describe, expect, it, vi } from 'vitest'
import { AppError } from '@dsh-vscode/domain'
import { Rc212VersionAdapter } from '../src/versions/rc212/adapter.js'
import { Rc213VersionAdapter } from '../src/versions/rc213/adapter.js'
import { acceptsRc212CompatibilityVersion } from '../src/versions/rc212/compatibility.js'
import { VersionedBackendProbe } from '../src/probe.js'
import { candidate, transportOptions } from './support/contract-harness.js'
import { ProbeFixtureTransport } from './support/probe-fixture.js'

function adapterFor(fixture: ProbeFixtureTransport): Rc212VersionAdapter {
  class FixtureAdapter extends Rc212VersionAdapter {
    public override createTransport(): ProbeFixtureTransport {
      return fixture
    }
  }
  return new FixtureAdapter(transportOptions(globalThis.fetch))
}

describe('rc.2 protocol family compatibility', () => {
  it('admits only the bounded modern family, including prereleases and build metadata', () => {
    for (const version of [
      '0.2.1-rc.2',
      '0.2.1-rc.4',
      '0.2.1-rc.10',
      '0.2.1',
      '0.2.2-alpha.1',
      '0.2.99',
      '0.2.1-rc.2+build.01',
    ])
      expect(acceptsRc212CompatibilityVersion(version), version).toBe(true)
    for (const version of [
      '0.2.0-rc.1',
      '0.2.1-alpha.9',
      '0.2.1-rc.1',
      '0.2.1-rc',
      '0.2.1-rc.01',
      '0.3.0-0',
      '0.3.0-rc.1',
      '0.3.0',
      '1.2.1',
      'dsh 0.2.1-rc.4',
      'unknown',
    ])
      expect(acceptsRc212CompatibilityVersion(version), version).toBe(false)
  })

  it('selects rc.2 for rc.4, preserves runtime identity and never calls legacy fallback', async () => {
    const fixture = new ProbeFixtureTransport()
    const legacy = {
      id: 'legacy',
      supportedVersion: '0.1.2-alpha.5',
      fallback: true,
      probe: vi.fn(),
      probeCompatibility: vi.fn(),
      createTransport: vi.fn(),
    }
    const result = await new VersionedBackendProbe([
      new Rc213VersionAdapter(transportOptions(globalThis.fetch)),
      legacy,
      adapterFor(fixture),
    ]).probe(candidate('0.2.1-rc.4'))
    expect(result?.capabilities).toMatchObject({
      dshVersion: '0.2.1-rc.4',
      protocolVersion: 'rc212',
      adapterId: 'dsh-0.2.1-rc.2',
      compatibilityMode: 'best-effort',
      featureProfile: { source: 'compatibility-fallback' },
    })
    expect(result?.capabilities.compatibilityWarning).toContain('0.2.1-rc.2 protocol baseline')
    expect(fixture.methods).toEqual(['session.list', 'workspace.list'])
    expect(fixture.closeCalls).toBe(1)
    expect(legacy.probeCompatibility).not.toHaveBeenCalled()
  })

  it.each(['malformed', 'business-error', 'protocol-error', 'timeout'] as const)(
    'declines %s responses and releases transport without downgrading to legacy',
    async (mode) => {
      const fixture = new ProbeFixtureTransport(mode)
      const legacy = {
        id: 'legacy',
        supportedVersion: '0.1.2-alpha.5',
        fallback: true,
        probe: vi.fn(),
        probeCompatibility: vi.fn(),
        createTransport: vi.fn(),
      }
      expect(
        await new VersionedBackendProbe([adapterFor(fixture), legacy]).probe(candidate('0.2.1-rc.4')),
      ).toBeUndefined()
      expect(fixture.closeCalls).toBe(1)
      expect(legacy.probeCompatibility).not.toHaveBeenCalled()
    },
  )

  it('keeps rc.3 exact selection and does not give its inherited adapter a family claim', async () => {
    const fixture = new ProbeFixtureTransport()
    class ExactFixtureAdapter extends Rc213VersionAdapter {
      public override createTransport(): ProbeFixtureTransport {
        return fixture
      }
    }
    const exact = new ExactFixtureAdapter(transportOptions(globalThis.fetch))
    const baseline = adapterFor(new ProbeFixtureTransport())
    expect(exact.supportsCompatibilityVersion('0.2.1-rc.4')).toBe(false)
    expect(
      (await new VersionedBackendProbe([baseline, exact]).probe(candidate('0.2.1-rc.3')))?.capabilities,
    ).toMatchObject({
      adapterId: 'dsh-0.2.1-rc.3',
      compatibilityMode: 'exact',
      protocolVersion: 'rc213',
    })
  })

  it.each(['AUTH_REQUIRED', 'REQUEST_CANCELLED'] as const)(
    'propagates %s and closes the baseline transport',
    async (code) => {
      const controller = new AbortController()
      const failure = new AppError({ code, message: 'Fixture failure', retryable: false })
      class FailingTransport extends ProbeFixtureTransport {
        public override request<TResponse>(): Promise<TResponse> {
          if (code === 'REQUEST_CANCELLED') controller.abort(failure)
          return Promise.reject(failure)
        }
      }
      const fixture = new FailingTransport()
      await expect(
        new VersionedBackendProbe([adapterFor(fixture)]).probe(candidate('0.2.1-rc.4'), controller.signal),
      ).rejects.toBe(failure)
      expect(fixture.closeCalls).toBe(1)
    },
  )
})
