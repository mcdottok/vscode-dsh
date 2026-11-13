import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { DesktopAutoDiscovery, allowsAutomaticDesktop } from './desktop-auto-discovery.js'
const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})
const now = 1_800_000_000_000
const key = 'K'.repeat(43)
const endpoint = { host: '127.0.0.1', port: 43120, baseUrl: 'http://127.0.0.1:43120' }
async function fixture(overrides: Record<string, unknown> = {}): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'desktop-auto-fixture-'))
  directories.push(directory)
  await writeFile(
    path.join(directory, `${now}-${randomBytes(12).toString('hex')}.json`),
    JSON.stringify({
      version: 1,
      pid: 17,
      createdAt: now,
      updatedAt: now,
      protectedKey: Buffer.alloc(48).toString('base64'),
      ...overrides,
    }),
  )
  return directory
}

it('uses the account-protected grant and accepts only an authenticated numeric loopback address', async () => {
  const unprotect = vi.fn(() => Promise.resolve(JSON.stringify({ version: 1, key })))
  const resolve = vi.fn(() => Promise.resolve(endpoint.baseUrl + '/?token=fixture'))
  const discovery = new DesktopAutoDiscovery({
    directory: await fixture(),
    platform: 'win32',
    now: () => now,
    unprotect,
    resolve,
  })
  expect(await discovery.available()).toBe(true)
  expect(await discovery.discover()).toEqual({
    url: endpoint.baseUrl + '/?token=fixture',
    key,
    endpoint,
  })
  expect(unprotect).toHaveBeenCalledTimes(1)
  resolve.mockResolvedValueOnce('http://192.0.2.1:43121/?token=fixture')
  expect(await discovery.discover()).toBeUndefined()
})

it('ignores stale records before decrypting or contacting a pipe', async () => {
  const unprotect = vi.fn(() => Promise.resolve(JSON.stringify({ version: 1, key })))
  const resolve = vi.fn(() => Promise.resolve(endpoint.baseUrl + '/?token=fixture'))
  const directory = await fixture({ updatedAt: now - 20_000 })
  const stale = new DesktopAutoDiscovery({ directory, platform: 'win32', now: () => now, unprotect, resolve })
  expect(await stale.available()).toBe(false)
  expect(await stale.discover()).toBeUndefined()
  expect(unprotect).not.toHaveBeenCalled()
  expect(resolve).not.toHaveBeenCalled()
})

it('contains corrupt or another-account grants, and honors cancellation', async () => {
  const unprotect = vi.fn<() => Promise<string>>(() => Promise.reject(new Error('Unavailable')))
  const resolve = vi.fn(() => Promise.resolve(endpoint.baseUrl + '/?token=fixture'))
  const discovery = new DesktopAutoDiscovery({
    directory: await fixture(),
    platform: 'win32',
    now: () => now,
    unprotect,
    resolve,
  })
  expect(await discovery.discover()).toBeUndefined()
  expect(resolve).not.toHaveBeenCalled()
  unprotect.mockImplementationOnce(() => Promise.resolve('{"version":1,"key":"invalid"}'))
  expect(await discovery.discover()).toBeUndefined()
  const abort = new AbortController()
  abort.abort()
  await expect(discovery.discover(abort.signal)).rejects.toThrow()
})

it('never replaces a manually selected endpoint, port list or local runtime', () => {
  expect(allowsAutomaticDesktop({ mode: 'attach-only' })).toBe(true)
  expect(allowsAutomaticDesktop({ mode: 'auto', attachPortsConfigured: true })).toBe(false)
  expect(allowsAutomaticDesktop({ mode: 'custom', serverUrl: endpoint.baseUrl })).toBe(false)
  expect(allowsAutomaticDesktop({ mode: 'auto', serverUrl: endpoint.baseUrl })).toBe(false)
  expect(allowsAutomaticDesktop({ mode: 'new-isolated' })).toBe(false)
  expect(allowsAutomaticDesktop({ mode: 'custom', serverUrl: endpoint.baseUrl }, endpoint.baseUrl)).toBe(true)
})

it('requires a unique verified profile unless constrained by the existing secret pairing identity', async () => {
  const directory = await fixture()
  await writeFile(
    path.join(directory, `${now}-bbbbbbbbbbbbbbbbbbbbbbbb.json`),
    JSON.stringify({
      version: 1,
      pid: 18,
      createdAt: now,
      updatedAt: now,
      protectedKey: Buffer.alloc(49).toString('base64'),
    }),
  )
  const otherKey = 'L'.repeat(43)
  const otherEndpoint = { host: '127.0.0.1', port: 43121, baseUrl: 'http://127.0.0.1:43121' }
  const resolve = vi.fn((value: string) =>
    Promise.resolve((value === key ? endpoint : otherEndpoint).baseUrl + '/?token=fixture'),
  )
  const discovery = new DesktopAutoDiscovery({
    directory,
    platform: 'win32',
    now: () => now,
    unprotect: (value) =>
      Promise.resolve(
        JSON.stringify({ version: 1, key: value === Buffer.alloc(48).toString('base64') ? key : otherKey }),
      ),
    resolve,
  })
  expect(await discovery.discover()).toBeUndefined()
  resolve.mockClear()
  expect((await discovery.discover(undefined, key))?.key).toBe(key)
  expect(resolve.mock.calls.every(([value]) => value === key)).toBe(true)
  expect(await discovery.discover(undefined, 'M'.repeat(43))).toBeUndefined()
})
