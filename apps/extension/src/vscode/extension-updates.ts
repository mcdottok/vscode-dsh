import type { Memento } from 'vscode'
import { z } from 'zod'
import { extensionUpdateSchema, type ExtensionUpdate } from '@dsh-vscode/webview-protocol'
import { compareVersions, isDshPackageVersion } from './update-runtime.js'

export const VSIX_UPDATE_SETTING = 'dsh.extension.autoCheckUpdates'
const LATEST_RELEASE_URL = 'https://api.github.com/repos/mcdottok/vscode-dsh/releases/latest'
const ATTEMPT_KEY = 'vsixUpdate.lastAttempt'
const DISMISSED_KEY = 'vsixUpdate.dismissedVersion'
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 5_000

const releaseSchema = z.object({
  tag_name: z.string().max(65),
  published_at: z.iso.datetime(),
  draft: z.literal(false),
  prerelease: z.literal(false),
  assets: z.array(z.object({ name: z.string(), browser_download_url: z.string(), state: z.string() })),
})

interface ExtensionUpdateDependencies {
  readonly installedVersion: string
  readonly state: Memento
  readonly isEnabled: () => boolean
  readonly publish: (update: ExtensionUpdate | null) => Promise<boolean>
}

export class ExtensionUpdates {
  private current: ExtensionUpdate | null = null
  private pending: AbortController | undefined
  private lastAttempt = 0
  private disposed = false

  public constructor(private readonly deps: ExtensionUpdateDependencies) {}

  public snapshot(): ExtensionUpdate | null {
    return this.deps.isEnabled() ? this.current : null
  }

  public async check(): Promise<void> {
    if (this.disposed || this.pending !== undefined || !this.deps.isEnabled()) return
    const { installedVersion, state } = this.deps
    if (!isDshPackageVersion(installedVersion)) return
    const now = Date.now()
    const stored = state.get<number>(ATTEMPT_KEY, 0)
    const lastAttempt = Math.max(this.lastAttempt, Number.isFinite(stored) && stored <= now ? stored : 0)
    if (now - lastAttempt < CHECK_INTERVAL_MS) return
    this.lastAttempt = now
    const controller = new AbortController()
    this.pending = controller
    try {
      await state.update(ATTEMPT_KEY, now)
      if (controller.signal.aborted || !this.deps.isEnabled()) return
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      const response = await fetch(LATEST_RELEASE_URL, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DSH-Coding-Agent' },
        redirect: 'error',
        signal,
      })
      if (!response.ok) {
        await response.body?.cancel()
        return
      }
      const release = releaseSchema.safeParse(await response.json())
      if (signal.aborted || !this.deps.isEnabled()) return
      const update = release.success ? this.selectUpdate(release.data, installedVersion) : null
      if (update === null && this.current === null) return
      this.current = update
      await this.deps.publish(update)
    } catch {
      // Offline, timeouts, rate limits and storage failures are silent.
    } finally {
      this.pending = undefined
    }
  }

  public async configurationChanged(): Promise<void> {
    if (this.deps.isEnabled()) {
      await this.check()
      return
    }
    this.pending?.abort()
    if (this.current === null) return
    this.current = null
    await this.deps.publish(null)
  }

  public async dismiss(version: string): Promise<void> {
    if (this.current?.version !== version) return
    this.current = null
    await Promise.all([this.deps.publish(null), this.deps.state.update(DISMISSED_KEY, version)])
  }

  public dispose(): void {
    this.disposed = true
    this.pending?.abort()
  }

  private selectUpdate(
    release: z.infer<typeof releaseSchema>,
    installedVersion: string,
  ): ExtensionUpdate | null {
    const version = release.tag_name.replace(/^v/u, '')
    if (this.deps.state.get<string>(DISMISSED_KEY) === version) return null
    const asset = release.assets.find(
      ({ name, state }) => name === `dsh-coding-agent-${version}.vsix` && state === 'uploaded',
    )
    const update = extensionUpdateSchema.safeParse({
      version,
      publishedAt: release.published_at,
      downloadUrl: asset?.browser_download_url,
    })
    return update.success && compareVersions(version, installedVersion) > 0 ? update.data : null
  }
}
