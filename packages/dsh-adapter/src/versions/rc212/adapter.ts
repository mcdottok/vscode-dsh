import type { VersionAdapterIdentity } from '../../adapter-base.js'
import { Rc211VersionAdapter } from '../rc211/adapter.js'
import type { AlphaLoopbackApiClient } from '../alpha/transport.js'
import { Rc212EditorBridgeRepository } from './editor-bridge-repository.js'
import type { BackendCandidate, BackendCapabilities } from '@dsh-vscode/domain'
import { isKnownDshVersion } from '../../contracts.js'
import { withBestEffortAdapterCapabilities } from '../../compatibility.js'
import { acceptsRc212CompatibilityVersion, RC212_COMPATIBILITY_RANGE } from './compatibility.js'

/** dsh-v0.2.1-rc.2 / 687f282e8625c6b8d11ff58211a90524be2e4317.
 * Consumed Remote, Gateway, V4, tools and account contracts retain the rc.1 wire.
 * Web provider selection and Search / Fetch options arrive through settings.describe.
 */
export class Rc212VersionAdapter extends Rc211VersionAdapter {
  public supportsCompatibilityVersion(version: string): boolean {
    return acceptsRc212CompatibilityVersion(version)
  }

  public override async probeCompatibility(
    candidate?: BackendCandidate,
    signal?: AbortSignal,
  ): Promise<BackendCapabilities | undefined> {
    const version = candidate?.runtimeVersion
    if (
      candidate === undefined ||
      version === undefined ||
      isKnownDshVersion(version) ||
      !this.supportsCompatibilityVersion(version)
    )
      return undefined
    // Reuse the baseline's read-only Session V4 / Workspace checks. Only the
    // internal probe sees the baseline label; the result keeps the real runtime.
    const capabilities = await super.probe({ ...candidate, runtimeVersion: this.supportedVersion }, signal)
    if (capabilities === undefined) return undefined
    return withBestEffortAdapterCapabilities(
      {
        ...capabilities,
        compatibilityWarning: `DSH ${version} is using the 0.2.1-rc.2 protocol baseline (${RC212_COMPATIBILITY_RANGE}); initial response checks passed, but this runtime has not been individually verified.`,
      },
      version,
      this.id,
    )
  }

  protected override createEditorBridgeRepository(
    transport: AlphaLoopbackApiClient,
  ): Rc212EditorBridgeRepository {
    return new Rc212EditorBridgeRepository(transport)
  }
  protected override readonly identity: VersionAdapterIdentity = {
    id: 'dsh-0.2.1-rc.2',
    supportedVersion: '0.2.1-rc.2',
    protocolVersion: 'rc212',
    compatibilityPriority: 330,
    fallback: false,
  }
}
