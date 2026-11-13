import type { VersionAdapterIdentity } from '../../adapter-base.js'
import { acceptsRc223CompatibilityVersion } from '../rc212/compatibility.js'
import { Rc222VersionAdapter } from '../rc222/adapter.js'

/** dsh-v0.2.2-rc.3 / 38a6a5c965aa99ab525161efb7cc5cf1fe62fced.
 * The consumed Session, Workspace, Gateway and subagent contracts retain the rc.2 wire.
 */
export class Rc223VersionAdapter extends Rc222VersionAdapter {
  public override supportsCompatibilityVersion(version: string): boolean {
    return acceptsRc223CompatibilityVersion(version)
  }

  protected override readonly identity: VersionAdapterIdentity = {
    id: 'dsh-0.2.2-rc.3',
    supportedVersion: '0.2.2-rc.3',
    protocolVersion: 'rc223',
    compatibilityPriority: 380,
    fallback: false,
  }
}
