import type {
  BackendEndpoint,
  BackendEvent,
  ConnectedBackend,
  PluginBundleRepository,
  SessionProjectionValues,
} from '@dsh-vscode/domain'
import type { VersionAdapterIdentity } from '../../adapter-base.js'
import type { Rc6SessionRepositoryOptions } from '../../repositories/session-repository.js'
import type { Rc6WorkspaceRepository } from '../../repositories/workspace-repository.js'
import type { AlphaLoopbackApiClient, AlphaLoopbackApiClientOptions } from '../alpha/transport.js'
import { Rc221VersionAdapter } from '../rc221/adapter.js'
import { Rc221PluginBundleRepository } from '../rc221/plugin-manager-repository.js'
import type { PluginManagerWireProfile } from '../rc172/plugin-manager-repository.js'
import { Rc222SessionRepository, mapTeamModeEvent, mapTeamModeValues } from './agent-team.js'
import { rc222SessionProfile } from './session-wire.js'

/** dsh-v0.2.2-rc.2 / ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c. */
export class Rc222VersionAdapter extends Rc221VersionAdapter {
  protected override readonly identity: VersionAdapterIdentity = {
    id: 'dsh-0.2.2-rc.2',
    supportedVersion: '0.2.2-rc.2',
    protocolVersion: 'rc222',
    compatibilityPriority: 370,
    fallback: false,
  }

  /**
   * rc.2 authorizes a continuation on the target Session: `subagents/prompt`
   * drops `parentSessionId`/`mode` and makes `delivery` required, and
   * `subagents/interruptByParent` becomes `subagents/interruptByUser`.
   */
  protected override readonly supportsTreeScopedSubagentWire = true

  protected override createTransportOptions(endpoint: BackendEndpoint): AlphaLoopbackApiClientOptions {
    return { ...super.createTransportOptions(endpoint), sessionWireProfile: rc222SessionProfile }
  }

  protected override createPluginBundleRepository(transport: AlphaLoopbackApiClient): PluginBundleRepository {
    return new Rc222PluginBundleRepository(transport)
  }

  protected override createSessionRepository(
    transport: AlphaLoopbackApiClient,
    workspaces: Rc6WorkspaceRepository,
    options: Rc6SessionRepositoryOptions,
  ): Rc222SessionRepository {
    return new Rc222SessionRepository(transport, workspaces, this.options.samePath, options)
  }

  protected override mapProjectionValues(
    values: Readonly<Record<string, unknown>>,
    backend?: ConnectedBackend,
  ): SessionProjectionValues {
    return mapTeamModeValues(
      super.mapProjectionValues(values),
      backend?.capabilities.compatibilityMode === 'exact',
    )
  }

  protected override mapBackendEvent(event: BackendEvent, backend?: ConnectedBackend): BackendEvent {
    return mapTeamModeEvent(super.mapBackendEvent(event), backend?.capabilities.compatibilityMode === 'exact')
  }
}

class Rc222PluginBundleRepository extends Rc221PluginBundleRepository {
  protected override readonly wireProfile: PluginManagerWireProfile = {
    restartReason: true,
    alreadyInstalled: true,
    unsupportedPlatform: true,
    unexpectedPackage: true,
  }
}
