import { describe, expect, it, vi } from 'vitest'
import type { DshTransport } from '../src/contracts.js'
import { Rc221PluginBundleRepository } from '../src/versions/rc221/plugin-manager-repository.js'
import { Alpha214PluginBundleRepository } from '../src/versions/alpha214/plugin-manager-repository.js'

// dsh-v0.2.2-rc.1 / 66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db,
// packages/boot/plugin-manager/src/types.ts, ManagementError.
const bundle = {
  name: '@example/platform-tool',
  official: true,
  availability: 'installation',
  enabled: false,
  installed: true,
  optional: true,
  removable: false,
  rows: [],
  overrides: [],
  error: { code: 'unsupported-platform', diagnostic: 'private diagnostic' },
}

function transport(bundles: readonly unknown[] = [bundle]): DshTransport {
  return {
    request: <T>() => Promise.reject<T>(new Error('Unexpected request')),
    remoteRequest: vi.fn((endpoint: string) =>
      Promise.resolve({
        ok: true,
        value:
          endpoint === 'pluginManager/listBundles'
            ? bundles
            : {
                stage: 'enable',
                target: bundle.name,
                changed: false,
                application: 'failed',
                enabled: true,
                error: bundle.error,
              },
      }),
    ) as DshTransport['remoteRequest'],
    openEventStream: async function* () {},
    close: async () => {},
  }
}

describe('DSH 0.2.2-rc.1 plugin platform refusal', () => {
  it('keeps the catalog and projects the refusal without its diagnostic', async () => {
    const repository = new Rc221PluginBundleRepository(transport())
    expect(await repository.listBundles()).toEqual([
      expect.objectContaining({
        name: bundle.name,
        errorCode: 'unsupported-platform',
      }),
    ])
    expect(JSON.stringify(await repository.listBundles())).not.toContain('private diagnostic')
    expect(await repository.setBundleEnabled(bundle.name, true)).toMatchObject({
      application: 'failed',
      errorCode: 'unsupported-platform',
    })
  })

  it('does not extend the older version contract', async () => {
    await expect(new Alpha214PluginBundleRepository(transport()).listBundles()).rejects.toMatchObject({
      code: 'PROTOCOL_ERROR',
    })
  })
})

describe('DSH runtime evidence from the official catalog', () => {
  const offered = {
    ...bundle,
    version: '0.2.1-rc.2',
    installTarget: { spec: `${bundle.name}@0.2.2-rc.1`, version: '0.2.2-rc.1' },
  }

  it('uses the running version behind official install targets instead of installed bundle versions', async () => {
    const repository = new Rc221PluginBundleRepository(transport([offered, bundle]))
    await expect(repository.readRuntimeVersion()).resolves.toBe('0.2.2-rc.1')
  })

  it('declines missing or conflicting runtime evidence', async () => {
    const otherName = '@example/other-tool'
    const conflict = {
      ...offered,
      name: otherName,
      installTarget: { spec: `${otherName}@0.2.1-rc.2`, version: '0.2.1-rc.2' },
    }
    await expect(
      new Rc221PluginBundleRepository(transport([bundle])).readRuntimeVersion(),
    ).resolves.toBeUndefined()
    await expect(
      new Rc221PluginBundleRepository(transport([offered, conflict])).readRuntimeVersion(),
    ).resolves.toBeUndefined()
  })
})
