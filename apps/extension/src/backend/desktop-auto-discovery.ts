import { spawn } from 'node:child_process'
import { open, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type { BackendCandidate, BackendEndpoint } from '@dsh-vscode/domain'
import { WindowsDesktopDiscoveryProvider } from './discovery/windows-desktop-provider.js'
import { resolvePairedDesktop } from './desktop-pairing.js'
import { parseDesktopLaunchUrl } from '../vscode/connect-desktop.js'

export const AUTOMATIC_DESKTOP_ORIGIN = 'dsh.desktop.automaticOrigin.v1'

const SCRIPT =
  "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $text=[Console]::In.ReadToEnd(); $bytes=[Convert]::FromBase64String($text); $entropy=[Text.Encoding]::UTF8.GetBytes('dsh-vscode-connect.bootstrap.v1'); [Console]::Out.Write([Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)))"

/** Static command, data on stdin, bounded output, no diagnostics containing credential payloads. */
export function unprotectDesktopBootstrap(value: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', SCRIPT], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    let output = ''
    const abort = (): void => {
      child.kill()
    }
    const timer = setTimeout(abort, 5000)
    signal?.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8')
      if (output.length > 4096) abort()
    })
    child.stdin.on('error', () => undefined)
    const cleanup = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
    child.on('error', () => {
      cleanup()
      reject(new Error('Local bootstrap unavailable'))
    })
    child.on('close', (code) => {
      cleanup()
      if (signal?.aborted) {
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new DOMException('Discovery cancelled.', 'AbortError'),
        )
        return
      }
      if (code === 0 && output.length > 0 && output.length <= 4096) resolve(output)
      else reject(new Error('Local bootstrap unavailable'))
    })
    if (signal?.aborted) abort()
    child.stdin.end(value)
  })
}

export interface AutomaticDesktopConnection {
  readonly url: string
  readonly key: string
  readonly endpoint: BackendEndpoint
  readonly runtimeVersion: string
}
interface DiscoveryDependencies {
  readonly directory?: string
  readonly platform?: NodeJS.Platform
  readonly now?: () => number
  readonly candidates?: (signal?: AbortSignal) => Promise<readonly BackendCandidate[]>
  readonly unprotect?: typeof unprotectDesktopBootstrap
  readonly resolve?: typeof resolvePairedDesktop
}
interface RecordEntry {
  readonly pid: number
  readonly createdAt: number
  readonly protectedKey: string
}

/** Manual/custom targets are preserved. Only an empty automatic selection, or our own prior automatic choice, may bootstrap. */
export function allowsAutomaticDesktop(
  connection: {
    readonly mode: string
    readonly serverUrl?: string
    readonly attachPortsConfigured?: boolean
  },
  automaticOrigin?: string,
): boolean {
  if (connection.mode === 'custom') return !!automaticOrigin && connection.serverUrl === automaticOrigin
  return (
    ['auto', 'attach-only'].includes(connection.mode) &&
    !connection.serverUrl?.trim() &&
    connection.attachPortsConfigured !== true
  )
}

export class DesktopAutoDiscovery {
  private readonly directory: string
  private readonly now: () => number
  public constructor(private readonly dependencies: DiscoveryDependencies = {}) {
    this.directory =
      dependencies.directory ??
      path.join(
        process.env.LOCALAPPDATA ?? path.join(homedir(), 'AppData', 'Local'),
        'dsh-vscode-connect',
        'instances',
      )
    this.now = dependencies.now ?? Date.now
  }
  private async records(signal?: AbortSignal): Promise<readonly RecordEntry[]> {
    if ((this.dependencies.platform ?? process.platform) !== 'win32') return []
    try {
      const entries = await readdir(this.directory, { withFileTypes: true })
      const result: RecordEntry[] = []
      for (const entry of entries
        .filter((item) => item.isFile() && /^\d{13}-[a-f0-9]{24}\.json$/u.test(item.name))
        .sort((a, b) => b.name.localeCompare(a.name))
        .slice(0, 64)) {
        signal?.throwIfAborted()
        try {
          const handle = await open(path.join(this.directory, entry.name), 'r')
          let text: string
          try {
            const buffer = Buffer.alloc(16_385)
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
            if (bytesRead > 16_384) continue
            text = buffer.subarray(0, bytesRead).toString('utf8')
          } finally {
            await handle.close()
          }
          const value = JSON.parse(text) as Record<string, unknown>
          const now = this.now()
          if (
            value.version !== 1 ||
            typeof value.pid !== 'number' ||
            !Number.isSafeInteger(value.pid) ||
            value.pid <= 0 ||
            typeof value.createdAt !== 'number' ||
            !Number.isSafeInteger(value.createdAt) ||
            value.createdAt > now + 5000 ||
            typeof value.updatedAt !== 'number' ||
            !Number.isSafeInteger(value.updatedAt) ||
            value.updatedAt < now - 15_000 ||
            value.updatedAt > now + 5000 ||
            typeof value.protectedKey !== 'string' ||
            !/^[A-Za-z0-9+/=]{32,8192}$/u.test(value.protectedKey)
          )
            continue
          result.push({ pid: value.pid, createdAt: value.createdAt, protectedKey: value.protectedKey })
        } catch {
          signal?.throwIfAborted()
        }
      }
      return result
    } catch {
      signal?.throwIfAborted()
      return []
    }
  }
  public async available(signal?: AbortSignal): Promise<boolean> {
    return (await this.records(signal)).length > 0
  }
  public async discover(
    callerSignal?: AbortSignal,
    expectedKey?: string,
  ): Promise<AutomaticDesktopConnection | undefined> {
    const signal = AbortSignal.any([AbortSignal.timeout(10_000), ...(callerSignal ? [callerSignal] : [])])
    const records = await this.records(signal)
    if (!records.length) return undefined
    const candidates = await (
      this.dependencies.candidates ?? ((s) => new WindowsDesktopDiscoveryProvider().discover(s))
    )(signal)
    const found = new Map<string, AutomaticDesktopConnection>()
    for (const record of records) {
      signal.throwIfAborted()
      const verified = candidates.filter(
        (item) =>
          item.pid === record.pid &&
          item.source === 'process-scan' &&
          item.runtimeVersionEvidence === 'process-manifest' &&
          item.executablePath !== undefined,
      )
      if (!verified.length) continue
      try {
        const text = await (this.dependencies.unprotect ?? unprotectDesktopBootstrap)(
          record.protectedKey,
          signal,
        )
        const grant = JSON.parse(text) as Record<string, unknown>
        if (grant.version !== 1 || typeof grant.key !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(grant.key))
          continue
        if (expectedKey !== undefined && grant.key !== expectedKey) continue
        const url = await (this.dependencies.resolve ?? resolvePairedDesktop)(grant.key, signal)
        const launch = parseDesktopLaunchUrl(url)
        const owner = verified.find((candidate) => candidate.endpoint.baseUrl === launch.endpoint.baseUrl)
        // The returned address must still belong to the verified Desktop, not merely an advertised PID.
        if (
          !owner?.runtimeVersion ||
          launch.endpoint.host !== '127.0.0.1' ||
          !launch.token ||
          new URL(url).protocol !== 'http:'
        )
          continue
        signal.throwIfAborted()
        const connection = {
          url,
          key: grant.key,
          endpoint: launch.endpoint,
          runtimeVersion: owner.runtimeVersion,
        }
        if (expectedKey !== undefined) return connection
        found.set(grant.key, connection)
        // Without an existing pairing identity, selecting between Desktop profiles
        // would silently switch conversations. Require a unique verified owner.
        if (found.size > 1) return undefined
      } catch {
        signal.throwIfAborted()
      }
    }
    return found.size === 1 ? [...found.values()][0] : undefined
  }
}
