import { describe, expect, it, vi, type Mock } from 'vitest'
import { WindowsDesktopDiscoveryProvider } from './windows-desktop-provider.js'
import { CompositeInstanceDiscovery } from './instance-discovery.js'

const executable = 'C:\\Apps\\DSH Desktop\\DSH Desktop.exe'
const processOutput = JSON.stringify([{ Id: 42, Path: executable }])
const listeners = [
  ' TCP 127.0.0.1:43120 0.0.0.0:0 LISTENING 42',
  ' TCP 0.0.0.0:43121 0.0.0.0:0 LISTENING 42',
  ' TCP 127.0.0.1:43122 0.0.0.0:0 LISTENING 99',
  ' TCP 127.0.0.1:43123 127.0.0.1:1 ESTABLISHED 42',
].join('\n')

function fixture(options: { processes?: string; badManifest?: boolean; platform?: NodeJS.Platform } = {}): {
  command: Mock<(name: string) => Promise<string>>
  manifest: Mock<(file: string) => Promise<string>>
  provider: WindowsDesktopDiscoveryProvider
} {
  const command = vi.fn((name: string) =>
    Promise.resolve(name === 'netstat.exe' ? listeners : (options.processes ?? processOutput)),
  )
  const manifest = vi.fn((file: string) =>
    Promise.resolve(
      JSON.stringify({
        name: options.badManifest
          ? 'unrelated'
          : file.includes('node_modules')
            ? '@deepseek-ai/dsh'
            : 'dsh-plugin-desktop',
        version: file.includes('node_modules') ? '0.2.1-rc.2' : '2.0.18',
      }),
    ),
  )
  return {
    command,
    manifest,
    provider: new WindowsDesktopDiscoveryProvider(command, manifest, options.platform ?? 'win32'),
  }
}

describe('packaged Windows Desktop discovery', () => {
  it('reads official Electron identity from its packed manifests and requires matching versions', async () => {
    const image = 'C:\\Apps\\Harness\\DeepSeek Harness.exe'
    const command = vi.fn((name: string) =>
      Promise.resolve(name === 'netstat.exe' ? listeners : JSON.stringify([{ Id: 42, Path: image }])),
    )
    const archive = vi.fn((_file: string, member: string) =>
      Promise.resolve(
        JSON.stringify({
          name: member === 'package.json' ? '@deepseek-ai/dsh-desktop' : '@deepseek-ai/dsh',
          version: '0.2.1-rc.2',
        }),
      ),
    )
    const manifest = vi.fn(() => Promise.reject(new Error('No unpacked identity')))
    const provider = new WindowsDesktopDiscoveryProvider(command, manifest, 'win32', archive)
    const candidates = await provider.discover()
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      runtimeVersion: '0.2.1-rc.2',
      runtimeVersionEvidence: 'process-manifest',
    })
    expect(archive).toHaveBeenCalledWith('C:\\Apps\\Harness\\resources\\app.asar', 'package.json', undefined)
    expect(manifest).not.toHaveBeenCalled()
    archive.mockImplementation((_file, member) =>
      Promise.resolve(
        JSON.stringify({
          name: member === 'package.json' ? '@deepseek-ai/dsh-desktop' : '@deepseek-ai/dsh',
          version: member === 'package.json' ? '0.2.1-rc.1' : '0.2.1-rc.2',
        }),
      ),
    )
    await expect(provider.discover()).resolves.toEqual([])
  })

  it('binds only the verified desktop PID, executable, package version and loopback listener', async () => {
    const f = fixture()
    const composite = new CompositeInstanceDiscovery([f.provider])
    await expect(composite.discover()).resolves.toEqual([
      {
        endpoint: { host: '127.0.0.1', port: 43120, baseUrl: 'http://127.0.0.1:43120' },
        source: 'process-scan',
        pid: 42,
        executablePath: executable,
        runtimeVersion: '0.2.1-rc.2',
        runtimeVersionEvidence: 'process-manifest',
        confidence: 90,
      },
    ])
    expect(f.manifest).toHaveBeenCalledTimes(2)
    await expect(
      f.provider.discoverEndpoints([{ host: 'localhost', port: 43122, baseUrl: 'http://localhost:43122' }]),
    ).resolves.toEqual([])
  })

  it.each([
    { processes: '{invalid' },
    { processes: JSON.stringify([{ Id: -1, Path: executable }]) },
    { processes: JSON.stringify([{ Id: 42, Path: 'C:\\Other\\other.exe' }]) },
    { badManifest: true },
  ])('does not promote malformed or unrelated processes to DSH identity: %j', async (options) => {
    await expect(fixture(options).provider.discover()).resolves.toEqual([])
  })

  it('treats unavailable OS queries as optional but propagates cancellation', async () => {
    const f = fixture()
    f.command.mockRejectedValue(new Error('unavailable'))
    await expect(f.provider.discover()).resolves.toEqual([])
    const abort = new AbortController()
    abort.abort(new Error('cancelled discovery'))
    await expect(f.provider.discover(abort.signal)).rejects.toThrow('cancelled discovery')
    const nonWindows = fixture({ platform: 'linux' })
    await expect(nonWindows.provider.discover()).resolves.toEqual([])
    expect(nonWindows.command).not.toHaveBeenCalled()
  })

  it('discards desktop image identity when another PID claims the same endpoint', async () => {
    const f = fixture()
    const candidate = (await f.provider.discover())[0]!
    const conflicting = { id: 'other', discover: () => Promise.resolve([{ ...candidate, pid: 99 }]) }
    const result = await new CompositeInstanceDiscovery([f.provider, conflicting]).discover()
    expect(result[0]).not.toHaveProperty('runtimeVersion')
    expect(result[0]).not.toHaveProperty('executablePath')
  })
})
