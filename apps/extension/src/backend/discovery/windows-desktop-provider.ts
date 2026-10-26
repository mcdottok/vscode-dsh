import path from 'node:path'
import { isDshPackageVersion } from '@dsh-vscode/dsh-adapter'
import type { BackendCandidate, BackendEndpoint } from '@dsh-vscode/domain'
import { discoveryCancelled, isDiscoveryCancellation, type DiscoveryProvider } from './provider.js'
import { parseListeners, readDshPackageManifest, runDiscoveryCommand } from './process-provider.js'
import { readAsarManifest } from './asar-manifest.js'

type RunCommand = (executable: string, args: readonly string[], signal?: AbortSignal) => Promise<string>
type ReadManifest = (file: string) => Promise<string>

const PROCESS_ARGS = [
  '-NoLogo',
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  "@(Get-Process -Name 'DSH Desktop','DeepSeek Harness' -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ Id=$_.Id; Path=$_.Path } }) | ConvertTo-Json -Compress",
] as const

/** Packaged Electron hosts do not run `dsh web`; discover their verified loopback listeners. */
export class WindowsDesktopDiscoveryProvider implements DiscoveryProvider {
  public readonly id = 'windows-desktop'
  public readonly phase = 'fallback' as const

  public constructor(
    private readonly runCommand: RunCommand = runDiscoveryCommand,
    private readonly readManifest: ReadManifest = readDshPackageManifest,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly readArchiveManifest: typeof readAsarManifest = readAsarManifest,
  ) {}

  public async discover(signal?: AbortSignal): Promise<readonly BackendCandidate[]> {
    signal?.throwIfAborted()
    if (this.platform !== 'win32') return []
    try {
      const [processOutput, listeners] = await Promise.all([
        this.runCommand('powershell.exe', PROCESS_ARGS, signal),
        this.runCommand('netstat.exe', ['-ano', '-p', 'tcp'], signal),
      ])
      signal?.throwIfAborted()
      const rows: unknown = processOutput.trim() === '' ? [] : JSON.parse(processOutput)
      const processes = Array.isArray(rows) ? rows : [rows]
      const candidates: BackendCandidate[] = []
      for (const row of processes) {
        if (!isProcess(row)) continue
        const executable = path.win32.normalize(row.Path)
        const image = path.win32.basename(executable).toLowerCase()
        if (!/^[A-Za-z]:\\/u.test(executable) || !['dsh desktop.exe', 'deepseek harness.exe'].includes(image))
          continue
        const ownedListeners = parseListeners(listeners).filter((listener) => listener.pid === row.Id)
        if (ownedListeners.length === 0) continue
        try {
          const resources = path.win32.join(path.win32.dirname(executable), 'resources')
          const official = image === 'deepseek harness.exe'
          const read = (member: string): Promise<string> =>
            official
              ? this.readArchiveManifest(path.win32.join(resources, 'app.asar'), member, signal)
              : this.readManifest(path.win32.join(resources, 'app', member))
          const desktop: unknown = JSON.parse(await read('package.json'))
          const core: unknown = JSON.parse(
            await read(
              official
                ? 'dsh/node_modules/@deepseek-ai/dsh/package.json'
                : 'node_modules/@deepseek-ai/dsh/package.json',
            ),
          )
          if (
            !isPackage(desktop, official ? '@deepseek-ai/dsh-desktop' : 'dsh-plugin-desktop') ||
            !isPackage(core, '@deepseek-ai/dsh') ||
            !isDshPackageVersion(core.version) ||
            (official && desktop.version !== core.version)
          )
            continue
          for (const listener of ownedListeners) {
            candidates.push({
              endpoint: {
                host: listener.host,
                port: listener.port,
                baseUrl: `http://${listener.host}:${listener.port}`,
              },
              source: 'process-scan',
              pid: row.Id,
              executablePath: executable,
              runtimeVersion: core.version,
              runtimeVersionEvidence: 'process-manifest',
              confidence: 90,
            })
          }
        } catch {
          // A disappearing process, missing package or malformed manifest is not runtime identity.
        }
      }
      signal?.throwIfAborted()
      return candidates
    } catch (error) {
      if (isDiscoveryCancellation(error, signal)) throw discoveryCancelled(signal?.reason ?? error)
      return []
    }
  }

  public async discoverEndpoints(
    endpoints: readonly BackendEndpoint[],
    signal?: AbortSignal,
  ): Promise<readonly BackendCandidate[]> {
    const wanted = new Set(
      endpoints
        .filter((endpoint) => endpoint.host === '127.0.0.1' || endpoint.host === 'localhost')
        .map((endpoint) => endpoint.port),
    )
    if (wanted.size === 0) return []
    return (await this.discover(signal)).filter((candidate) => wanted.has(candidate.endpoint.port))
  }
}

function isProcess(value: unknown): value is { Id: number; Path: string } {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return (
    typeof row.Id === 'number' &&
    Number.isSafeInteger(row.Id) &&
    row.Id > 0 &&
    typeof row.Path === 'string' &&
    row.Path.length <= 4096
  )
}

function isPackage(value: unknown, name: string): value is { name: string; version: string } {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return record.name === name && typeof record.version === 'string'
}
