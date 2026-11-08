import { Alpha214PluginBundleRepository } from '../alpha214/plugin-manager-repository.js'
import type { PluginManagerWireProfile } from '../rc172/plugin-manager-repository.js'

/** 0.2.2 reports bundles unsupported on the running platform as a management error. */
export class Rc221PluginBundleRepository extends Alpha214PluginBundleRepository {
  protected override readonly wireProfile: PluginManagerWireProfile = {
    restartReason: true,
    alreadyInstalled: true,
    unsupportedPlatform: true,
  }

  /**
   * The upstream official on-demand catalog builds install targets from
   * getDshRuntimeVersion(). Installed bundle versions may differ from the Host.
   */
  public async readRuntimeVersion(signal?: AbortSignal): Promise<string | undefined> {
    const bundles = await this.listBundles(signal)
    const versions = new Set<string>()
    for (const bundle of bundles) {
      const target = bundle.installTarget
      if (bundle.official === true && target !== undefined) versions.add(target.version)
    }
    return versions.size === 1 ? [...versions][0] : undefined
  }
}
