import type {
  DshRuntime,
  DshRuntimeUpdateProgress,
  DshUpdateFailure,
  DshUpdateSnapshot,
} from '@dsh-vscode/domain'
import { AppError } from '@dsh-vscode/domain'
import { DSH_PACKAGE_NAME, isDshPackageVersion as isDshSemVerVersion } from '@dsh-vscode/dsh-adapter'

const UPDATE_CHECK_TIMEOUT_MS = 30_000
const UPDATE_MAX_BUFFER = 1024 * 1024

export interface RuntimeCommandOptions {
  readonly timeout: number
  readonly maxBuffer: number
  readonly env?: NodeJS.ProcessEnv
  readonly signal?: AbortSignal
}

export interface RuntimeCommandResult {
  readonly stdout: string
  readonly stderr: string
}

export type ExecuteRuntimeCommand = (
  executable: string,
  args: readonly string[],
  options: RuntimeCommandOptions,
) => Promise<RuntimeCommandResult>

export interface DshRuntimeUpdaterDependencies {
  readonly npmExecutable: () => string
  readonly locateRuntime: (signal?: AbortSignal) => Promise<DshRuntime | undefined>
  readonly execute: ExecuteRuntimeCommand
  /** Safe, phase-only progress; never include npm output, paths, or secrets. */
  readonly onProgress?: (progress: DshRuntimeUpdateProgress) => void
  readonly environment?: () => NodeJS.ProcessEnv
  readonly now?: () => Date
  readonly openInstallTerminal: (version: string) => Promise<void>
}

interface RegistryMetadata {
  readonly versions: readonly string[]
  readonly latestTagVersion?: string
  readonly nextTagVersion?: string
}

export class DshRuntimeUpdater {
  private cached: DshUpdateSnapshot | undefined
  private inFlight: Promise<DshUpdateSnapshot> | undefined

  public constructor(private readonly dependencies: DshRuntimeUpdaterDependencies) {}

  public checkForUpdates(force = false, signal?: AbortSignal): Promise<DshUpdateSnapshot> {
    if (!force && this.cached !== undefined) return Promise.resolve(this.cached)
    if (this.inFlight !== undefined) return this.inFlight

    const operation = this.checkOnce(signal)
    this.inFlight = operation
    void operation.then(
      () => {
        if (this.inFlight === operation) this.inFlight = undefined
      },
      () => {
        if (this.inFlight === operation) this.inFlight = undefined
      },
    )
    return operation
  }

  public async installVersion(version: string, signal?: AbortSignal): Promise<DshUpdateSnapshot> {
    const requested = version.trim()
    if (!isDshPackageVersion(requested))
      throw updateError(
        'invalid-version',
        'Select an exact DSH version from the upstream version list.',
        false,
      )
    const checked = await this.checkForUpdates(false, signal)
    if (signal?.aborted === true) throw cancelledError(signal.reason)
    if (checked.status !== 'ready' || !checked.availableVersions.includes(requested))
      throw updateError(
        'metadata-unavailable',
        'The selected DSH version could not be verified against the upstream registry.',
        true,
      )

    if (checked.globalVersion !== requested) await this.dependencies.openInstallTerminal(requested)
    return checked
  }

  private async checkOnce(signal?: AbortSignal): Promise<DshUpdateSnapshot> {
    this.emitProgress({ phase: 'checking' })
    const checkedAt = this.timestamp()
    const [runtimeResult, metadataResult, globalResult] = await Promise.allSettled([
      this.dependencies.locateRuntime(signal),
      this.readMetadata(signal),
      this.readGlobalVersion(signal),
    ])
    if (
      signal?.aborted === true ||
      [runtimeResult, metadataResult, globalResult].some((result) => isRejectedCancellation(result, signal))
    )
      throw cancelledError(signal?.reason)

    const runtime = runtimeResult.status === 'fulfilled' ? runtimeResult.value : undefined
    const globalVersion = globalResult.status === 'fulfilled' ? globalResult.value : undefined
    if (metadataResult.status !== 'fulfilled') {
      const snapshot: DshUpdateSnapshot = {
        status: 'unavailable',
        ...(runtime === undefined ? {} : { currentVersion: runtime.version, currentSource: runtime.source }),
        ...(globalVersion === undefined ? {} : { globalVersion }),
        availableVersions: [],
        updateAvailable: false,
        checkedAt,
        failure: failureFor(metadataResult.reason),
      }
      this.cached = snapshot
      this.emitProgress({ phase: 'failed' })
      return snapshot
    }

    const snapshot = this.snapshot('ready', runtime, globalVersion, metadataResult.value, checkedAt)
    this.cached = snapshot
    this.emitProgress({ phase: 'completed' })
    return snapshot
  }

  private emitProgress(progress: DshRuntimeUpdateProgress): void {
    try {
      this.dependencies.onProgress?.(progress)
    } catch {
      // Progress is advisory. A disconnected Webview must never fail npm work.
    }
  }

  private async readMetadata(signal?: AbortSignal): Promise<RegistryMetadata> {
    const result = await this.dependencies.execute(
      this.dependencies.npmExecutable(),
      ['view', DSH_PACKAGE_NAME, '--json'],
      this.commandOptions(UPDATE_CHECK_TIMEOUT_MS, signal),
    )
    return parseNpmMetadata(result.stdout)
  }

  private async readGlobalVersion(signal?: AbortSignal): Promise<string | undefined> {
    try {
      const result = await this.dependencies.execute(
        this.dependencies.npmExecutable(),
        ['list', '--global', DSH_PACKAGE_NAME, '--depth=0', '--json'],
        this.commandOptions(UPDATE_CHECK_TIMEOUT_MS, signal),
      )
      return parseGlobalVersion(result.stdout)
    } catch (error) {
      if (isCancellation(error, signal)) throw error
      return undefined
    }
  }

  private snapshot(
    status: 'ready',
    runtime: DshRuntime | undefined,
    globalVersion: string | undefined,
    metadata: RegistryMetadata,
    checkedAt = this.timestamp(),
  ): DshUpdateSnapshot {
    const latestVersion = metadata.versions[0]
    const currentVersion = runtime?.version
    const updateAvailable =
      latestVersion !== undefined &&
      [currentVersion, globalVersion].some(
        (installed) => installed !== undefined && compareVersions(latestVersion, installed) > 0,
      )
    return {
      status,
      ...(runtime === undefined ? {} : { currentVersion: runtime.version, currentSource: runtime.source }),
      ...(globalVersion === undefined ? {} : { globalVersion }),
      ...(latestVersion === undefined ? {} : { latestVersion }),
      ...(metadata.latestTagVersion === undefined ? {} : { latestTagVersion: metadata.latestTagVersion }),
      ...(metadata.nextTagVersion === undefined ? {} : { nextTagVersion: metadata.nextTagVersion }),
      availableVersions: metadata.versions,
      updateAvailable,
      checkedAt,
    }
  }

  private commandOptions(timeout: number, signal?: AbortSignal): RuntimeCommandOptions {
    return {
      timeout,
      maxBuffer: UPDATE_MAX_BUFFER,
      ...(this.dependencies.environment === undefined ? {} : { env: this.dependencies.environment() }),
      ...(signal === undefined ? {} : { signal }),
    }
  }

  private timestamp(): string {
    return (this.dependencies.now ?? (() => new Date()))().toISOString()
  }
}

export function parseNpmMetadata(output: string): RegistryMetadata {
  let value: unknown
  try {
    value = JSON.parse(output.replace(/^\uFEFF/u, '').trim()) as unknown
  } catch (error) {
    throw new Error('The npm registry returned invalid JSON.', { cause: error })
  }
  const record = asRecord(value)
  // `npm view <package> --json` returns the complete package document, while
  // `npm view <package> versions --json` returns the version array directly.
  // Keep both shapes compatible because npm/DSH installations in the wild may
  // still be running the older command path.
  const versionValue = record?.versions ?? value
  const rawVersions = Array.isArray(versionValue)
    ? versionValue
    : typeof versionValue === 'string'
      ? [versionValue]
      : []
  const versions = uniqueSortedVersions(
    rawVersions.filter((entry): entry is string => typeof entry === 'string'),
  )
  if (versions.length === 0) throw new Error('The npm registry returned no valid DSH versions.')
  const tags = asRecord(record?.['dist-tags'])
  const latestTagVersion = validTag(tags?.latest, versions)
  const nextTagVersion = validTag(tags?.next, versions)
  return {
    versions,
    ...(latestTagVersion === undefined ? {} : { latestTagVersion }),
    ...(nextTagVersion === undefined ? {} : { nextTagVersion }),
  }
}

export function isDshPackageVersion(value: string): boolean {
  return isDshSemVerVersion(value)
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (const [leftPart, rightPart] of [
    [a.major, b.major],
    [a.minor, b.minor],
    [a.patch, b.patch],
  ] as const) {
    if (leftPart !== rightPart) return leftPart - rightPart
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue
    const leftNumber = /^\d+$/u.test(leftPart) ? Number(leftPart) : undefined
    const rightNumber = /^\d+$/u.test(rightPart) ? Number(rightPart) : undefined
    if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber - rightNumber
    if (leftNumber !== undefined) return -1
    if (rightNumber !== undefined) return 1
    return leftPart < rightPart ? -1 : 1
  }
  return 0
}

function uniqueSortedVersions(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter(isDshPackageVersion))].sort((left, right) => compareVersions(right, left))
}

function validTag(value: unknown, versions: readonly string[]): string | undefined {
  return typeof value === 'string' && versions.includes(value) ? value : undefined
}

function parseGlobalVersion(output: string): string | undefined {
  try {
    const root = asRecord(JSON.parse(output) as unknown)
    const dependencies = asRecord(root?.dependencies)
    const packageRecord = asRecord(dependencies?.[DSH_PACKAGE_NAME])
    const version = packageRecord?.version
    return typeof version === 'string' && isDshPackageVersion(version) ? version : undefined
  } catch {
    return undefined
  }
}

function parseVersion(value: string): {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: readonly string[]
} {
  const match = value.match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u,
  )
  if (match === null) return { major: 0, minor: 0, patch: 0, prerelease: [] }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function failureFor(error: unknown): DshUpdateFailure {
  if (isMissingExecutable(error)) return 'npm-not-found'
  if (
    error instanceof Error &&
    (error.message.includes('invalid JSON') || error.message.includes('no valid DSH versions'))
  )
    return 'invalid-response'
  return 'registry-unavailable'
}

function isMissingExecutable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    ? (error as { readonly code?: unknown }).code === 'ENOENT'
    : false
}

function isCancellation(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError')
}

function isRejectedCancellation(
  result: PromiseSettledResult<unknown>,
  signal: AbortSignal | undefined,
): boolean {
  return result.status === 'rejected' && isCancellation(result.reason, signal)
}

function cancelledError(cause: unknown): AppError {
  return new AppError({
    code: 'REQUEST_CANCELLED',
    message: 'DSH update operation was cancelled.',
    retryable: true,
    cause,
    context: { operation: 'runtime.update', reason: 'cancelled' },
  })
}

function updateError(
  reason: 'invalid-version' | 'metadata-unavailable',
  message: string,
  retryable: boolean,
): AppError {
  return new AppError({
    code: reason === 'metadata-unavailable' ? 'CAPABILITY_UNAVAILABLE' : 'INVALID_CONFIGURATION',
    message,
    retryable,
    context: { operation: 'runtime.update', reason },
  })
}
