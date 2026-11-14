import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExtensionUpdates } from './extension-updates.js'

const publishedAt = '2026-11-13T08:00:00Z'
const downloadUrl =
  'https://github.com/mcdottok/vscode-dsh/releases/download/v0.1.100/dsh-coding-agent-0.1.100.vsix'
const release = {
  tag_name: 'v0.1.100',
  published_at: publishedAt,
  draft: false,
  prerelease: false,
  assets: [{ name: 'dsh-coding-agent-0.1.100.vsix', browser_download_url: downloadUrl, state: 'uploaded' }],
}

interface UpdateFixture {
  readonly create: () => ExtensionUpdates
  readonly fetchRelease: ReturnType<typeof vi.fn<typeof fetch>>
  readonly publish: ReturnType<typeof vi.fn<() => Promise<boolean>>>
  readonly enabled: { value: boolean }
}

function setup(installedVersion = '0.1.99'): UpdateFixture {
  const records = new Map<string, unknown>()
  const state = {
    get<T>(key: string, fallback?: T): T {
      return (records.get(key) ?? fallback) as T
    },
    update(key: string, value: unknown): Promise<void> {
      records.set(key, value)
      return Promise.resolve()
    },
    keys: () => [...records.keys()],
  }
  const fetchRelease = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(release)))
  const publish = vi.fn(() => Promise.resolve(true))
  const enabled = { value: true }
  const create = (): ExtensionUpdates =>
    new ExtensionUpdates({ installedVersion, state, isEnabled: () => enabled.value, publish })
  vi.stubGlobal('fetch', fetchRelease)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(publishedAt))
  return { create, fetchRelease, publish, enabled }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('VSIX update checks', () => {
  it('compares numeric versions and persists dismissal across restarts', async () => {
    const { create, publish } = setup()
    const updates = create()
    await updates.check()
    expect(publish).toHaveBeenLastCalledWith({ version: '0.1.100', publishedAt, downloadUrl })
    await updates.dismiss('0.1.100')
    expect(publish).toHaveBeenLastCalledWith(null)
    publish.mockClear()
    vi.setSystemTime(Date.now() + 12 * 60 * 60 * 1000)
    await create().check()
    expect(publish).not.toHaveBeenCalled()
  })

  it('shares concurrent checks and rate-limits retries after an offline failure', async () => {
    const { create, fetchRelease, publish } = setup()
    fetchRelease.mockRejectedValueOnce(new TypeError('offline'))
    const updates = create()
    await Promise.all([updates.check(), updates.check()])
    vi.setSystemTime(Date.now() + 12 * 60 * 60 * 1000 - 1)
    await create().check()
    expect(fetchRelease).toHaveBeenCalledTimes(1)
    expect(publish).not.toHaveBeenCalled()
    vi.setSystemTime(Date.now() + 1)
    await create().check()
    expect(fetchRelease).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenCalledOnce()
  })

  it.each([
    { tag_name: 'v0.1.99' },
    { prerelease: true },
    { draft: true },
    { assets: [] },
    { assets: [{ ...release.assets[0], browser_download_url: 'https://example.com/package.vsix' }] },
  ])('keeps unsuitable releases silent (%j)', async (overrides) => {
    const { create, fetchRelease, publish } = setup()
    fetchRelease.mockResolvedValueOnce(Response.json({ ...release, ...overrides }))
    await create().check()
    expect(publish).not.toHaveBeenCalled()
  })

  it('does not fetch while disabled and aborts an in-flight check when turned off', async () => {
    const { create, fetchRelease, enabled, publish } = setup()
    enabled.value = false
    const updates = create()
    await updates.check()
    expect(fetchRelease).not.toHaveBeenCalled()
    enabled.value = true
    fetchRelease.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        }),
    )
    const pending = updates.configurationChanged()
    await Promise.resolve()
    expect(fetchRelease).toHaveBeenCalledOnce()
    enabled.value = false
    await updates.configurationChanged()
    await pending
    expect(publish).not.toHaveBeenCalled()
  })
})
